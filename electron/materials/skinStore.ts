// 皮肤包（src/skins/skinPack.ts 的格式）落盘：装到 <userData>/skins/<id>/，用 skin://<id>/<文件> 给界面读，能导出成 zip、删除。
// 皮肤包来自别人，所有文件名、大小、manifest 都在这里查过才落盘，界面拿到的只是校验过的 manifest 和图标文件名。
// 不依赖 Electron，Node 测试能直接加载；IPC 和对话框在 skins.ts。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { skinIconNames, validateSkinManifest, type SkinManifest } from '../../src/skins/skinPack.ts';

export const SKIN_SCHEME = 'skin';
const ID_PATTERN = /^[a-z0-9-]{1,40}$/;
const ROOT_FILE_PATTERN = /^[a-z0-9_-]{1,60}\.(webp|png|jpg|jpeg)$/;
const ICON_PATTERN = /^icons\/[a-z0-9-]{1,60}\.(svg|png)$/;
export const LIMITS = { pack: 20 * 1024 * 1024, image: 8 * 1024 * 1024, icon: 200 * 1024, icons: 300 };

export type InstalledSkin = { manifest: SkinManifest; icons: string[] };

const skinsDir = (userDataDir: string) => path.join(userDataDir, 'skins');

export const checkSkinId = (id: unknown) => {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new Error('皮肤 id 不合法');
  return id;
};

const MIME: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml' };

// 校验 zip 里的文件，返回 { 包内路径: 内容 }。manifest.json 可以在根目录，也可以在唯一的一层文件夹里（直接压缩文件夹时常见）。
export async function readSkinZip(bytes: Uint8Array): Promise<{ manifest: SkinManifest; files: Map<string, Uint8Array> }> {
  if (bytes.byteLength > LIMITS.pack) throw new Error(`皮肤包超过 ${LIMITS.pack / 1024 / 1024}MB`);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error('不是有效的 zip 文件');
  }
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  let prefix = '';
  if (!zip.files['manifest.json']) {
    const nested = entries.filter((entry) => /^[^/]+\/manifest\.json$/.test(entry.name));
    if (nested.length !== 1) throw new Error('皮肤包里找不到 manifest.json');
    prefix = nested[0].name.slice(0, -'manifest.json'.length);
  }
  const files = new Map<string, Uint8Array>();
  let icons = 0;
  for (const entry of entries) {
    if (!entry.name.startsWith(prefix)) throw new Error(`皮肤包里有多余的文件：${entry.name}`);
    const name = entry.name.slice(prefix.length);
    const isIcon = ICON_PATTERN.test(name);
    if (name !== 'manifest.json' && !isIcon && !ROOT_FILE_PATTERN.test(name)) {
      throw new Error(`皮肤包里的文件 ${name} 不合法：只能有 manifest.json、根目录的图片（webp/png/jpg）和 icons/ 下的 svg/png`);
    }
    const content = await entry.async('uint8array');
    const limit = isIcon ? LIMITS.icon : name === 'manifest.json' ? 64 * 1024 : LIMITS.image;
    if (content.byteLength > limit) throw new Error(`皮肤包里的 ${name} 太大（上限 ${Math.round(limit / 1024)}KB）`);
    if (isIcon && ++icons > LIMITS.icons) throw new Error(`皮肤包里的图标超过 ${LIMITS.icons} 个`);
    files.set(name, content);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(files.get('manifest.json')));
  } catch {
    throw new Error('manifest.json 不是合法的 JSON');
  }
  const manifest = validateSkinManifest(raw);
  for (const needed of [manifest.preview, manifest.wallpaper?.file]) {
    if (needed && !files.has(needed)) throw new Error(`皮肤包缺少 manifest 里写的文件 ${needed}`);
  }
  return { manifest, files };
}

