// 最小 WebDAV 客户端：素材库只用到 PROPFIND/GET/PUT/MKCOL/DELETE/LOCK/UNLOCK，用 Node 自带 fetch 实现，不加依赖。

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
};

export async function dav(config: DavConfig, method: string, relativePath: string, options: RequestOptions = {}) {
  let response: Response;
  try {
    response = await fetch(davUrl(config, relativePath), {
      method,
      headers: { Authorization: authHeader(config), ...options.headers },
      body: options.body,
      // 上传文件用流，fetch 要求声明半双工。
      ...(options.body && typeof options.body !== 'string' && !(options.body instanceof Uint8Array) ? { duplex: 'half' } : {}),
    } as RequestInit);
  } catch (error) {
    const reason = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error);
    throw new DavError(`连不上 NAS：${reason}`, 0);
  }
  if (response.ok || options.allow?.includes(response.status)) {
    return response;
  }
  await response.body?.cancel();
  throw new DavError(describeStatus(response.status, method, relativePath), response.status);
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
  const response = await dav(config, 'GET', relativePath, { allow: [404] });
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  return response.text();
}

export async function readBytes(config: DavConfig, relativePath: string): Promise<Buffer> {
  const response = await dav(config, 'GET', relativePath);
  return Buffer.from(await response.arrayBuffer());
}

export async function put(config: DavConfig, relativePath: string, body: DavBody, headers: Record<string, string> = {}) {
  const response = await dav(config, 'PUT', relativePath, { body, headers });
  await response.body?.cancel();
}

export async function remove(config: DavConfig, relativePath: string): Promise<void> {
  const response = await dav(config, 'DELETE', relativePath, { allow: [404] });
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
