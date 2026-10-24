// 来图定制的 AI 修图纯逻辑：只把涂抹区域周围的一块发给生图模型，结果只换涂过的像素，其余逐字节保留原图。Node 测试直接加载本文件。
import type { Rect } from '../materials/imageEdit.ts';

// 只用这三种比例：GPT 和 Gemini 都能按它们原样出图，结果缩回原大小不会变形。
export const EDIT_RATIOS = [
  { label: '1:1', value: 1, size: '1024x1024' },
  { label: '3:2', value: 3 / 2, size: '1536x1024' },
  { label: '2:3', value: 2 / 3, size: '1024x1536' },
] as const;
export type EditRatio = (typeof EDIT_RATIOS)[number];
// 结果的宽高比和请求的偏差超过这么多就不贴（贴上去会错位）。
export const RESULT_RATIO_TOLERANCE = 0.02;

// 高清放大：原图最长边超过这个就不放大，4 倍后已经远超 50cm 抱枕 300dpi 要的 5906 像素。
export const MAX_UPSCALE_INPUT = 2048;

// RGBA 里 alpha 不为 0 的就是涂过的。
export const paintedAt = (rgba: Uint8ClampedArray, index: number) => rgba[index * 4 + 3] > 0;

export function maskBounds(rgba: Uint8ClampedArray, width: number, height: number): Rect | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!paintedAt(rgba, y * width + x)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// 发给模型的那一块：涂抹外框四周留上下文（外框边长的一半，至少 64px），取三种比例里面积最小、装得下外框的那个，不出图片。
export function editWindow(bounds: Rect, width: number, height: number): Rect & { ratio: EditRatio } {
  const margin = Math.max(64, Math.max(bounds.w, bounds.h) / 2);
  const wantW = bounds.w + margin * 2;
  const wantH = bounds.h + margin * 2;
  const centerX = bounds.x + bounds.w / 2;
  const centerY = bounds.y + bounds.h / 2;
  let best: (Rect & { ratio: EditRatio }) | null = null;
  for (const ratio of EDIT_RATIOS) {
    let w = Math.max(wantW, wantH * ratio.value);
    // 图片放不下就收小，但至少要装得下涂抹外框。
    w = Math.min(w, width, height * ratio.value);
    const h = w / ratio.value;
    if (w < bounds.w || h < bounds.h) continue;
    const rw = Math.round(w);
    const rh = Math.round(h);
    const x = Math.round(Math.min(Math.max(centerX - rw / 2, 0), width - rw));
    const y = Math.round(Math.min(Math.max(centerY - rh / 2, 0), height - rh));
    if (!best || rw * rh < best.w * best.h) best = { x, y, w: rw, h: rh, ratio };
  }
  if (!best) throw new Error('涂的范围太宽或太扁，一次装不下，请分两次涂');
  return best;
}

// 发送尺寸：最长边不超过 maxSide，按窗口比例。
export function sendSize(window: Pick<Rect, 'w' | 'h'>, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(window.w, window.h));
  return { width: Math.max(1, Math.round(window.w * scale)), height: Math.max(1, Math.round(window.h * scale)) };
}

export const ratioMatches = (want: number, width: number, height: number) => Math.abs(width / height - want) / want <= RESULT_RATIO_TOLERANCE;

// 只在涂过的地方换成结果；涂抹边缘往里 feather 像素渐变过渡。涂抹以外的像素和原图逐字节相同。
export function compositeMasked(original: Uint8ClampedArray, result: Uint8ClampedArray, mask: Uint8ClampedArray, width: number, height: number, feather = 4): Uint8ClampedArray<ArrayBuffer> {
  const count = width * height;
  const inside = new Float32Array(count);
  for (let index = 0; index < count; index += 1) inside[index] = paintedAt(mask, index) ? 1 : 0;
  // 横竖各做一次盒式模糊，再乘回原来的涂抹范围：外面还是 0，边缘往里慢慢到 1。
  const blurred = boxBlur(boxBlur(inside, width, height, feather, true), width, height, feather, false);
  const out = new Uint8ClampedArray(original);
  for (let index = 0; index < count; index += 1) {
    if (!inside[index]) continue;
    const weight = blurred[index];
    for (let channel = 0; channel < 4; channel += 1) {
      const at = index * 4 + channel;
      out[at] = original[at] * (1 - weight) + result[at] * weight;
    }
  }
  return out;
}

