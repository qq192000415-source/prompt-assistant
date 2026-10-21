// 拿一张图生成皮肤（1.17.0，设置 › 皮肤 › 做一套皮肤）：分析配色、边缘色、主体位置和明暗，按图的形状决定摆法，
// 算出整套颜色令牌（按钮白字对比度 ≥ 4.5，磨砂玻璃上的正文 ≥ 7），生成皮肤包的 manifest。
// 纯逻辑，像素由调用方用 canvas 读好传进来；Node 测试直接加载。
import type { SkinBase, SkinManifest, WallpaperLayout } from './skinPack';

type Rgb = [number, number, number];
export type Pixels = { data: ArrayLike<number>; width: number; height: number };
export type PaletteColor = { hue: number; saturation: number };
export type ImageInfo = {
  aspect: number;
  meanLum: number;
  // 亮度从低到高第 5%、95% 的像素，用来算玻璃要多不透明
  low: number;
  high: number;
  palette: PaletteColor[];
  edgeLeft: Rgb;
  edgeRight: Rgb;
  average: Rgb;
  // 主体位置，0–1
  focus: { x: number; y: number };
};
export type SkinChoice = { layout: WallpaperLayout; accent: number; mode: 'auto' | 'light' | 'dark'; focus?: { x: number; y: number } };

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const linear = (channel: number) => {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
export const luminance = ([r, g, b]: Rgb) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
export const contrast = (a: Rgb, b: Rgb) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};
// 亮度 → 同亮度的灰
const grayOf = (lum: number): Rgb => {
  const value = lum <= 0.03928 / 12.92 ? lum * 12.92 : 1.055 * lum ** (1 / 2.4) - 0.055;
  const channel = Math.round(Math.min(1, Math.max(0, value)) * 255);
  return [channel, channel, channel];
};

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const light = (max + min) / 2;
  if (max === min) return [0, 0, light];
  const d = max - min;
  const sat = light > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hue = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [hue * 60, sat, light];
}

