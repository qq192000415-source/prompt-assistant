// 样机 PSD 的图层合成（导入时用）：混合模式、剪贴组、图层蒙版、不透明度和填充、常用调整图层，按 PS 的公式算到一张整幅 RGBA 上。
// 只算智能对象下面那些和买家图无关的层，结果存成样机底图；认不出来的直接报出是哪一层，不猜。不依赖 Electron，Node 测试可直接加载。
import type { BlendMode, Layer } from 'ag-psd';
import type { OverBlend } from '../../src/custom/product.ts';

export type Rgba = { width: number; height: number; data: Uint8ClampedArray };

const label = (layer: Layer) => `「${layer.name ?? '未命名'}」`;
const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

// ---- 可分离的混合模式（W3C Compositing 的公式，和 PS 一致；柔光用 PS 的写法）。值都在 0–1。
type Blend = (cb: number, cs: number) => number;
const softLight: Blend = (cb, cs) => (cs <= 0.5 ? cb - (1 - 2 * cs) * cb * (1 - cb) : cb + (2 * cs - 1) * (Math.sqrt(cb) - cb));
const hardLight: Blend = (cb, cs) => (cs <= 0.5 ? cb * 2 * cs : 1 - (1 - cb) * (1 - (2 * cs - 1)));
export const BLENDS: Partial<Record<BlendMode, Blend>> = {
  normal: (_cb, cs) => cs,
  multiply: (cb, cs) => cb * cs,
  screen: (cb, cs) => cb + cs - cb * cs,
  overlay: (cb, cs) => hardLight(cs, cb),
  darken: Math.min,
  lighten: Math.max,
  'color dodge': (cb, cs) => (cb === 0 ? 0 : cs >= 1 ? 1 : Math.min(1, cb / (1 - cs))),
  'color burn': (cb, cs) => (cb >= 1 ? 1 : cs <= 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs)),
  'hard light': hardLight,
  'soft light': softLight,
  'linear dodge': (cb, cs) => Math.min(1, cb + cs),
  'linear burn': (cb, cs) => Math.max(0, cb + cs - 1),
  difference: (cb, cs) => Math.abs(cb - cs),
  exclusion: (cb, cs) => cb + cs - 2 * cb * cs,
};

// ---- 调整图层：先做成 0–255 的查找表（黑白要看三个通道，单独算）。
type Adjust = (r: number, g: number, b: number, out: Float64Array) => void;

type LevelsChannel = { shadowInput: number; highlightInput: number; shadowOutput: number; highlightOutput: number; midtoneInput: number };
function levelsLut(channel: LevelsChannel | undefined) {
  const lut = new Float64Array(256);
  for (let i = 0; i < 256; i += 1) {
    if (!channel) {
      lut[i] = i;
      continue;
    }
    const range = Math.max(1, channel.highlightInput - channel.shadowInput);
    const t = clamp01((i - channel.shadowInput) / range);
    const gamma = channel.midtoneInput > 0 ? channel.midtoneInput : 1;
    lut[i] = channel.shadowOutput + (channel.highlightOutput - channel.shadowOutput) * Math.pow(t, 1 / gamma);
  }
  return lut;
}

// 曲线：PS 用自然三次样条过控制点，两端以外取端点值。
export function curveLut(points: Array<{ input: number; output: number }> | undefined) {
  const lut = new Float64Array(256);
  const pts = [...(points ?? [])].sort((a, b) => a.input - b.input);
  if (pts.length < 2) {
    for (let i = 0; i < 256; i += 1) lut[i] = i;
    return lut;
  }
  const n = pts.length;
  const x = pts.map((p) => p.input);
  const y = pts.map((p) => p.output);
  const m = new Float64Array(n); // 二阶导
  if (n > 2) {
    const a = new Float64Array(n);
    const b = new Float64Array(n);
    const c = new Float64Array(n);
    const d = new Float64Array(n);
    for (let i = 1; i < n - 1; i += 1) {
      a[i] = x[i] - x[i - 1];
      b[i] = 2 * (x[i + 1] - x[i - 1]);
      c[i] = x[i + 1] - x[i];
      d[i] = 6 * ((y[i + 1] - y[i]) / (x[i + 1] - x[i]) - (y[i] - y[i - 1]) / (x[i] - x[i - 1]));
    }
    for (let i = 2; i < n - 1; i += 1) {
      const w = a[i] / b[i - 1];
      b[i] -= w * c[i - 1];
      d[i] -= w * d[i - 1];
    }
    for (let i = n - 2; i >= 1; i -= 1) m[i] = (d[i] - c[i] * m[i + 1]) / b[i];
  }
  for (let v = 0; v < 256; v += 1) {
    if (v <= x[0]) lut[v] = y[0];
    else if (v >= x[n - 1]) lut[v] = y[n - 1];
    else {
      let k = 0;
      while (v > x[k + 1]) k += 1;
      const h = x[k + 1] - x[k];
      const t1 = (x[k + 1] - v) / h;
      const t2 = (v - x[k]) / h;
      lut[v] = t1 * y[k] + t2 * y[k + 1] + ((t1 * t1 * t1 - t1) * m[k] + (t2 * t2 * t2 - t2) * m[k + 1]) * (h * h) / 6;
    }
    lut[v] = Math.min(255, Math.max(0, lut[v]));
  }
  return lut;
}