function boxBlur(input: Float32Array, width: number, height: number, radius: number, horizontal: boolean) {
  if (radius <= 0) return input;
  const out = new Float32Array(input.length);
  const [outer, inner] = horizontal ? [height, width] : [width, height];
  const at = (o: number, i: number) => (horizontal ? o * width + i : i * width + o);
  for (let o = 0; o < outer; o += 1) {
    let sum = 0;
    for (let i = -radius; i <= radius; i += 1) sum += i >= 0 && i < inner ? input[at(o, i)] : 0;
    for (let i = 0; i < inner; i += 1) {
      out[at(o, i)] = sum / (radius * 2 + 1);
      const add = i + radius + 1;
      const drop = i - radius;
      if (add < inner) sum += input[at(o, add)];
      if (drop >= 0) sum -= input[at(o, drop)];
    }
  }
  return out;
}

// 扩成方形：边长取长边乘 (1 + extra)，原图放正中。
export function outpaintPlan(width: number, height: number, extra: number) {
  const side = Math.round(Math.max(width, height) * (1 + Math.max(0, extra)));
  if (side === width && side === height) throw new Error('已经是方形了，往外多扩一点再试');
  return { side, x: Math.round((side - width) / 2), y: Math.round((side - height) / 2) };
}

// 对齐：生图模型不按原位置画（实测扩图时 GPT 把人物放大约 15% 并往下挪），贴回前先找出原图在结果里的位置。
// ref、image 是灰度图；返回 scale、dx、dy：ref 的 (u, v) 在 image 里是 (scale·u + dx, scale·v + dy)。
// 用归一化互相关（不怕整体调色），valid 为 false 的 ref 像素（涂抹区域）不参与。先在缩小的图上粗搜，再在原尺寸附近细搜。
export type Gray = { data: Float32Array; width: number; height: number };
export type Alignment = { scale: number; dx: number; dy: number; score: number };

export function toGray(rgba: Uint8ClampedArray, width: number, height: number): Gray {
  const data = new Float32Array(width * height);
  for (let index = 0; index < data.length; index += 1) data[index] = rgba[index * 4] * 0.299 + rgba[index * 4 + 1] * 0.587 + rgba[index * 4 + 2] * 0.114;
  return { data, width, height };
}

// 按面积平均缩小（factor ≥ 1）。
export function shrinkGray(gray: Gray, factor: number): Gray {
  const width = Math.max(1, Math.floor(gray.width / factor));
  const height = Math.max(1, Math.floor(gray.height / factor));
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let sy = Math.floor(y * factor); sy < Math.min(gray.height, Math.floor((y + 1) * factor)); sy += 1) {
        for (let sx = Math.floor(x * factor); sx < Math.min(gray.width, Math.floor((x + 1) * factor)); sx += 1) {
          sum += gray.data[sy * gray.width + sx];
          count += 1;
        }
      }
      data[y * width + x] = count ? sum / count : 0;
    }
  }
  return { data, width, height };
}

