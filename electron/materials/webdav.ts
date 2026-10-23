// 最小 WebDAV 客户端：素材库只用到 PROPFIND/GET/PUT/MKCOL/DELETE/LOCK/UNLOCK，用 Node 自带 fetch 实现，不加依赖。
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { findRoute, isFakeIp, logRoute, proxyHint, routedFetch, systemAddress } from './proxyBypass.ts';
import type { Route } from './proxyBypass.ts';

export type DavConfig = {
  baseUrl: string;
  username: string;
  password: string;
};

export type DavBody = NonNullable<RequestInit['body']>;

export class DavError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// 统一成以 / 结尾，后面拼相对路径时不会吃掉最后一级目录。
export function normalizeBaseUrl(input: string): string {
  const url = new URL(input.trim());
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('WebDAV 地址要以 https:// 开头');
  }
  url.hash = '';
  url.search = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.toString();
}

export function davUrl(config: Pick<DavConfig, 'baseUrl'>, relativePath: string): string {
  const encoded = relativePath
    .split('/')
    .map((segment) => (segment ? encodeURIComponent(segment) : segment))
    .join('/');
  return new URL(encoded, normalizeBaseUrl(config.baseUrl)).toString();
}

const authHeader = (config: DavConfig) =>
  `Basic ${Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64')}`;

function describeStatus(status: number, method: string, relativePath: string): string {
  if (status === 401) return 'NAS 用户名或密码不对';
  if (status === 403) return `NAS 拒绝了这次操作（${method} ${relativePath || '/'}），检查账户对素材文件夹有没有读写权限`;
  if (status === 404) return `NAS 上找不到 ${relativePath || '素材文件夹'}`;
  if (status === 423) return '另一台电脑正在修改素材库';
  if (status === 507) return 'NAS 空间不足';
  return `NAS 返回错误 ${status}（${method} ${relativePath || '/'}）`;
}

type RequestOptions = {
  headers?: Record<string, string>;
  body?: DavBody;
  // 4xx 里哪些算正常结果，由调用方自己处理。
  allow?: number[];
  // 超时：默认按 requestTimeoutMs 算。includeBody 时连读响应内容一起算（只用于 JSON、图片这类小文件）；
  // 否则响应头到了就不再计时，大视频下载、nas-media 播放不受限。
  timeoutMs?: number;
  includeBody?: boolean;
};

// NAS 卡住时请求必须失败，不能一直等：之前没有超时，画布存生成历史时卡住会一直占着队列的位置。
// 等响应最多 60 秒；上传时 NAS 收完整个文件才回应，按最慢 50KB/s 再加上传时间。
const RESPONSE_TIMEOUT_MS = 60_000;
const SLOWEST_UPLOAD_BYTES_PER_SECOND = 50 * 1024;

export function requestTimeoutMs(body: DavBody | undefined, headers: Record<string, string> = {}) {
  const size = typeof body === 'string' ? Buffer.byteLength(body) : body instanceof Uint8Array ? body.byteLength : Number(headers['Content-Length'] ?? 0) || 0;
  return RESPONSE_TIMEOUT_MS + Math.ceil((size / SLOWEST_UPLOAD_BYTES_PER_SECOND) * 1000);
}

const timeoutError = (seconds: number, method: string, relativePath: string) =>
  new DavError(`NAS ${seconds} 秒没有响应（${method} ${relativePath || '/'}），可能是 NAS 或网络卡住了，稍后再试`, 0);

// 连不上、超时，或 NAS 前面的反向代理说后面不通（502–504）才算断开；401、404 这类是连上了。
export const isUnreachable = (error: unknown) => error instanceof DavError && (error.status === 0 || (error.status >= 502 && error.status <= 504));

// 每个请求通没通报给 NAS 连接状态（nasMonitor.ts）；Node 测试里不设，什么都不做。
let reachability: (ok: boolean, error: string) => void = () => undefined;
export const setReachabilityListener = (listener: (ok: boolean, error: string) => void) => {
  reachability = listener;
};

export async function dav(config: DavConfig, method: string, relativePath: string, options: RequestOptions = {}) {
  try {
    const response = await request(config, method, relativePath, options);
    reachability(true, '');
    return response;
  } catch (error) {
    if (isUnreachable(error)) reachability(false, (error as DavError).message);
    else if (error instanceof DavError) reachability(true, '');
    throw error;
  }
}

// 绕开代理虚拟网卡的线路，按 NAS 主机名记（proxyBypass.ts）；同一主机同时只找一次。
const routes = new Map<string, Route>();
const finding = new Map<string, Promise<Route | null>>();
const isStream = (body: DavBody | undefined) => !!body && typeof body !== 'string' && !(body instanceof Uint8Array);

async function request(config: DavConfig, method: string, relativePath: string, options: RequestOptions) {
  const hostname = new URL(config.baseUrl).hostname;
  const route = routes.get(hostname);
  try {
    return await send(config, method, relativePath, options, route);
  } catch (error) {
    if (!(error instanceof DavError) || error.status !== 0) throw error;
    // 绕开的线路也不通了（换了网络、关了代理）：下次照常连，还不通再重新找。
    if (route) {
      routes.delete(hostname);
      logRoute(`绕开的线路 ${route.localAddress} → ${route.address} 不通了（${error.message}），下次照常连`);
      throw error;
    }
    const resolved = await systemAddress(hostname);
    if (!resolved || !isFakeIp(resolved)) throw error;
    let pending = finding.get(hostname);
    if (!pending) {
      logRoute(`照常连不上：${error.message}`);
      pending = findRoute(normalizeBaseUrl(config.baseUrl), resolved).finally(() => finding.delete(hostname));
      finding.set(hostname, pending);
    }
    const found = await pending;
    if (!found) throw new DavError(`${error.message}。${proxyHint(hostname)}`, 0);
    routes.set(hostname, found);
    // 流式上传的内容已经读掉了，不能重发：报原来的错，下一个请求就走新线路。
    if (isStream(options.body)) throw error;
    return send(config, method, relativePath, options, found);
  }
}