const lutAdjust = (master: Float64Array, red: Float64Array, green: Float64Array, blue: Float64Array): Adjust => (r, g, b, out) => {
  out[0] = master[Math.round(red[r])];
  out[1] = master[Math.round(green[g])];
  out[2] = master[Math.round(blue[b])];
};

// 黑白：灰度 = 最小值 + (中间值 − 最小值) × 两色混合那一档的权重 + (最大值 − 中间值) × 最大那个原色的权重。
// 纯红按「红色」那档、黄（红+绿）按「黄色」那档，白色保持白色。
export function blackAndWhite(weights: { reds: number; yellows: number; greens: number; cyans: number; blues: number; magentas: number }): Adjust {
  const primary = [weights.reds, weights.greens, weights.blues].map((value) => value / 100);
  // 下标是两个通道的组合：红+绿=黄、绿+蓝=青、红+蓝=洋红。
  const secondary = (a: number, b: number) => (a + b === 1 ? weights.yellows : a + b === 3 ? weights.cyans : weights.magentas) / 100;
  return (r, g, b, out) => {
    const values = [r, g, b];
    const order = [0, 1, 2].sort((i, j) => values[j] - values[i]);
    const [hi, mid, lo] = order;
    const gray = values[lo] + (values[mid] - values[lo]) * secondary(hi, mid) + (values[hi] - values[mid]) * primary[hi];
    out[0] = out[1] = out[2] = Math.min(255, Math.max(0, gray));
  };
}

function adjustmentOf(layer: Layer): Adjust {
  const adjustment = layer.adjustment!;
  switch (adjustment.type) {
    case 'levels': {
      const identity = levelsLut(undefined);
      const master = levelsLut(adjustment.rgb);
      return lutAdjust(master, adjustment.red ? levelsLut(adjustment.red) : identity, adjustment.green ? levelsLut(adjustment.green) : identity, adjustment.blue ? levelsLut(adjustment.blue) : identity);
    }
    case 'curves':
      return lutAdjust(curveLut(adjustment.rgb), curveLut(adjustment.red), curveLut(adjustment.green), curveLut(adjustment.blue));
    case 'black & white':
      if (adjustment.useTint) throw new Error(`调整图层${label(layer)}的黑白勾了「色调」，暂时不支持，请先在 PS 里合并`);
      return blackAndWhite({
        reds: adjustment.reds ?? 40,
        yellows: adjustment.yellows ?? 60,
        greens: adjustment.greens ?? 40,
        cyans: adjustment.cyans ?? 60,
        blues: adjustment.blues ?? 20,
        magentas: adjustment.magentas ?? 80,
      });
    default:
      throw new Error(`调整图层${label(layer)}是「${adjustment.type}」，暂时只认色阶、曲线、黑白，请先在 PS 里把它和下面的层合并`);
  }
}

// ---- 蒙版和图层透明度。
function maskAt(layer: Layer): (x: number, y: number) => number {
  const mask = layer.mask;
  if (!mask || mask.disabled) return () => 1;
  const fallback = (mask.defaultColor ?? 255) / 255;
  const image = mask.imageData;
  const left = mask.left ?? 0;
  const top = mask.top ?? 0;
  if (!image || !image.width) return () => fallback;
  return (x, y) => {
    const mx = x - left;
    const my = y - top;
    if (mx < 0 || my < 0 || mx >= image.width || my >= image.height) return fallback;
    return image.data[(my * image.width + mx) * 4] / 255;
  };
}

function checkSupported(layer: Layer) {
  // 样式面板里每种效果都会存一份，没勾上的 enabled 是 false，只看真正开着的。
  const effects = layer.effects as Record<string, unknown> | undefined;
  const enabled = (value: unknown) => (Array.isArray(value) ? value : [value]).some((entry) => typeof entry === 'object' && entry !== null && (entry as { enabled?: boolean }).enabled === true);
  if (effects && !effects.disabled && Object.entries(effects).some(([key, value]) => key !== 'disabled' && key !== 'scale' && enabled(value))) {
    throw new Error(`图层${label(layer)}带图层样式（投影、描边等），请先在 PS 里栅格化图层样式`);
  }
  if (layer.vectorMask) throw new Error(`图层${label(layer)}带矢量蒙版，请先在 PS 里栅格化`);
}

// 图层自己在整幅画布上的不透明度（像素 alpha × 蒙版），剪贴到它上面的层只在这个范围里生效。
export function layerAlpha(width: number, height: number, layer: Layer): Float32Array {
  const alpha = new Float32Array(width * height);
  const image = layer.imageData;
  if (!image) return alpha;
  const left = layer.left ?? 0;
  const top = layer.top ?? 0;
  const mask = maskAt(layer);
  for (let y = 0; y < image.height; y += 1) {
    const ty = top + y;
    if (ty < 0 || ty >= height) continue;
    for (let x = 0; x < image.width; x += 1) {
      const tx = left + x;
      if (tx < 0 || tx >= width) continue;
      alpha[ty * width + tx] = (image.data[(y * image.width + x) * 4 + 3] / 255) * mask(tx, ty);
    }
  }
  return alpha;
}