function sample(gray: Gray, x: number, y: number) {
  if (x < 0 || y < 0 || x > gray.width - 1 || y > gray.height - 1) return Number.NaN;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(gray.width - 1, x0 + 1);
  const y1 = Math.min(gray.height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const row0 = gray.data[y0 * gray.width + x0] * (1 - fx) + gray.data[y0 * gray.width + x1] * fx;
  const row1 = gray.data[y1 * gray.width + x0] * (1 - fx) + gray.data[y1 * gray.width + x1] * fx;
  return row0 * (1 - fy) + row1 * fy;
}

// ref 里参与比较的点（隔 stride 取一个），预先减掉均值。
function refPoints(ref: Gray, valid: Uint8Array | null, stride: number) {
  const points: number[] = [];
  for (let v = 0; v < ref.height; v += stride) for (let u = 0; u < ref.width; u += stride) if (!valid || valid[v * ref.width + u]) points.push(u, v, ref.data[v * ref.width + u]);
  let mean = 0;
  for (let index = 2; index < points.length; index += 3) mean += points[index];
  mean /= points.length / 3 || 1;
  let norm = 0;
  for (let index = 2; index < points.length; index += 3) {
    points[index] -= mean;
    norm += points[index] ** 2;
  }
  return { points, norm: Math.sqrt(norm) };
}

function ncc(image: Gray, ref: { points: number[]; norm: number }, scale: number, dx: number, dy: number) {
  const { points } = ref;
  const values = new Float32Array(points.length / 3);
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = sample(image, scale * points[index * 3] + dx, scale * points[index * 3 + 1] + dy);
    if (Number.isNaN(value)) return -1; // 有一部分落到结果外面，不算
    values[index] = value;
    sum += value;
  }
  const mean = sum / values.length;
  let dot = 0;
  let norm = 0;
  for (let index = 0; index < values.length; index += 1) {
    const centered = values[index] - mean;
    dot += centered * points[index * 3 + 2];
    norm += centered ** 2;
  }
  return norm && ref.norm ? dot / (Math.sqrt(norm) * ref.norm) : -1;
}

// guess 是按请求时摆的位置算出的预计值；在它附近 scale ±range.scale、位移 ±range.shift（占结果边长的比例）里找。
export function estimateAlignment(ref: Gray, image: Gray, guess: { scale: number; dx: number; dy: number }, valid: Uint8Array | null = null, range = { scale: 0.3, shift: 0.2 }): Alignment {
  // 粗搜：把 ref 缩到最长边约 64，结果按同样比例缩。
  const coarse = Math.max(1, Math.max(ref.width, ref.height) / 64);
  const smallRef = shrinkGray(ref, coarse);
  const smallValid = valid ? shrinkMask(valid, ref.width, ref.height, coarse) : null;
  const smallImage = shrinkGray(image, coarse);
  const coarsePoints = refPoints(smallRef, smallValid, 1);
  let best: Alignment = { ...guess, score: -2 };
  const shift = range.shift * Math.max(smallImage.width, smallImage.height);
  for (let scale = guess.scale * (1 - range.scale); scale <= guess.scale * (1 + range.scale); scale += guess.scale * 0.01) {
    for (let dy = guess.dy / coarse - shift; dy <= guess.dy / coarse + shift; dy += 1) {
      for (let dx = guess.dx / coarse - shift; dx <= guess.dx / coarse + shift; dx += 1) {
        const score = ncc(smallImage, coarsePoints, scale, dx, dy);
        if (score > best.score) best = { scale, dx: dx * coarse, dy: dy * coarse, score };
      }
    }
  }
  // 细搜：原尺寸，隔几个像素取点，scale 和位移在粗搜结果附近逐步收窄。
  const finePoints = refPoints(ref, valid, Math.max(1, Math.round(Math.max(ref.width, ref.height) / 256)));
  let step = { scale: guess.scale * 0.01, shift: coarse };
  for (let round = 0; round < 6; round += 1) {
    const center = best;
    for (const ds of [-1, 0, 1]) {
      for (const sy of [-1, 0, 1]) {
        for (const sx of [-1, 0, 1]) {
          const candidate = { scale: center.scale + ds * step.scale, dx: center.dx + sx * step.shift, dy: center.dy + sy * step.shift };
          const score = ncc(image, finePoints, candidate.scale, candidate.dx, candidate.dy);
          if (score > best.score) best = { ...candidate, score };
        }
      }
    }
    if (best === center) step = { scale: step.scale / 2, shift: step.shift / 2 };
  }
  return best;
}

function shrinkMask(valid: Uint8Array, width: number, height: number, factor: number) {
  const gray = shrinkGray({ data: Float32Array.from(valid), width, height }, factor);
  return Uint8Array.from(gray.data, (value) => (value > 0.99 ? 1 : 0));
}

