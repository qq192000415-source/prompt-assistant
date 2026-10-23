// 来图定制的出图（浏览器 canvas）：一面 → 样机效果图、一面 ×2 → 生产长条图。几何在 warp.ts / production.ts。
import type { Point } from '../materials/imageEdit.ts';
import type { FaceLayout } from './layout.ts';
import type { MockupTemplate } from './product.ts';
import { setJpegDpi, stripLayout } from './production.ts';
import { warpGrid } from './warp.ts';

export type Drawable = CanvasImageSource & { width: number; height: number };
export type MockupAssets = { under: Drawable; base: Drawable; over: Drawable | null };

const MESH_STEPS = 40;
export const MAX_PRODUCTION_BYTES = 2 * 1024 * 1024;

function canvas2d(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(`画布创建失败（${width}×${height}），可能是内存不够`);
  return { canvas, ctx };
}

// 画一面：背景色铺满，再按顺序画每张图（中心、宽度比例、顺时针角度）。images 按 sha256 取。
export function renderFace(face: FaceLayout, images: Map<string, Drawable>, size: number): HTMLCanvasElement {
  const { canvas, ctx } = canvas2d(size, size);
  ctx.fillStyle = face.background;
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingQuality = 'high';
  for (const layer of face.layers) {
    const image = images.get(layer.sha256);
    if (!image) throw new Error('有一张图还没读出来，请稍后再试');
    const width = layer.scale * size;
    const height = (width * layer.height) / layer.width;
    ctx.save();
    ctx.translate(layer.cx * size, layer.cy * size);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
    ctx.restore();
  }
  return canvas;
}

// 把源图上的三角形 (s0,s1,s2) 仿射贴到目标三角形 (d0,d1,d2)，目标三角形往外扩半像素，避免格子之间露缝。
function drawTriangle(ctx: CanvasRenderingContext2D, image: Drawable, s: [Point, Point, Point], d: [Point, Point, Point]) {
  const [s0, s1, s2] = s;
  const [d0, d1, d2] = d;
  const denom = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (Math.abs(denom) < 1e-9) return;
  const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / denom;
  const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / denom;
  const c = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / denom;
  const dd = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / denom;
  const cx = (d0.x + d1.x + d2.x) / 3;
  const cy = (d0.y + d1.y + d2.y) / 3;
  const grow = (p: Point) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * 0.5, y: p.y + (dy / len) * 0.5 };
  };
  const [g0, g1, g2] = [grow(d0), grow(d1), grow(d2)];
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(g0.x, g0.y);
  ctx.lineTo(g1.x, g1.y);
  ctx.lineTo(g2.x, g2.y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, dd, d0.x - a * s0.x - c * s0.y, d0.y - b * s0.x - dd * s0.y);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}

// 效果图：under → base → 变形后的设计图（剪贴到 base、按混合模式叠上去）→ over → 水印。
export function renderMockup(template: MockupTemplate, assets: MockupAssets, face: Drawable, watermark = ''): HTMLCanvasElement {
  const { width, height, smartObject } = template;
  const grid = warpGrid(smartObject, MESH_STEPS);
  const layer = canvas2d(width, height);
  layer.ctx.imageSmoothingQuality = 'high';
  const sw = face.width;
  const sh = face.height;
  const at = (row: number, col: number) => grid[row * (MESH_STEPS + 1) + col];
  const src = (row: number, col: number) => ({ x: (col / MESH_STEPS) * sw, y: (row / MESH_STEPS) * sh });
  for (let row = 0; row < MESH_STEPS; row += 1) {
    for (let col = 0; col < MESH_STEPS; col += 1) {
      drawTriangle(layer.ctx, face, [src(row, col), src(row, col + 1), src(row + 1, col + 1)], [at(row, col), at(row, col + 1), at(row + 1, col + 1)]);
      drawTriangle(layer.ctx, face, [src(row, col), src(row + 1, col + 1), src(row + 1, col)], [at(row, col), at(row + 1, col + 1), at(row + 1, col)]);
    }
  }
  if (template.clipped) {
    layer.ctx.globalCompositeOperation = 'destination-in';
    layer.ctx.drawImage(assets.base, 0, 0);
  }

  const out = canvas2d(width, height);
  out.ctx.drawImage(assets.under, 0, 0);
  out.ctx.drawImage(assets.base, 0, 0);
  out.ctx.globalCompositeOperation = template.blend === 'multiply' ? 'multiply' : 'source-over';
  out.ctx.globalAlpha = template.opacity;
  out.ctx.drawImage(layer.canvas, 0, 0);
  out.ctx.globalCompositeOperation = 'source-over';
  out.ctx.globalAlpha = 1;
  if (assets.over) out.ctx.drawImage(assets.over, 0, 0);
  if (watermark) {
    const fontSize = Math.max(14, Math.round(width / 40));
    out.ctx.font = `${fontSize}px sans-serif`;
    out.ctx.textAlign = 'right';
    out.ctx.textBaseline = 'bottom';
    out.ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    out.ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    out.ctx.lineWidth = Math.max(1, fontSize / 12);
    out.ctx.strokeText(watermark, width - fontSize, height - fontSize);
    out.ctx.fillText(watermark, width - fontSize, height - fontSize);
  }
  return out.canvas;
}

// 生产长条图：白底，正面在上、背面在下，每面顺时针转 90°。
export function renderProduction(front: Drawable, back: Drawable, sizeCm: number): HTMLCanvasElement {
  const strip = stripLayout(sizeCm);
  const { canvas, ctx } = canvas2d(strip.width, strip.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, strip.width, strip.height);
  for (const placement of strip.faces) {
    ctx.save();
    ctx.translate(placement.x + placement.size, placement.y);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(placement.face === 'front' ? front : back, 0, 0, placement.size, placement.size);
    ctx.restore();
  }
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图片编码失败，可能是内存不够'))), type, quality));

// 生产图 JPEG：从 0.92 往下调质量直到不超过 2MB（方果建议 1–2MB，图库文件也在这个范围）；调到 0.6 还超就报错，不悄悄继续降。
export async function encodeProductionJpeg(canvas: HTMLCanvasElement, maxBytes = MAX_PRODUCTION_BYTES): Promise<Uint8Array<ArrayBuffer>> {
  let last = 0;
  for (let quality = 0.92; quality >= 0.6 - 1e-9; quality -= 0.04) {
    const blob = await toBlob(canvas, 'image/jpeg', quality);
    last = blob.size;
    if (blob.size <= maxBytes) return setJpegDpi(new Uint8Array(await blob.arrayBuffer()));
  }
  throw new Error(`生产图压到质量 0.6 还有 ${(last / 1024 / 1024).toFixed(1)}MB，超过 2MB。图案细节太多，请告诉开发者调整上限`);
}

export async function encodeJpeg(canvas: HTMLCanvasElement, quality = 0.9) {
  return new Uint8Array(await (await toBlob(canvas, 'image/jpeg', quality)).arrayBuffer());
}

export async function encodePng(canvas: HTMLCanvasElement) {
  return toBlob(canvas, 'image/png');
}
