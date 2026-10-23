// 来图定制在定制 NAS 上的读写：products.json（产品配置）、templates/<产品 id>/（样机图层）、orders/<单名>/（原图、每一版的排版和成品）。
// JSON 一律走 mutateJsonFile 加锁（fnOS 不认 If-Match）。不依赖 Electron，Node 测试可直接加载。
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mutateJsonFile } from './libraryStore.ts';
import * as webdav from './webdav.ts';
import type { DavConfig } from './webdav.ts';
import { PRODUCTS_FILE, normalizeProducts, type CustomProduct, type CustomProducts, type MockupTemplate } from '../../src/custom/product.ts';
import { warpedBounds } from '../../src/custom/warp.ts';
import type { Point } from '../../src/materials/imageEdit.ts';
import { normalizeLayout, type OrderLayout } from '../../src/custom/layout.ts';
import { parseMockupPsd, type Rgba } from './customPsd.ts';

export type ProductInput = { id?: string; name: string; sizes: number[]; bleedCm: number; watermark: string };

const parseProducts = (content: string | null) => {
  if (content === null || !content.trim()) return { data: normalizeProducts(null).products, dropped: 0 };
  try {
    const { products, dropped } = normalizeProducts(JSON.parse(content));
    return { data: products, dropped };
  } catch {
    throw new Error('定制 NAS 上的 products.json 读不懂，为了不覆盖它，这次没有保存');
  }
};

export async function readProducts(config: DavConfig) {
  const { data, dropped } = parseProducts(await webdav.readText(config, PRODUCTS_FILE));
  return { products: data.products, dropped };
}

function mutateProducts<T>(config: DavConfig, change: (data: CustomProducts) => { data: CustomProducts; result: T }) {
  return mutateJsonFile(config, PRODUCTS_FILE, parseProducts, change, '定制产品配置');
}

export async function saveProduct(config: DavConfig, input: ProductInput) {
  const name = input.name.trim();
  if (!name) throw new Error('产品名称不能为空');
  const sizes = [...new Set(input.sizes.filter((size) => Number.isFinite(size) && size > 0))].sort((a, b) => a - b);
  if (!sizes.length) throw new Error('至少要有一个尺寸');
  const now = new Date().toISOString();
  const { result } = await mutateProducts(config, (data) => {
    const existing = input.id ? data.products.find((product) => product.id === input.id) : undefined;
    if (input.id && !existing) throw new Error('这个产品已经被别人删掉了');
    const product: CustomProduct = {
      id: existing?.id ?? randomUUID(),
      name,
      sizes,
      bleedCm: Number.isFinite(input.bleedCm) && input.bleedCm >= 0 ? input.bleedCm : 0.5,
      watermark: input.watermark.trim(),
      template: existing?.template ?? null,
      updatedAt: now,
    };
    const products = existing ? data.products.map((entry) => (entry.id === product.id ? product : entry)) : [...data.products, product];
    return { data: { ...data, updatedAt: now, products }, result: product };
  });
  return result;
}

// ---- PNG：样机图层是整幅 RGBA，自己编码，不经过 nativeImage（它要预乘 alpha，抱枕边缘会发黑）。
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type: string, data: Uint8Array) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
export function encodePng({ width, height, data }: Rgba): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 位
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