// reservedIds 是内置皮肤的 id：安装的包不能占用，否则两边谁生效说不清。
export async function installSkin(userDataDir: string, bytes: Uint8Array, reservedIds: string[]) {
  const { manifest, files } = await readSkinZip(bytes);
  if (reservedIds.includes(manifest.id)) throw new Error(`皮肤 id「${manifest.id}」和内置皮肤重名，请换一个 id`);
  const root = skinsDir(userDataDir);
  const target = path.join(root, manifest.id);
  const staging = path.join(root, `.${manifest.id}-${process.pid}-${Date.now()}`);
  fs.mkdirSync(path.join(staging, 'icons'), { recursive: true });
  try {
    for (const [name, content] of files) fs.writeFileSync(path.join(staging, name), content);
    const replaced = fs.existsSync(target);
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(staging, target);
    return { manifest, replaced };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

// 列出已安装的皮肤。校验不过的（比如手动改坏了）放进 errors 告诉用户，不悄悄跳过。
export function listSkins(userDataDir: string) {
  const skins: InstalledSkin[] = [];
  const errors: Array<{ id: string; message: string }> = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(skinsDir(userDataDir)).filter((name) => !name.startsWith('.'));
  } catch {
    return { skins, errors };
  }
  for (const id of names.sort()) {
    const dir = path.join(skinsDir(userDataDir), id);
    try {
      const manifest = validateSkinManifest(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')));
      if (manifest.id !== id) throw new Error(`文件夹名和 manifest 的 id（${manifest.id}）不一致`);
      for (const needed of [manifest.preview, manifest.wallpaper?.file]) {
        if (needed && !fs.existsSync(path.join(dir, needed))) throw new Error(`缺少文件 ${needed}`);
      }
      let icons: string[] = [];
      try {
        icons = fs.readdirSync(path.join(dir, 'icons')).map((name) => `icons/${name}`);
      } catch {}
      skinIconNames(icons);
      skins.push({ manifest, icons });
    } catch (error) {
      errors.push({ id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { skins, errors };
}

export function removeSkin(userDataDir: string, id: unknown) {
  fs.rmSync(path.join(skinsDir(userDataDir), checkSkinId(id)), { recursive: true, force: true });
}

export async function exportSkin(userDataDir: string, id: unknown) {
  const dir = path.join(skinsDir(userDataDir), checkSkinId(id));
  const zip = new JSZip();
  for (const name of fs.readdirSync(dir)) {
    if (name === 'icons') continue;
    zip.file(name, fs.readFileSync(path.join(dir, name)));
  }
  if (fs.existsSync(path.join(dir, 'icons'))) {
    for (const name of fs.readdirSync(path.join(dir, 'icons'))) zip.file(`icons/${name}`, fs.readFileSync(path.join(dir, 'icons', name)));
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// skin://<id>/<文件>：只给已安装皮肤里合法的文件名，别的一律 404。
export function handleSkinRequest(userDataDir: string) {
  return (request: Request) => {
    const url = new URL(request.url);
    const id = url.hostname;
    const name = decodeURIComponent(url.pathname).replace(/^\//, '');
    if (!ID_PATTERN.test(id) || !(ROOT_FILE_PATTERN.test(name) || ICON_PATTERN.test(name))) return new Response('not found', { status: 404 });
    try {
      const content = fs.readFileSync(path.join(skinsDir(userDataDir), id, name));
      return new Response(content, { headers: { 'Content-Type': MIME[name.split('.').pop() ?? ''] ?? 'application/octet-stream' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  };
}

// ---------- 主题市场：仓库 themes/ 由 scripts/build-theme-index.cjs 生成 index.json 和 dist/<id>.zip、dist/<id>.<图>，
// 镜像在 UPDATE_BASE_URL/themes/，GitHub 上是同样的相对路径。先读镜像，读不到再读 GitHub。

export type MarketTheme = { id: string; name: string; note: string; author: string; version: string; base: 'light' | 'dark'; size: number; sha256: string; preview: string };
type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

const marketText = (value: unknown, max: number) => (typeof value === 'string' && value.length <= max ? value : null);

// 市场索引里每一条都单独查，坏掉的那条放进 errors，不连累别的。
export function parseMarketIndex(raw: unknown) {
  const themes: MarketTheme[] = [];
  const errors: string[] = [];
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { themes?: unknown }).themes) ? (raw as { themes: unknown[] }).themes : null;
  if (!list) throw new Error('主题市场的索引格式不对');
  for (const entry of list) {
    const item = (entry ?? {}) as Record<string, unknown>;
    const id = typeof item.id === 'string' && ID_PATTERN.test(item.id) ? item.id : null;
    const theme = id && {
      id,
      name: marketText(item.name, 20),
      note: marketText(item.note ?? '', 40),
      author: marketText(item.author, 40),
      version: marketText(item.version, 20),
      base: item.base === 'light' || item.base === 'dark' ? item.base : null,
      size: typeof item.size === 'number' && item.size > 0 && item.size <= LIMITS.pack ? item.size : null,
      sha256: typeof item.sha256 === 'string' && /^[0-9a-f]{64}$/.test(item.sha256) ? item.sha256 : null,
      preview: typeof item.preview === 'string' && new RegExp(`^dist/${id}\\.(webp|png|jpg|jpeg)$`).test(item.preview) ? item.preview : null,
    };
    if (theme && Object.values(theme).every((value) => value !== null)) themes.push(theme as MarketTheme);
    else errors.push(`市场里的「${typeof item.id === 'string' ? item.id : '?'}」信息不全，没有列出`);
  }
  return { themes, errors };
}

// sources 是几个 themes/ 目录地址（结尾带 /），按顺序试，全都不通才报错，并写明每个为什么不通。
export async function fetchMarketIndex(sources: string[], fetchImpl: FetchLike) {
  const failures: string[] = [];
  for (const base of sources) {
    try {
      const response = await fetchImpl(`${base}index.json`, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { base, ...parseMarketIndex(await response.json()) };
    } catch (error) {
      failures.push(`${new URL(base).host}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`主题市场连不上（${failures.join('；')}）`);
}

// 下载并核对大小和 SHA256，对不上就不装。
export async function downloadMarketTheme(base: string, theme: MarketTheme, fetchImpl: FetchLike) {
  const response = await fetchImpl(`${base}dist/${theme.id}.zip`, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`下载「${theme.name}」失败：HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (bytes.byteLength !== theme.size || sha256 !== theme.sha256) {
    throw new Error(`「${theme.name}」下载的文件和市场里登记的对不上（大小或校验值不同），可能没下完整或被改过，没有安装`);
  }
  return bytes;
}