// 调色对齐：模型常把整体色调改掉（实测扩图把复古暖黄补成蓝天、变清晰把颜色调饱和）。
// 按 RGB 各通道的均值和标准差，把结果的颜色拉到原图的分布上（Reinhard 式颜色迁移）。统计隔点采样，大图也快。
export type ColorStats = { mean: [number, number, number]; std: [number, number, number] };
// skip 给了时，跳过 skip 判为真的像素（局部修改时只比没涂的地方）。
export function colorStats(rgba: Uint8ClampedArray, step = 1, skip?: (pixel: number) => boolean): ColorStats {
  const sum = [0, 0, 0];
  const squares = [0, 0, 0];
  let count = 0;
  for (let index = 0; index < rgba.length; index += 4 * step) {
    if (skip?.(index / 4)) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      sum[channel] += rgba[index + channel];
      squares[channel] += rgba[index + channel] ** 2;
    }
    count += 1;
  }
  const mean = sum.map((value) => value / count) as ColorStats['mean'];
  const std = squares.map((value, channel) => Math.sqrt(Math.max(0, value / count - mean[channel] ** 2))) as ColorStats['std'];
  return { mean, std };
}
export function transferColors(rgba: Uint8ClampedArray, from: ColorStats, to: ColorStats): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(rgba);
  const gain = from.std.map((value, channel) => to.std[channel] / Math.max(1, value));
  for (let index = 0; index < out.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) out[index + channel] = (rgba[index + channel] - from.mean[channel]) * gain[channel] + to.mean[channel];
  }
  return out;
}

// 接缝对齐：全局调色后，AI 补的地方挨着原图那一圈常常还有局部色差（实测天空偏蓝）。沿原图四条边算出「原图边缘 − 紧贴在外面的 AI」的差
// （各取 band 像素求平均，再沿边模糊 radius），加到原图外面的 AI 像素上，离原图越远加得越少，到 falloff 为 0。只改原图外面的像素。
export function matchSeam(ai: Uint8ClampedArray, side: number, original: Uint8ClampedArray, width: number, height: number, x: number, y: number, band: number, falloff: number, radius: number): Uint8ClampedArray<ArrayBuffer> {
  const depth = Math.max(1, Math.min(band, width, height));
  // 一条边上每个位置的平均差（RGB）：原图往里 d 像素 和 AI 往外 d 像素（紧贴原图外面的那一圈）比。
  // along 是沿边的长度，at(i, d) 给出 [原图坐标, AI 坐标]；AI 坐标出了画布的不算。
  const edgeDiff = (along: number, at: (i: number, d: number) => [number, number, number, number]) => {
    const raw = new Float32Array(along * 3);
    for (let i = 0; i < along; i += 1) {
      let count = 0;
      const sum = [0, 0, 0];
      for (let d = 0; d < depth; d += 1) {
        const [col, row, aiCol, aiRow] = at(i, d);
        if (aiCol < 0 || aiRow < 0 || aiCol >= side || aiRow >= side) continue;
        const o = (row * width + col) * 4;
        const a = (aiRow * side + aiCol) * 4;
        for (let c = 0; c < 3; c += 1) sum[c] += original[o + c] - ai[a + c];
        count += 1;
      }
      for (let c = 0; c < 3; c += 1) raw[i * 3 + c] = count ? sum[c] / count : 0;
    }
    const smooth = new Float32Array(along * 3);
    for (let i = 0; i < along; i += 1) {
      const from = Math.max(0, i - radius);
      const to = Math.min(along - 1, i + radius);
      for (let c = 0; c < 3; c += 1) {
        let sum = 0;
        for (let k = from; k <= to; k += 1) sum += raw[k * 3 + c];
        smooth[i * 3 + c] = sum / (to - from + 1);
      }
    }
    return smooth;
  };
  const top = edgeDiff(width, (i, d) => [i, d, x + i, y - 1 - d]);
  const bottom = edgeDiff(width, (i, d) => [i, height - 1 - d, x + i, y + height + d]);
  const left = edgeDiff(height, (i, d) => [d, i, x - 1 - d, y + i]);
  const right = edgeDiff(height, (i, d) => [width - 1 - d, i, x + width + d, y + i]);
  const out = new Uint8ClampedArray(ai);
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      const dx = col < x ? x - col : col >= x + width ? col - (x + width - 1) : 0;
      const dy = row < y ? y - row : row >= y + height ? row - (y + height - 1) : 0;
      if (!dx && !dy) continue;
      const distance = Math.hypot(dx, dy);
      if (distance >= falloff) continue;
      const weight = 1 - distance / falloff;
      const cx = Math.min(width - 1, Math.max(0, col - x));
      const cy = Math.min(height - 1, Math.max(0, row - y));
      // 正上下方取上下边，正左右取左右边，斜角两条边按距离加权。
      const vertical = dy ? (row < y ? top : bottom) : null;
      const horizontal = dx ? (col < x ? left : right) : null;
      const o = (row * side + col) * 4;
      for (let c = 0; c < 3; c += 1) {
        const v = vertical ? vertical[cx * 3 + c] : 0;
        const h = horizontal ? horizontal[cy * 3 + c] : 0;
        const offset = vertical && horizontal ? (v * dy + h * dx) / (dx + dy) : vertical ? v : h;
        out[o + c] = ai[o + c] + offset * weight;
      }
    }
  }
  return out;
}

