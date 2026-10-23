// 来图定制的产品配置（存在定制 NAS 的 products.json，团队共用）。主进程和界面共用，Node 测试直接加载本文件。
import type { Point, Quad } from '../materials/imageEdit.ts';
import type { SmartObjectGeometry } from './warp.ts';

export const PRODUCTS_FILE = 'products.json';

// 智能对象上面的一层：整幅 PNG，出图时按 canvas 的混合模式叠；clipped 的只在 base 范围里。
export type OverLayer = { file: string; blend: OverBlend; opacity: number; clipped: boolean };
export type OverBlend =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'lighter';
const OVER_BLENDS: OverBlend[] = ['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'lighter'];

// 样机：under（智能对象下面全部合成好的底图）+ 变形后的设计图（按 blend 叠上去，clipped 时只在 base.png 的范围里）+ over（上面的层）。
// 图片存在 templates/<产品 id>/ 下；用照片做的样机 under 就是照片本身（under.jpg 等）、没有 base。sample 是示例图，用来出预览。
// 1.18.0 导入的旧模板 under 不含产品层，出图时要先画 base（underIncludesBase=false）。
export type MockupTemplate = {
  width: number;
  height: number;
  smartObject: SmartObjectGeometry;
  blend: 'multiply' | 'normal';
  opacity: number;
  clipped: boolean;
  underFile: string;
  underIncludesBase: boolean;
  over: OverLayer[];
  hasSample: boolean;
};

export type CustomProduct = {
  id: string;
  name: string;
  // 成品边长（cm），方形；生产面按 300dpi 换像素。
  sizes: number[];
  bleedCm: number;
  // 效果图右下角的淡水印，空就不加。
  watermark: string;
  template: MockupTemplate | null;
  updatedAt: string;
};

export type CustomProducts = { schemaVersion: 1; updatedAt: string; products: CustomProduct[] };

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const TEMPLATE_UNDER = /^under\.(png|jpg|webp)$/;
const point = (value: unknown): Point | null => (isRecord(value) && finite(value.x) && finite(value.y) ? { x: value.x, y: value.y } : null);

function normalizeTemplate(raw: unknown): MockupTemplate | null {
  if (!isRecord(raw) || !isRecord(raw.smartObject)) return null;
  const so = raw.smartObject;
  const quad = Array.isArray(so.quad) ? so.quad.map(point) : [];
  const mesh = Array.isArray(so.mesh) ? so.mesh.map(point) : null;
  if (!finite(raw.width) || !finite(raw.height) || !finite(so.width) || !finite(so.height)) return null;
  if (quad.length !== 4 || quad.some((entry) => !entry)) return null;
  if (mesh && (mesh.length !== 16 || mesh.some((entry) => !entry))) return null;
  return {
    width: raw.width,
    height: raw.height,
    smartObject: { width: so.width, height: so.height, quad: quad as Quad, mesh: mesh as Point[] | null },
    blend: raw.blend === 'normal' ? 'normal' : 'multiply',
    opacity: finite(raw.opacity) ? Math.min(1, Math.max(0, raw.opacity)) : 1,
    clipped: raw.clipped !== false,
    underFile: TEMPLATE_UNDER.test(text(raw.underFile)) ? text(raw.underFile) : 'under.png',
    underIncludesBase: raw.underIncludesBase === true,
    over: Array.isArray(raw.over)
      ? raw.over.flatMap((entry) =>
          isRecord(entry) && /^over-\d+\.png$/.test(text(entry.file)) && OVER_BLENDS.includes(entry.blend as OverBlend)
            ? [{ file: text(entry.file), blend: entry.blend as OverBlend, opacity: finite(entry.opacity) ? Math.min(1, Math.max(0, entry.opacity)) : 1, clipped: entry.clipped === true }]
            : [],
        )
      : raw.hasOver === true
        ? [{ file: 'over.png', blend: 'source-over', opacity: 1, clipped: false }]
        : [],
    hasSample: raw.hasSample === true,
  };
}

export function normalizeProduct(raw: unknown): CustomProduct | null {
  if (!isRecord(raw) || !text(raw.id) || !text(raw.name).trim()) return null;
  const sizes = Array.isArray(raw.sizes) ? [...new Set(raw.sizes.filter((size): size is number => finite(size) && size > 0))].sort((a, b) => a - b) : [];
  return {
    id: text(raw.id),
    name: text(raw.name).trim(),
    sizes,
    bleedCm: finite(raw.bleedCm) && raw.bleedCm >= 0 ? raw.bleedCm : 0.5,
    watermark: text(raw.watermark).trim(),
    template: normalizeTemplate(raw.template),
    updatedAt: text(raw.updatedAt),
  };
}

// 读不懂的产品跳过并计数，界面提示下次写入时它们不会被保留。
export function normalizeProducts(raw: unknown): { products: CustomProducts; dropped: number } {
  const source = isRecord(raw) && Array.isArray(raw.products) ? raw.products : [];
  const products = source.map(normalizeProduct).filter((entry): entry is CustomProduct => entry !== null);
  return { products: { schemaVersion: 1, updatedAt: isRecord(raw) ? text(raw.updatedAt) : '', products }, dropped: source.length - products.length };
}