export const templateDir = (productId: string) => `templates/${productId}/`;
const SAMPLE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
const extOf = (name: string) => (name.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();

function setTemplate(config: DavConfig, productId: string, template: MockupTemplate) {
  const now = new Date().toISOString();
  return mutateProducts(config, (data) => {
    const product = data.products.find((entry) => entry.id === productId);
    if (!product) throw new Error('这个产品已经被别人删掉了，样机没有保存');
    const updated = { ...product, template, updatedAt: now };
    return { data: { ...data, updatedAt: now, products: data.products.map((entry) => (entry.id === productId ? updated : entry)) }, result: updated };
  });
}

const png = { 'Content-Type': 'image/png' };

// 导入样机 PSD：解析 → 图层传到 templates/<id>/ → 产品配置里记下几何。图层先传完再改配置，中途失败不会留下指向不存在文件的模板。
export async function importMockupPsd(config: DavConfig, productId: string, psd: Uint8Array) {
  const parsed = parseMockupPsd(psd);
  const dir = templateDir(productId);
  await webdav.ensureFolder(config, 'templates/');
  await webdav.ensureFolder(config, dir);
  await webdav.put(config, `${dir}under.png`, encodePng(parsed.under), png);
  if (parsed.base) await webdav.put(config, `${dir}base.png`, encodePng(parsed.base), png);
  for (const [index, layer] of parsed.template.over.entries()) await webdav.put(config, `${dir}${layer.file}`, encodePng(parsed.over[index]), png);
  // 示例图是 PSD 里智能对象原本放的图，统一存成 sample 加原扩展名；不认识的格式就不存，预览时让人自己放图。
  const sampleExt = parsed.sample ? extOf(parsed.sample.name) : '';
  const sample = parsed.sample && SAMPLE_EXTS.includes(sampleExt) ? parsed.sample : null;
  if (sample) await webdav.put(config, `${dir}sample${sampleExt === '.jpeg' ? '.jpg' : sampleExt}`, Buffer.from(sample.data));
  const { result } = await setTemplate(config, productId, { ...parsed.template, hasSample: Boolean(sample) });
  return { product: result, sampleExt: sample ? (sampleExt === '.jpeg' ? '.jpg' : sampleExt) : null };
}

// 用照片做样机：照片原样存成 under.<扩展名>，网格控制点（样机像素坐标，行优先 16 个）直接就是贴图位置，光影靠正片叠底取照片本身。
export async function savePhotoTemplate(config: DavConfig, productId: string, input: { bytes: Uint8Array; ext: string; width: number; height: number; mesh: Point[] }) {
  const ext = input.ext.toLowerCase() === '.jpeg' ? '.jpg' : input.ext.toLowerCase();
  if (!['.jpg', '.png', '.webp'].includes(ext)) throw new Error('样机照片只支持 JPG、PNG、WebP');
  if (!(input.width > 0 && input.height > 0)) throw new Error('照片尺寸读不出来');
  if (input.mesh.length !== 16 || input.mesh.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new Error('网格控制点不完整');
  const dir = templateDir(productId);
  await webdav.ensureFolder(config, 'templates/');
  await webdav.ensureFolder(config, dir);
  await webdav.put(config, `${dir}under${ext}`, Buffer.from(input.bytes));
  const { minX, minY, maxX, maxY } = warpedBounds(input.mesh);
  const template: MockupTemplate = {
    width: input.width,
    height: input.height,
    // 四角就取网格曲面的外框，makeWarp 里「外框 → 四角」是恒等映射，控制点原样使用。
    smartObject: {
      width: input.width,
      height: input.height,
      quad: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ],
      mesh: input.mesh.map(({ x, y }) => ({ x, y })),
    },
    blend: 'multiply',
    opacity: 1,
    clipped: false,
    underFile: `under${ext}`,
    underIncludesBase: true,
    over: [],
    hasSample: false,
  };
  const { result } = await setTemplate(config, productId, template);
  return result;
}

// 模板里的文件名只允许这几个，防止拿任意路径去读 NAS。
const TEMPLATE_FILES = /^under\.(png|jpg|webp)$|^base\.png$|^over(-\d+)?\.png$|^sample\.(jpg|png|webp)$/;
export async function readTemplateFile(config: DavConfig, productId: string, file: string) {
  if (!/^[0-9a-f-]{36}$/.test(productId) || !TEMPLATE_FILES.test(file)) throw new Error('模板文件名不对');
  return webdav.readBytes(config, `${templateDir(productId)}${file}`);
}

// ---- 订单：orders/<单名>/order.json 记版本号，sources/ 放原图（按 sha256，各版共用），v<n>/ 放这一版的排版和成品。
export type OrderIndex = { schemaVersion: 1; name: string; versions: number; updatedAt: string };
export type OrderFile = { name: string; bytes: Uint8Array };
export type OrderSource = { sha256: string; ext: string; bytes: Uint8Array };

export function orderFolder(name: string) {
  const clean = name.trim().replace(/[\\/:*?"<>|]/g, '_');
  if (!clean || clean === '.' || clean === '..') throw new Error('单名不能为空');
  return `orders/${clean}/`;
}

const parseOrderIndex = (name: string) => (content: string | null) => {
  if (content === null || !content.trim()) return { data: { schemaVersion: 1 as const, name, versions: 0, updatedAt: '' }, dropped: 0 };
  try {
    const raw = JSON.parse(content) as Partial<OrderIndex>;
    return { data: { schemaVersion: 1 as const, name, versions: Number.isInteger(raw.versions) && raw.versions! > 0 ? raw.versions! : 0, updatedAt: String(raw.updatedAt ?? '') }, dropped: 0 };
  } catch {
    throw new Error(`单「${name}」的 order.json 读不懂，为了不覆盖它，这次没有保存`);
  }
};

const OUTPUT_NAME = /^[^\\/:*?"<>|]+\.(jpg|png)$/;

// 存一版：先占版本号，再传原图（已有的跳过）、排版和成品；返回这一版的版本号和文件夹。
export async function saveOrderVersion(config: DavConfig, input: { name: string; layout: OrderLayout; sources: OrderSource[]; outputs: OrderFile[] }) {
  const layout = normalizeLayout(input.layout);
  if (!layout) throw new Error('排版数据不完整，没有保存');
  for (const output of input.outputs) if (!OUTPUT_NAME.test(output.name)) throw new Error(`文件名「${output.name}」不对`);
  const folder = orderFolder(input.name);
  const needed = new Set([...layout.front.layers, ...layout.back.layers].map((layer) => `${layer.sha256}${layer.ext}`));
  const provided = new Map(input.sources.map((source) => [`${source.sha256}${source.ext}`, source]));
  // 排版里用到、这次又没带上的原图，必须是以前存过的；否则这一版打开会缺图，先报错再占版本号。
  for (const file of needed) {
    if (!provided.has(file) && !(await webdav.exists(config, `${folder}sources/${file}`))) throw new Error('有一张原图没有传上来，这一版没有保存，请重新放一次图');
  }
  await webdav.ensureFolder(config, 'orders/');
  await webdav.ensureFolder(config, folder);
  await webdav.ensureFolder(config, `${folder}sources/`);
  const now = new Date().toISOString();
  const { result: version } = await mutateJsonFile(
    config,
    `${folder}order.json`,
    parseOrderIndex(input.name.trim()),
    (data) => ({ data: { ...data, versions: data.versions + 1, updatedAt: now }, result: data.versions + 1 }),
    `单「${input.name.trim()}」的版本记录`,
  );
  const versionDir = `${folder}v${version}/`;
  await webdav.ensureFolder(config, versionDir);
  for (const [file, source] of provided) {
    if (!needed.has(file)) continue;
    const target = `${folder}sources/${file}`;
    if (!(await webdav.exists(config, target))) await webdav.put(config, target, Buffer.from(source.bytes));
  }
  await webdav.put(config, `${versionDir}layout.json`, JSON.stringify({ ...layout, savedAt: now }, null, 2), { 'Content-Type': 'application/json; charset=utf-8' });
  for (const output of input.outputs) await webdav.put(config, `${versionDir}${output.name}`, Buffer.from(output.bytes));
  return { version, folder: versionDir };
}