export const nearestRatio = (width: number, height: number) =>
  EDIT_RATIOS.reduce((best, ratio) => (Math.abs(Math.log((width / height) / ratio.value)) < Math.abs(Math.log((width / height) / best.value)) ? ratio : best));

// 结果按原图比例居中裁（整图变清晰时，模型按最近的比例出图）。
export function coverCrop(width: number, height: number, ratio: number): Rect {
  const w = Math.min(width, Math.round(height * ratio));
  const h = Math.min(height, Math.round(w / ratio));
  return { x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), w, h };
}

const COLOR_NAMES: Record<string, [string, string]> = {
  '#00ff00': ['绿色', 'green'],
  '#ff0000': ['红色', 'red'],
  '#0000ff': ['蓝色', 'blue'],
  '#ffff00': ['黄色', 'yellow'],
  '#ff00ff': ['品红色', 'magenta'],
  '#00ffff': ['青色', 'cyan'],
  '#ffffff': ['白色', 'white'],
  '#000000': ['黑色', 'black'],
};

export type RetouchKind = 'watermark' | 'fill' | 'custom' | 'outpaint' | 'restore';

export function retouchPrompt(kind: RetouchKind, color = '#00ff00', custom = '') {
  const [zh, en] = COLOR_NAMES[color.toLowerCase()] ?? ['标记颜色', 'marked'];
  switch (kind) {
    case 'watermark':
      return `去掉${zh}标记区域里的水印、文字和 logo，按周围的画面自然补全。标记区域以外保持原样，不要改动人物和其它内容。Remove the watermark, text and logo inside the ${en} marked area and fill it in naturally from the surroundings. Keep everything outside the marked area unchanged.`;
    case 'fill':
      return `在${zh}标记区域补画出缺失的部分（比如被裁掉的头发、手、身体、背景），和周围画面自然衔接，风格、光线、颜色一致。标记区域以外保持原样。Paint the missing parts inside the ${en} marked area so they connect naturally with the surroundings, matching style, lighting and colors. Keep everything outside unchanged.`;
    case 'custom': {
      if (!custom.trim()) throw new Error('先写要改成什么');
      return `只修改${zh}标记区域：${custom.trim()}。标记区域以外保持原样。Only change the ${en} marked area as described. Keep everything outside unchanged.`;
    }
    case 'outpaint':
      return `${zh}区域是要向外扩展的画面：按原图内容自然延伸背景，风格、光线、色调和滤镜和原图完全一致，不要在扩展区域加新的人物或文字。中间的原图保持不变。The ${en} area is an extension of the picture: continue the background naturally with exactly the same style, lighting, color grading and filter, without adding new people or text. Keep the original picture in the middle unchanged.`;
    case 'restore':
      return '把这张图修复得更清晰：去掉模糊、噪点和压缩痕迹，提升细节。构图、人物长相、表情、颜色、文字和所有内容保持不变，不要添加或删除任何东西。Restore this image to be sharper and cleaner: remove blur, noise and compression artifacts. Keep the composition, faces, expressions, colors, text and every element exactly the same; do not add or remove anything.';
  }
}
