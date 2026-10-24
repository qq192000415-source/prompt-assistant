// 一单的排版：位置、大小都按「占这一面边长的比例」记，40/45/50 同一份排版直接换尺寸出图。Node 测试直接加载本文件。
export type ImageLayer = {
  id: string;
  // 原图按 sha256 存在这一单的 sources/ 下。
  sha256: string;
  ext: string;
  width: number;
  height: number;
  // 图片中心在这一面上的位置（0–1）、宽度占边长的比例、顺时针角度。
  cx: number;
  cy: number;
  scale: number;
  rotation: number;
  // 修过的图：买家发来的原图（第一次修之前的那张），保存时一起存。
  originalSha256?: string;
  originalExt?: string;
};

// 文字：中心、角度同图片；字号占这一面边长的比例，描边粗细占字号的比例，生产图按出图尺寸原分辨率画。
export type TextLayer = {
  kind: 'text';
  id: string;
  text: string;
  font: string;
  fontSize: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  bold: boolean;
  cx: number;
  cy: number;
  rotation: number;
};

// 图片没有 kind 字段（1.18 存的排版也是这样）。
export type Layer = ImageLayer | TextLayer;
export const isTextLayer = (layer: Layer): layer is TextLayer => 'kind' in layer && layer.kind === 'text';

export type FaceLayout = { background: string; layers: Layer[] };

export type OrderLayout = {
  productId: string;
  sizeCm: number;
  // same：背面照抄正面；different：两面各排各的。
  facesMode: 'same' | 'different';
  front: FaceLayout;
  back: FaceLayout;
};

export const emptyFace = (): FaceLayout => ({ background: '#ffffff', layers: [] });

// 新放进来的图默认铺满这一面（背景要铺到出血外），超出的部分裁掉；contain 是完整显示。
export function fitLayer(width: number, height: number, mode: 'cover' | 'contain') {
  const ratio = width / height;
  const scale = mode === 'cover' ? Math.max(1, ratio) : Math.min(1, ratio);
  return { cx: 0.5, cy: 0.5, scale, rotation: 0 };
}

export const newTextLayer = (font: string): TextLayer => ({
  kind: 'text',
  id: crypto.randomUUID(),
  text: '文字',
  font,
  fontSize: 0.06,
  color: '#ffffff',
  strokeColor: '#000000',
  strokeWidth: 0.08,
  bold: true,
  cx: 0.5,
  cy: 0.85,
  rotation: 0,
});

// 实际出图用的两面：same 时背面就是正面。
export const facesFor = (layout: OrderLayout): { front: FaceLayout; back: FaceLayout } => ({
  front: layout.front,
  back: layout.facesMode === 'same' ? layout.front : layout.back,
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const SHA256 = /^[0-9a-f]{64}$/;
const EXT = /^\.[a-z0-9]{1,5}$/i;
const COLOR = /^#[0-9a-f]{6}$/i;
const color = (value: unknown, fallback: string) => (COLOR.test(text(value)) ? text(value) : fallback);

function normalizeText(raw: Record<string, unknown>): TextLayer | null {
  if (!text(raw.text).trim()) return null;
  return {
    kind: 'text',
    id: text(raw.id) || crypto.randomUUID(),
    text: text(raw.text),
    font: text(raw.font) || 'Microsoft YaHei',
    fontSize: Math.max(0.005, finite(raw.fontSize, 0.06)),
    color: color(raw.color, '#000000'),
    strokeColor: color(raw.strokeColor, '#ffffff'),
    strokeWidth: Math.max(0, finite(raw.strokeWidth, 0)),
    bold: raw.bold === true,
    cx: finite(raw.cx, 0.5),
    cy: finite(raw.cy, 0.5),
    rotation: finite(raw.rotation, 0),
  };
}

function normalizeLayer(raw: unknown): Layer | null {
  if (isRecord(raw) && raw.kind === 'text') return normalizeText(raw);
  if (!isRecord(raw) || !SHA256.test(text(raw.sha256))) return null;
  const width = finite(raw.width, 0);
  const height = finite(raw.height, 0);
  if (width <= 0 || height <= 0) return null;
  return {
    id: text(raw.id) || text(raw.sha256),
    sha256: text(raw.sha256),
    ext: EXT.test(text(raw.ext)) ? text(raw.ext).toLowerCase() : '.png',
    width,
    height,
    cx: finite(raw.cx, 0.5),
    cy: finite(raw.cy, 0.5),
    scale: Math.max(0.01, finite(raw.scale, 1)),
    rotation: finite(raw.rotation, 0),
    ...(SHA256.test(text(raw.originalSha256)) && EXT.test(text(raw.originalExt)) ? { originalSha256: text(raw.originalSha256), originalExt: text(raw.originalExt).toLowerCase() } : {}),
  };
}

function normalizeFace(raw: unknown): FaceLayout {
  if (!isRecord(raw)) return emptyFace();
  const background = color(raw.background, '#ffffff');
  const layers = Array.isArray(raw.layers) ? raw.layers.map(normalizeLayer).filter((layer): layer is Layer => layer !== null) : [];
  return { background, layers };
}

export function normalizeLayout(raw: unknown): OrderLayout | null {
  if (!isRecord(raw) || !text(raw.productId)) return null;
  return {
    productId: text(raw.productId),
    sizeCm: finite(raw.sizeCm, 40),
    facesMode: raw.facesMode === 'different' ? 'different' : 'same',
    front: normalizeFace(raw.front),
    back: normalizeFace(raw.back),
  };
}

// 两面里所有的图片层（不含文字）。
export const imageLayers = (layout: OrderLayout) => [...layout.front.layers, ...layout.back.layers].filter((layer): layer is ImageLayer => !isTextLayer(layer));

// 这张图按当前大小印出来大约多少 dpi（宽度方向）：原图像素 ÷ 它在生产图上占的像素 × 300。低于 150 印出来会明显发糊。
export const LOW_DPI = 150;
export const printDpi = (layer: ImageLayer, facePx: number) => Math.round((300 * layer.width) / (layer.scale * facePx));
