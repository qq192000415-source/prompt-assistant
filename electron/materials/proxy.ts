// 抓取分享链接时的网络设置：跟随系统代理、直连、自定义代理。只作用在抓取专用会话（linkSession），
// 不影响 Supabase 同步、检查更新和连接 NAS。对应 SuYan 的 proxySettingsStore.ts，那边改的是整个软件的代理。
import fs from 'node:fs';
import path from 'node:path';
import { linkSession } from './linkSession.ts';

export type ProxySettings = { mode: 'system' | 'direct' | 'custom'; url: string };

const DEFAULT: ProxySettings = { mode: 'system', url: '' };
const settingsPath = (userDataDir: string) => path.join(userDataDir, 'materials-proxy.json');

// 测试连通性用的几个常见来源：国内站点和需要代理的海外站点各取一个。
const PROBES = [
  { name: '即梦', url: 'https://jimeng.jianying.com/' },
  { name: 'X（Twitter）', url: 'https://x.com/' },
  { name: 'aiart.pics', url: 'https://aiart.pics/' },
];

export function normalizeProxySettings(input: unknown): ProxySettings {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const mode = raw.mode === 'direct' || raw.mode === 'custom' ? raw.mode : 'system';
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (mode === 'custom' && !/^(https?|socks5?):\/\/[^\s/]+:\d+\/?$/i.test(url)) {
    throw new Error('自定义代理地址要写成 http://127.0.0.1:7890 或 socks5://127.0.0.1:7890 这样');
  }
  return { mode, url: mode === 'custom' ? url.replace(/\/$/, '') : url };
}

export function readProxySettings(userDataDir: string): ProxySettings {
  try {
    return normalizeProxySettings(JSON.parse(fs.readFileSync(settingsPath(userDataDir), 'utf8')));
  } catch {
    return DEFAULT;
  }
}

export async function applyProxySettings(settings: ProxySettings) {
  const session = linkSession();
  if (settings.mode === 'direct') await session.setProxy({ mode: 'direct' });
  else if (settings.mode === 'custom') await session.setProxy({ proxyRules: settings.url });
  else await session.setProxy({ mode: 'system' });
  await session.closeAllConnections();
}

export async function saveProxySettings(userDataDir: string, input: unknown) {
  const settings = normalizeProxySettings(input);
  await applyProxySettings(settings);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(settingsPath(userDataDir), JSON.stringify(settings, null, 2));
  return settings;
}

// 用当前设置访问几个站点，告诉用户哪些能连上，便于判断要不要开代理。
export async function testProxy() {
  const session = linkSession();
  return Promise.all(
    PROBES.map(async (probe) => {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await session.fetch(probe.url, { method: 'HEAD', signal: controller.signal });
        return { name: probe.name, ok: response.status < 500, detail: `HTTP ${response.status}，${Date.now() - started} 毫秒` };
      } catch (error) {
        return { name: probe.name, ok: false, detail: controller.signal.aborted ? '10 秒内没有响应' : error instanceof Error ? error.message : String(error) };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}
