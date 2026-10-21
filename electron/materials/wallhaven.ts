// 皮肤的壁纸来源之一（1.17.0）：Wallhaven 免费壁纸库（https://wallhaven.cc/help/api）。不用 Key，只搜安全内容（purity=100）。
// 请求走抓取链接的专用会话（代理设置只作用在那里，国内直连可能慢）。缩略图和原图都由主进程下载成 data URL 交给界面，
// 下载原图只按 id 在最近一次搜索结果里找地址，不信界面传来的网址。图片版权归上传者，界面上注明只供个人使用。
// 不依赖 Electron（fetch 由调用方传入），Node 测试能直接加载。

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; arrayBuffer: () => Promise<ArrayBuffer>; headers: { get: (name: string) => string | null } }>;

export type WallhavenItem = { id: string; width: number; height: number; page: string; thumb: string };
type Raw = { id?: unknown; dimension_x?: unknown; dimension_y?: unknown; url?: unknown; path?: unknown; thumbs?: { small?: unknown } };

const API = 'https://wallhaven.cc/api/v1/search';
// 图片只从这两个域名下载
const IMAGE_HOSTS = new Set(['w.wallhaven.cc', 'th.wallhaven.cc']);
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

const imageHostOk = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && IMAGE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
};

export function searchUrl(query: string, orientation: 'landscape' | 'portrait', page: number) {
  const params = new URLSearchParams({
    q: query.trim().slice(0, 100),
    categories: '111',
    purity: '100',
    sorting: query.trim() ? 'relevance' : 'toplist',
    order: 'desc',
    ratios: orientation,
    // 横图至少 1920 宽；竖图做立绘按窗口高度显示，至少 1600 高
    atleast: orientation === 'landscape' ? '1920x1080' : '900x1600',
    page: String(Math.max(1, Math.min(50, Math.floor(page) || 1))),
  });
  return `${API}?${params}`;
}

async function download(fetchImpl: FetchLike, url: string) {
  if (!imageHostOk(url)) throw new Error('图片地址不是 Wallhaven 的');
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`下载图片失败（HTTP ${response.status}）`);
  const type = response.headers.get('content-type') ?? '';
  if (!/^image\/(jpeg|png|webp)/.test(type)) throw new Error('下载到的不是图片');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('图片太大（超过 30MB）');
  return `data:${type.split(';')[0]};base64,${bytes.toString('base64')}`;
}

export function createWallhaven(fetchImpl: FetchLike) {
  // 最近一次搜索结果的原图地址，下载时按 id 查
  const originals = new Map<string, string>();

  return {
    async search(input: { query?: unknown; orientation?: unknown; page?: unknown }) {
      const orientation = input.orientation === 'portrait' ? 'portrait' : 'landscape';
      const response = await fetchImpl(searchUrl(typeof input.query === 'string' ? input.query : '', orientation, Number(input.page) || 1));
      if (response.status === 429) throw new Error('Wallhaven 说请求太频繁了，等一分钟再搜');
      if (!response.ok) throw new Error(`Wallhaven 搜索失败（HTTP ${response.status}），连不上的话在「设置 › 网络」里设代理`);
      const body = (await response.json()) as { data?: Raw[]; meta?: { last_page?: unknown } };
      const rows = (Array.isArray(body.data) ? body.data : []).filter(
        (row) => typeof row.id === 'string' && /^\w{1,20}$/.test(row.id) && typeof row.path === 'string' && imageHostOk(row.path) && typeof row.thumbs?.small === 'string',
      );
      originals.clear();
      for (const row of rows) originals.set(row.id as string, row.path as string);
      // 缩略图一起下好，界面不直接连外网
      const items = await Promise.all(
        rows.map(async (row): Promise<WallhavenItem | null> => {
          try {
            return {
              id: row.id as string,
              width: Number(row.dimension_x) || 0,
              height: Number(row.dimension_y) || 0,
              page: typeof row.url === 'string' && row.url.startsWith('https://wallhaven.cc/') ? row.url : `https://wallhaven.cc/w/${row.id}`,
              thumb: await download(fetchImpl, row.thumbs!.small as string),
            };
          } catch {
            return null;
          }
        }),
      );
      const kept = items.filter((item): item is WallhavenItem => item !== null);
      // 缩略图没下下来的告诉界面有几张，不悄悄少几张
      return { items: kept, failed: items.length - kept.length, lastPage: Number(body.meta?.last_page) || 1 };
    },
    async image(id: unknown) {
      const url = typeof id === 'string' ? originals.get(id) : undefined;
      if (!url) throw new Error('找不到这张图，重新搜一下再选');
      return download(fetchImpl, url);
    },
  };
}
