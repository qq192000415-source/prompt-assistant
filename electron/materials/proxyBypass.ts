// 代理软件的虚拟网卡模式（Clash、mihomo、sing-box 的 TUN）会接管全部流量，NAS 域名没设直连时被送去代理节点，常常连不上。
// 这时绕开它：从真实网卡查 NAS 的地址，再指定从真实网卡出去连（Windows 按源地址选网卡，虚拟网卡拦不到，实测 Clash 的连接记录里没有）。
// 只在「连不上 + 域名被解析成假地址」时才试：有的网络（比如路由器透明代理）本来就要走代理才通，不能一律绕开。
// IPv4 和 IPv6 都试：和 NAS 在同一个局域网时，连自家公网 IPv4 要靠光猫回环，电信光猫多半不支持（客户电脑实测超时），
// 不开代理时其实是走 IPv6 连上的。
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

export type Route = { address: string; localAddress: string };

export type RouteInit = {
  method: string;
  headers?: Record<string, string>;
  body?: NonNullable<RequestInit['body']>;
  signal?: AbortSignal;
};

// Clash、mihomo、sing-box 的 fake-ip 默认网段 198.18.0.0/15，虚拟网卡自己的地址也在这里。
export const isFakeIp = (ip: string) => /^198\.1[89]\./.test(ip);

// 系统解析出的地址；地址本身就是 IP 或解析失败时返回 null。
export async function systemAddress(hostname: string): Promise<string | null> {
  if (net.isIP(hostname)) return null;
  try {
    return (await dns.lookup(hostname, { family: 4 })).address;
  } catch {
    return null;
  }
}

// 找线路的每一步写日志（主进程写到 <userData>/logs/nas.log），客户那边连不上时靠它看是哪一步不通。Node 测试里不设。
let log: (line: string) => void = () => undefined;
export const setRouteLogger = (logger: (line: string) => void) => {
  log = logger;
};
export const logRoute = (line: string) => log(line);
const errorText = (error: unknown) =>
  error instanceof Error ? `${(error as NodeJS.ErrnoException).code ?? ''} ${error.cause instanceof Error ? error.cause.message : error.message}`.trim() : String(error);

// 本机真实网卡的地址（IPv4 和公网 IPv6）。有假地址的那块就是代理的虚拟网卡，整块跳过（它的 IPv6 也是代理的）。
// Hyper-V 这类连不出去的也在里面，由 findRoute 一起试，哪条通用哪条。
export function physicalAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .filter((entries) => entries && !entries.some((entry) => entry.family === 'IPv4' && isFakeIp(entry.address)))
    .flat()
    .filter((entry) => entry && !entry.internal && !/^(169\.254\.|fe80:)/i.test(entry.address))
    .map((entry) => entry!.address);
}

// 用指定线路发请求，返回和 fetch 一样的 Response。主机名照旧（证书、SNI、Host 不变），只把连接的地址和出口网卡换掉。
export function routedFetch(url: string, init: RouteInit, route: Route): Promise<Response> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = (target.protocol === 'https:' ? https : http).request(
      target,
      {
        method: init.method,
        headers: init.headers,
        signal: init.signal,
        localAddress: route.localAddress,
        lookup: (_hostname, options, callback) => {
          const family = net.isIP(route.address);
          if (options.all) callback(null, [{ address: route.address, family }]);
          else (callback as (error: null, address: string, family: number) => void)(null, route.address, family);
        },
      },
      (response) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          for (const entry of [value ?? []].flat()) headers.append(name, entry);
        }
        const status = response.statusCode ?? 0;
        const empty = status === 204 || status === 304 || init.method === 'HEAD';
        if (empty) response.resume();
        resolve(new Response(empty ? null : (Readable.toWeb(response) as ReadableStream), { status, statusText: response.statusMessage, headers }));
      },
    );
    request.on('error', reject);
    const body = init.body;
    if (body === undefined || typeof body === 'string' || body instanceof Uint8Array) {
      request.end(body);
    } else {
      Readable.fromWeb(body as NodeReadableStream)
        .on('error', (error) => request.destroy(error))
        .pipe(request);
    }
  });
}