// 按顺序（从下往上）合成一串图层。剪贴图层只作用在它下面最近那个非剪贴层的范围里。
export function compositeLayers(width: number, height: number, layers: Layer[]): Rgba {
  const out = new Float64Array(width * height * 4); // 0–255 颜色 + 0–1 alpha
  let clipAlpha: Float32Array | null = null;
  const adjusted = new Float64Array(3);
  for (const layer of layers) {
    checkSupported(layer);
    const opacity = (layer.opacity ?? 1) * (layer.fillOpacity ?? 1);
    if (!layer.clipping) clipAlpha = layer.adjustment ? null : layerAlpha(width, height, layer);
    else if (!clipAlpha) throw new Error(`图层${label(layer)}是剪贴图层，但它下面没有能剪贴的普通图层`);
    const clip = layer.clipping ? clipAlpha : null;
    const mask = maskAt(layer);

    if (layer.adjustment) {
      if (layer.blendMode && layer.blendMode !== 'normal' && layer.blendMode !== 'pass through') {
        throw new Error(`调整图层${label(layer)}的混合模式是 ${layer.blendMode}，暂时只认「正常」，请先在 PS 里合并`);
      }
      const adjust = adjustmentOf(layer);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const p = y * width + x;
          const weight = opacity * mask(x, y) * (clip ? clip[p] : 1);
          if (weight <= 0 || out[p * 4 + 3] <= 0) continue;
          const i = p * 4;
          adjust(Math.round(out[i]), Math.round(out[i + 1]), Math.round(out[i + 2]), adjusted);
          for (let c = 0; c < 3; c += 1) out[i + c] += (adjusted[c] - out[i + c]) * weight;
        }
      }
      continue;
    }

    const image = layer.imageData;
    if (!image) continue;
    const mode = layer.blendMode === 'pass through' || !layer.blendMode ? 'normal' : layer.blendMode;
    const blend = BLENDS[mode];
    if (!blend) throw new Error(`图层${label(layer)}的混合模式是 ${mode}，暂时不支持，请先在 PS 里把它和下面的层合并`);
    const left = layer.left ?? 0;
    const top = layer.top ?? 0;
    for (let y = 0; y < image.height; y += 1) {
      const ty = top + y;
      if (ty < 0 || ty >= height) continue;
      for (let x = 0; x < image.width; x += 1) {
        const tx = left + x;
        if (tx < 0 || tx >= width) continue;
        const p = ty * width + tx;
        const s = (y * image.width + x) * 4;
        const as = (image.data[s + 3] / 255) * opacity * mask(tx, ty) * (clip ? clip[p] : 1);
        if (as <= 0) continue;
        const i = p * 4;
        const ab = out[i + 3];
        const ao = as + ab * (1 - as);
        for (let c = 0; c < 3; c += 1) {
          const cs = image.data[s + c] / 255;
          const cb = out[i + c] / 255;
          const mixed = (as * (1 - ab) * cs + as * ab * blend(cb, cs) + (1 - as) * ab * cb) / ao;
          out[i + c] = mixed * 255;
        }
        out[i + 3] = ao;
      }
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    data[i] = out[i];
    data[i + 1] = out[i + 1];
    data[i + 2] = out[i + 2];
    data[i + 3] = out[i + 3] * 255;
  }
  return { width, height, data };
}

// 智能对象上面的层出图时用 canvas 叠，这里只把蒙版乘进像素、铺到整幅画布上；混合模式和不透明度留给 canvas。
export const CANVAS_BLENDS: Partial<Record<BlendMode, OverBlend>> = {
  normal: 'source-over',
  'pass through': 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color dodge': 'color-dodge',
  'color burn': 'color-burn',
  'hard light': 'hard-light',
  'soft light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  'linear dodge': 'lighter',
};
export function rasterizeLayer(width: number, height: number, layer: Layer): Rgba {
  checkSupported(layer);
  const data = new Uint8ClampedArray(width * height * 4);
  const image = layer.imageData;
  if (image) {
    const left = layer.left ?? 0;
    const top = layer.top ?? 0;
    const mask = maskAt(layer);
    for (let y = 0; y < image.height; y += 1) {
      const ty = top + y;
      if (ty < 0 || ty >= height) continue;
      for (let x = 0; x < image.width; x += 1) {
        const tx = left + x;
        if (tx < 0 || tx >= width) continue;
        const s = (y * image.width + x) * 4;
        const d = (ty * width + tx) * 4;
        data[d] = image.data[s];
        data[d + 1] = image.data[s + 1];
        data[d + 2] = image.data[s + 2];
        data[d + 3] = image.data[s + 3] * mask(tx, ty);
      }
    }
  }
  return { width, height, data };
}