async function send(config: DavConfig, method: string, relativePath: string, options: RequestOptions, route: Route | undefined) {
  const timeoutMs = options.timeoutMs ?? requestTimeoutMs(options.body, options.headers);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // 计时器到点只是取消请求，不让它拖住进程退出。
  timer.unref?.();
  let response: Response;
  try {
    const url = davUrl(config, relativePath);
    const headers = { Authorization: authHeader(config), ...options.headers };
    response = route
      ? await routedFetch(url, { method, headers, body: options.body, signal: controller.signal }, route)
      : await fetch(url, {
          method,
          headers,
          body: options.body,
          signal: controller.signal,
          // 上传文件用流，fetch 要求声明半双工。
          ...(isStream(options.body) ? { duplex: 'half' } : {}),
        } as RequestInit);
  } catch (error) {
    clearTimeout(timer);
    if (controller.signal.aborted) throw timeoutError(Math.round(timeoutMs / 1000), method, relativePath);
    const reason = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error);
    throw new DavError(`连不上 NAS：${reason}`, 0);
  }
  if (!options.includeBody) clearTimeout(timer);
  if (response.ok || options.allow?.includes(response.status)) {
    return response;
  }
  clearTimeout(timer);
  await response.body?.cancel();
  throw new DavError(describeStatus(response.status, method, relativePath), response.status);
}

// 读响应内容时超时（includeBody 的请求）也报成 NAS 没有响应。
async function readBody<T>(read: Promise<T>, method: string, relativePath: string, timeoutMs: number): Promise<T> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw timeoutError(Math.round(timeoutMs / 1000), method, relativePath);
    throw error;
  }
}

export async function exists(config: DavConfig, relativePath: string): Promise<boolean> {
  const response = await dav(config, 'PROPFIND', relativePath, { headers: { Depth: '0' }, allow: [404] });
  await response.body?.cancel();
  return response.status !== 404;
}

// 文件夹已存在时服务器回 405，也算成功。
export async function ensureFolder(config: DavConfig, relativePath: string): Promise<void> {
  const response = await dav(config, 'MKCOL', relativePath, { allow: [405] });
  await response.body?.cancel();
}

export async function readText(config: DavConfig, relativePath: string): Promise<string | null> {
  const response = await dav(config, 'GET', relativePath, { allow: [404], includeBody: true });
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  return readBody(response.text(), 'GET', relativePath, RESPONSE_TIMEOUT_MS);
}

// 图片这类整个读进内存的文件：连内容一起最多 5 分钟。
const READ_BYTES_TIMEOUT_MS = 5 * 60_000;
export async function readBytes(config: DavConfig, relativePath: string): Promise<Buffer> {
  const response = await dav(config, 'GET', relativePath, { includeBody: true, timeoutMs: READ_BYTES_TIMEOUT_MS });
  return Buffer.from(await readBody(response.arrayBuffer(), 'GET', relativePath, READ_BYTES_TIMEOUT_MS));
}

// 大文件（视频、导出）直接流到磁盘，不整个读进内存。
export async function downloadToFile(config: DavConfig, relativePath: string, target: string): Promise<void> {
  const response = await dav(config, 'GET', relativePath);
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), fs.createWriteStream(target));
}

export async function put(config: DavConfig, relativePath: string, body: DavBody, headers: Record<string, string> = {}) {
  const response = await dav(config, 'PUT', relativePath, { body, headers });
  await response.body?.cancel();
}

export async function remove(config: DavConfig, relativePath: string): Promise<void> {
  const response = await dav(config, 'DELETE', relativePath, { allow: [404] });
  await response.body?.cancel();
}

// 同一台 NAS 上改位置（文件夹整个搬），不复制内容。目标已存在时不覆盖，服务器回 412，按出错处理。
export async function move(config: DavConfig, fromPath: string, toPath: string): Promise<void> {
  const response = await dav(config, 'MOVE', fromPath, { headers: { Destination: davUrl(config, toPath), Overwrite: 'F' } });
  await response.body?.cancel();
}

const LOCK_BODY =
  '<?xml version="1.0" encoding="utf-8"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>';

// 返回锁令牌；别人持有锁时返回 null。服务器在 seconds 秒后自动释放，程序崩溃也不会永久锁死。
export async function lock(config: DavConfig, relativePath: string, seconds: number): Promise<string | null> {
  const response = await dav(config, 'LOCK', relativePath, {
    headers: { Timeout: `Second-${seconds}`, 'Content-Type': 'application/xml; charset=utf-8' },
    body: LOCK_BODY,
    allow: [423],
  });
  await response.body?.cancel();
  if (response.status === 423) return null;
  const token = response.headers.get('lock-token')?.trim();
  if (!token) {
    throw new DavError('NAS 加锁成功但没有返回锁令牌，无法安全写入', response.status);
  }
  return token.startsWith('<') ? token : `<${token}>`;
}

export async function unlock(config: DavConfig, relativePath: string, token: string): Promise<void> {
  const response = await dav(config, 'UNLOCK', relativePath, { headers: { 'Lock-Token': token }, allow: [404, 409] });
  await response.body?.cancel();
}