// 从真实网卡（IPv4）查 NAS 的地址，两种查法同时用，各查 IPv4 和 IPv6：
// - 普通 DNS（UDP 53）：等于没开虚拟网卡时这台电脑会拿到的地址。路由器自己也做代理时会被它接管，给出路由器的假地址，
//   这时只有按它给的地址连才通（公司网络实测：直连真实地址的加密连接会被路由器掐断）。
// - 阿里 DNS 的 JSON 接口（https 和 http）：普通 DNS 被拦时的真实地址。http 查到的被改了也不要紧，连 NAS 时照样校验证书。
async function lookupAddresses(hostname: string, localAddress: string): Promise<string[]> {
  const resolver = new dns.Resolver({ timeout: 3000, tries: 1 });
  resolver.setLocalAddress(localAddress);
  resolver.setServers(['223.5.5.5', '119.29.29.29']);
  const viaJson = (scheme: string, type: number) =>
    routedFetch(
      `${scheme}://223.5.5.5/resolve?name=${encodeURIComponent(hostname)}&type=${type}`,
      { method: 'GET', signal: AbortSignal.timeout(8000) },
      { address: '223.5.5.5', localAddress },
    )
      .then((response) => response.json() as Promise<{ Answer?: { type: number; data: string }[] }>)
      .then((answer) => (answer.Answer ?? []).filter((entry) => entry.type === type).map((entry) => entry.data));
  const queries: [string, Promise<string[]>][] = [
    ['DNS A', resolver.resolve4(hostname)],
    ['DNS AAAA', resolver.resolve6(hostname)],
    ['JSON https A', viaJson('https', 1)],
    ['JSON https AAAA', viaJson('https', 28)],
    ['JSON http A', viaJson('http', 1)],
    ['JSON http AAAA', viaJson('http', 28)],
  ];
  const results = await Promise.allSettled(queries.map(([, query]) => query));
  results.forEach((result, index) =>
    log(`  ${localAddress} ${queries[index][0]}：${result.status === 'fulfilled' ? result.value.join(', ') || '没有地址' : `失败 ${errorText(result.reason)}`}`),
  );
  return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
}

// 查到的每个地址配上同类（IPv4/IPv6）的每块真实网卡同时试连，NAS 有任何回应（401 也算）就用这条。都不通返回 null。
// 系统解析出的地址也从真实网卡试一次：路由器和本机代理的假地址都在 198.18 网段，拿到的可能是路由器的，本机代理不认，只能绕开它连。
export async function findRoute(probeUrl: string, resolved: string): Promise<Route | null> {
  const hostname = new URL(probeUrl).hostname;
  const locals = physicalAddresses();
  log(`找绕开代理的线路：${hostname} 系统解析为 ${resolved}，真实网卡 ${locals.join(', ') || '没有'}`);
  const looked = await Promise.all(locals.filter((local) => net.isIPv4(local)).map((localAddress) => lookupAddresses(hostname, localAddress)));
  const addresses = new Set([resolved, ...looked.flat()]);
  const routes = locals.flatMap((localAddress) =>
    [...addresses].filter((address) => net.isIP(address) === net.isIP(localAddress)).map((address) => ({ address, localAddress })),
  );
  try {
    const route = await Promise.any(
      routes.map(async (route) => {
        const started = Date.now();
        try {
          const response = await routedFetch(probeUrl, { method: 'PROPFIND', headers: { Depth: '0' }, signal: AbortSignal.timeout(10_000) }, route);
          await response.body?.cancel();
          log(`  ${route.localAddress} → ${route.address}：通，NAS 回应 ${response.status}，${Date.now() - started}ms`);
          return route;
        } catch (error) {
          log(`  ${route.localAddress} → ${route.address}：不通 ${errorText(error)}，${Date.now() - started}ms`);
          throw error;
        }
      }),
    );
    log(`用这条线路：${route.localAddress} → ${route.address}`);
    return route;
  } catch {
    log('都不通');
    return null;
  }
}

export const proxyHint = (hostname: string) =>
  `检测到代理软件（如 Clash）开着虚拟网卡（TUN）模式，NAS 被送去了代理节点。请在代理软件里把 ${hostname} 设为直连（规则 DOMAIN,${hostname},DIRECT），或改用「系统代理」模式`;