function fromHsl(hue: number, sat: number, light: number): Rgb {
  const k = (n: number) => (n + hue / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map((value) => Math.round(value * 255)) as Rgb;
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => a.map((value, index) => Math.round(value * (1 - t) + b[index] * t)) as Rgb;
const hex = (color: Rgb) => `#${color.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
const rgba = ([r, g, b]: Rgb, alpha: number) => `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(2))})`;
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

export function analyzePixels({ data, width, height }: Pixels, aspect = width / height): ImageInfo {
  const at = (x: number, y: number): Rgb => {
    const index = (y * width + x) * 4;
    return [data[index], data[index + 1], data[index + 2]];
  };
  const lums: number[] = [];
  const buckets = Array.from({ length: 24 }, () => ({ weight: 0, r: 0, g: 0, b: 0, sat: 0 }));
  const sum: Rgb = [0, 0, 0];
  let fx = 0;
  let fy = 0;
  let fw = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = at(x, y);
      const [hue, sat, light] = toHsl(color);
      const lum = luminance(color);
      lums.push(lum);
      color.forEach((value, index) => (sum[index] += value));
      // 候选主色：够鲜艳、不太黑不太白的像素按色相分桶，越鲜艳、越接近中间亮度权重越高
      if (sat > 0.22 && light > 0.12 && light < 0.88) {
        const bucket = buckets[Math.floor(hue / 15) % 24];
        const weight = sat * (1 - Math.abs(light - 0.5));
        bucket.weight += weight;
        bucket.r += color[0] * weight;
        bucket.g += color[1] * weight;
        bucket.b += color[2] * weight;
        bucket.sat += sat * weight;
      }
      // 主体：细节多（和右、下邻居亮度差得多）、颜色鲜艳的地方，稍偏向中心；取最突出的那些点的重心
      if (x < width - 1 && y < height - 1) {
        const edge = Math.abs(lum - luminance(at(x + 1, y))) + Math.abs(lum - luminance(at(x, y + 1)));
        const center = 1 - 0.6 * Math.hypot(x / width - 0.5, y / height - 0.5);
        const salience = ((edge * 4 + sat * 0.6) * center) ** 3;
        fx += x * salience;
        fy += y * salience;
        fw += salience;
      }
    }
  }
  const sorted = [...lums].sort((a, b) => a - b);
  const quantile = (q: number) => sorted[Math.floor(q * (sorted.length - 1))] ?? 0;
  const palette: PaletteColor[] = [];
  for (const bucket of buckets.filter((entry) => entry.weight > 0).sort((a, b) => b.weight - a.weight)) {
    const [hue] = toHsl([bucket.r / bucket.weight, bucket.g / bucket.weight, bucket.b / bucket.weight].map(Math.round) as Rgb);
    if (palette.length < 5 && palette.every((entry) => hueGap(entry.hue, hue) > 30)) palette.push({ hue, saturation: bucket.sat / bucket.weight });
  }
  const edge = (fromX: number): Rgb => {
    const total: Rgb = [0, 0, 0];
    let count = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = fromX; x < Math.min(width, fromX + 3); x += 1) {
        at(x, y).forEach((value, index) => (total[index] += value));
        count += 1;
      }
    }
    return total.map((value) => Math.round(value / Math.max(1, count))) as Rgb;
  };
  const pixels = width * height;
  return {
    aspect,
    meanLum: lums.reduce((a, b) => a + b, 0) / Math.max(1, pixels),
    low: quantile(0.05),
    high: quantile(0.95),
    palette,
    edgeLeft: edge(0),
    edgeRight: edge(Math.max(0, width - 3)),
    average: sum.map((value) => Math.round(value / Math.max(1, pixels))) as Rgb,
    focus: { x: fw ? fx / fw / width : 0.5, y: fw ? fy / fw / height : 0.5 },
  };
}

// 横图铺满；竖图、方图做侧边立绘，默认靠右（左边有菜单和参数栏挡着）。
export const suggestLayout = (info: Pick<ImageInfo, 'aspect'>): WallpaperLayout => (info.aspect >= 1.3 ? 'cover' : 'right');

export const imageShape = (aspect: number) => (aspect >= 1.3 ? '横图' : aspect <= 0.8 ? '竖图' : '方图');

// 主色：保住色相，调饱和度和亮度，让按钮上的白字对比度 ≥ 4.5
export function accentColor(color: PaletteColor, dark: boolean): Rgb {
  const sat = Math.min(0.85, Math.max(0.45, color.saturation));
  let light = dark ? 0.62 : 0.5;
  let result = fromHsl(color.hue, sat, light);
  while (contrast(WHITE, result) < 4.5 && light > 0.2) {
    light -= 0.02;
    result = fromHsl(color.hue, sat, light);
  }
  return result;
}

// 图里没有鲜艳颜色（黑白、灰调）时用蓝色兜底。
const paletteOf = (info: ImageInfo) => (info.palette.length ? info.palette : [{ hue: 220, saturation: 0.7 }]);

export function skinColors(info: ImageInfo, choice: SkinChoice) {
  const cover = choice.layout === 'cover';
  // 立绘看贴着界面那一侧的边缘色，铺满看整张图
  const edge = choice.layout === 'left' ? info.edgeRight : info.edgeLeft;
  const refLum = cover ? info.meanLum : luminance(edge);
  const dark = choice.mode === 'auto' ? refLum < 0.32 : choice.mode === 'dark';
  const palette = paletteOf(info);
  const accent = accentColor(palette[Math.min(choice.accent, palette.length - 1)], dark);
  // 中性色带一点图里的色调，界面和图是一家人
  const [hue] = toHsl(cover ? info.average : edge);
  const surface = dark ? fromHsl(hue, 0.16, 0.1) : fromHsl(hue, 0.25, 0.985);
  const text: Rgb = dark ? [236, 236, 240] : [26, 27, 31];
  // 玻璃不透明度：从 0.5 往上加，直到图上最亮、最暗的像素透过来时正文对比度都 ≥ 7
  const extremes = [grayOf(info.low), grayOf(info.high)];
  let alpha = 0.5;
  while (alpha < 0.95 && extremes.some((pixel) => contrast(text, mix(pixel, surface, alpha)) < 7)) alpha += 0.02;
  const worstContrast = Math.min(...extremes.map((pixel) => contrast(text, mix(pixel, surface, alpha))));
  return {
    base: (dark ? 'dark' : 'light') as SkinBase,
    dark,
    accent,
    surface,
    text,
    alpha,
    worstContrast,
    wallpaperBase: cover ? surface : edge,
    swatches: palette.map((color) => hex(accentColor(color, dark))),
  };
}

export type SkinColors = ReturnType<typeof skinColors>;

export function skinTokens(colors: SkinColors): Record<string, string> {
  const { dark, accent, surface, text, alpha } = colors;
  const muted: Rgb = dark ? [166, 168, 176] : [92, 96, 106];
  const faint: Rgb = dark ? [118, 120, 128] : [140, 145, 156];
  const ink = dark ? WHITE : BLACK;
  return {
    '--sidebar': rgba(surface, alpha),
    '--surface': rgba(surface, alpha),
    '--surface-quiet': rgba(surface, 0.12),
    '--surface-raised': rgba(surface, Math.min(0.96, alpha + 0.15)),
    '--surface-muted': rgba(mix(surface, ink, 0.05), alpha),
    '--overlay-surface': hex(surface),
    '--hover': rgba(ink, 0.05),
    '--border': rgba(ink, dark ? 0.1 : 0.08),
    '--border-strong': rgba(ink, dark ? 0.18 : 0.15),
    '--text': hex(text),
    '--muted': hex(muted),
    '--faint': hex(faint),
    '--accent': hex(accent),
    '--accent-hover': hex(mix(accent, dark ? WHITE : BLACK, 0.15)),
    '--accent-weak': rgba(accent, dark ? 0.22 : 0.12),
    '--on-accent': '#ffffff',
  };
}

// 生成皮肤包的 manifest（和手做的皮肤包同一个格式，安装时同样走 validateSkinManifest）。
export function generatedManifest(input: { id: string; name: string; info: ImageInfo; choice: SkinChoice; author?: string }): SkinManifest {
  const { info, choice } = input;
  const colors = skinColors(info, choice);
  const focus = choice.focus ?? info.focus;
  const cover = choice.layout === 'cover';
  return {
    id: input.id,
    name: input.name,
    note: `${imageShape(info.aspect)}${cover ? '全屏' : '立绘'} · ${colors.dark ? '深色' : '浅色'}`,
    author: input.author ?? '我',
    version: '1.0.0',
    base: colors.base,
    tokens: skinTokens(colors),
    wallpaper: {
      file: 'wallpaper.webp',
      // 铺满时菜单那侧稍压一点，立绘时顶部稍压一点（顶部栏在那里）
      overlay: cover ? rgba(colors.surface, 0.12) : 'transparent',
      layout: choice.layout,
      focus: [Math.round(focus.x * 100), Math.round(focus.y * 100)],
      aspect: Number(info.aspect.toFixed(4)),
      base: hex(colors.wallpaperBase),
    },
    preview: 'preview.webp',
  };
}

// AI 生成壁纸的提示词：把「适合当软件背景」的构图要求写进去，出来的图天生能用。
export const WALLPAPER_STYLES = ['国风水墨', '动漫插画', '自然风景', '城市夜景', '赛博朋克', '极简抽象', '星空宇宙', '治愈清新'];

export function wallpaperPrompt(input: { description: string; styles: string[]; composition: 'scene' | 'character' }) {
  const subject = [input.description.trim(), input.styles.length ? `风格：${input.styles.join('、')}` : ''].filter(Boolean).join('。');
  const layout =
    input.composition === 'character'
      ? '竖版全身人物立绘，人物完整从头到脚、居中站立，背景简洁柔和、细节少，越靠左右两边越接近纯色，方便贴在软件窗口一侧当皮肤。'
      : '横版桌面软件壁纸，主体放在画面左侧或下方三分之一，右侧和中间留出大面积干净、低细节的空白（天空、雾、水面、渐变），方便叠加界面和文字。';
  return `${subject || '一张好看的壁纸'}。${layout}高清，色调统一协调，不要文字、不要水印、不要边框。`;
}
