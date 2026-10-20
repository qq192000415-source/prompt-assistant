// 参考图编辑的纯逻辑：裁剪框拖动、透视变换（单应矩阵）和按四边形重采样。界面在 ReferenceEditor.tsx，Node 测试直接加载本文件。
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
// 四角顺序：左上、右上、右下、左下。
export type Quad = [Point, Point, Point, Point];
export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const MIN_CROP = 8;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// 角上的手柄：对角固定，跟着指针拉框；锁比例时按比例收，并且不出图。从空白处新拉一个框也走这里（锚点是按下的位置）。
export function cropFromAnchor(anchor: Point, pointer: Point, ratio: number | null, width: number, height: number): Rect {
  const px = clamp(pointer.x, 0, width);
  const py = clamp(pointer.y, 0, height);
  const dirX = px >= anchor.x ? 1 : -1;
  const dirY = py >= anchor.y ? 1 : -1;
  let w = Math.max(MIN_CROP, Math.abs(px - anchor.x));
  let h = Math.max(MIN_CROP, Math.abs(py - anchor.y));
  const maxW = dirX > 0 ? width - anchor.x : anchor.x;
  const maxH = dirY > 0 ? height - anchor.y : anchor.y;
  if (ratio) {
    if (w / h > ratio) w = h * ratio;
    else h = w / ratio;
    if (w > maxW) [w, h] = [maxW, maxW / ratio];
    if (h > maxH) [w, h] = [maxH * ratio, maxH];
  } else {
    w = Math.min(w, maxW);
    h = Math.min(h, maxH);
  }
  return { x: dirX > 0 ? anchor.x : anchor.x - w, y: dirY > 0 ? anchor.y : anchor.y - h, w, h };
}

// 拖手柄改裁剪框。锁比例时只有四个角能拖（界面上不显示边上的手柄）。
export function dragCrop(rect: Rect, handle: CropHandle, pointer: Point, ratio: number | null, width: number, height: number): Rect {
  if (handle.length === 2) {
    const anchor = { x: handle.includes('w') ? rect.x + rect.w : rect.x, y: handle.includes('n') ? rect.y + rect.h : rect.y };
    return cropFromAnchor(anchor, pointer, ratio, width, height);
  }
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  if (handle === 'w') { const x = clamp(pointer.x, 0, right - MIN_CROP); return { ...rect, x, w: right - x }; }
  if (handle === 'e') return { ...rect, w: clamp(pointer.x, rect.x + MIN_CROP, width) - rect.x };
  if (handle === 'n') { const y = clamp(pointer.y, 0, bottom - MIN_CROP); return { ...rect, y, h: bottom - y }; }
  return { ...rect, h: clamp(pointer.y, rect.y + MIN_CROP, height) - rect.y };
}

export function moveCrop(rect: Rect, dx: number, dy: number, width: number, height: number): Rect {
  return { ...rect, x: clamp(rect.x + dx, 0, width - rect.w), y: clamp(rect.y + dy, 0, height - rect.h) };
}

// 换比例时：在整张图里取最大的居中框。
export function centeredCrop(ratio: number | null, width: number, height: number): Rect {
  if (!ratio) return { x: 0, y: 0, w: width, h: height };
  const w = Math.min(width, height * ratio);
  const h = w / ratio;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

// 取整到像素并保证不出图，用于真正裁图。
export function pixelCrop(rect: Rect, width: number, height: number): Rect {
  const x = clamp(Math.round(rect.x), 0, width - 1);
  const y = clamp(Math.round(rect.y), 0, height - 1);
  return { x, y, w: clamp(Math.round(rect.w), 1, width - x), h: clamp(Math.round(rect.h), 1, height - y) };
}

// 求把 from 四点映射到 to 四点的单应矩阵（3×3，h33=1，按行展开成 9 个数）：8 元线性方程组，高斯消元。
export function solveHomography(from: Quad, to: Quad): number[] {
  const rows: number[][] = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = from[i];
    const { x: X, y: Y } = to[i];
    rows.push([x, y, 1, 0, 0, 0, -x * X, -y * X, X]);
    rows.push([0, 0, 0, x, y, 1, -x * Y, -y * Y, Y]);
  }
  for (let col = 0; col < 8; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 8; row += 1) if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    if (Math.abs(rows[pivot][col]) < 1e-12) throw new Error('四个角不能共线或重合');
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    for (let row = 0; row < 8; row += 1) {
      if (row === col) continue;
      const factor = rows[row][col] / rows[col][col];
      for (let k = col; k < 9; k += 1) rows[row][k] -= factor * rows[col][k];
    }
  }
  return [...rows.map((row, index) => row[8] / row[index]), 1];
}

export function applyHomography(h: number[], x: number, y: number): Point {
  const d = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / d, y: (h[3] * x + h[4] * y + h[5]) / d };
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

// 透视裁剪的输出尺寸：宽取上下边平均，高取左右边平均（Photoshop 的做法）。
export function perspectiveOutputSize(quad: Quad) {
  const [tl, tr, br, bl] = quad;
  return {
    width: Math.max(1, Math.round((distance(tl, tr) + distance(bl, br)) / 2)),
    height: Math.max(1, Math.round((distance(tl, bl) + distance(tr, br)) / 2)),
  };
}

// 四边形是不是凸的、顺序对的（四个叉积同号）。拖成交叉或凹的时不让保存。
export function isConvexQuad(quad: Quad) {
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const c = quad[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false;
    if (sign && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return true;
}

type Pixels = { data: Uint8ClampedArray; width: number; height: number };

// 透视裁剪：输出的每个像素反推回原图四边形里的位置，双线性取色。
export function warpPerspective(source: Pixels, quad: Quad, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const h = solveHomography([{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }], quad);
  const out = new Uint8ClampedArray(width * height * 4);
  const { data, width: sw, height: sh } = source;
  for (let v = 0; v < height; v += 1) {
    for (let u = 0; u < width; u += 1) {
      const p = applyHomography(h, u + 0.5, v + 0.5);
      const x = clamp(p.x - 0.5, 0, sw - 1);
      const y = clamp(p.y - 0.5, 0, sh - 1);
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = Math.min(x0 + 1, sw - 1);
      const y1 = Math.min(y0 + 1, sh - 1);
      const fx = x - x0;
      const fy = y - y0;
      const o = (v * width + u) * 4;
      for (let c = 0; c < 4; c += 1) {
        const top = data[(y0 * sw + x0) * 4 + c] * (1 - fx) + data[(y0 * sw + x1) * 4 + c] * fx;
        const bottom = data[(y1 * sw + x0) * 4 + c] * (1 - fx) + data[(y1 * sw + x1) * 4 + c] * fx;
        out[o + c] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return out;
}
