// 来图定制 AI 修图的浏览器部分：切出要发的那一块、调 custom:ai-edit、把结果贴回原图。几何和贴图规则在 retouch.ts。
// AI 修过的图一律存 PNG：原图里没改的像素解码出来和原来逐个相同（JPEG 再压一次会全变）。
import { colorStats, coverCrop, compositeMasked, editWindow, estimateAlignment, maskBounds, matchSeam, nearestRatio, outpaintPlan, ratioMatches, retouchPrompt, sendSize, toGray, transferColors, type RetouchKind } from './retouch.ts';

type AiEdit = (input: { prompt: string; imageDataUrl: string; maskDataUrl?: string; size: string; ratio: string }) => Promise<{ bytes: Uint8Array<ArrayBuffer>; ext: string }>;
export type RetouchResult = { bytes: Uint8Array<ArrayBuffer>; ext: string };

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.bmp': 'image/bmp' };
export const dataUrlOf = (bytes: Uint8Array<ArrayBuffer>, ext: string) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('图片读不出来'));
    reader.readAsDataURL(new Blob([bytes], { type: MIME[ext] ?? 'image/png' }));
  });
export const bytesOf = (dataUrl: string): RetouchResult => {
  const match = /^data:(image\/[\w+.-]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error('修图结果不是图片');
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { bytes, ext: match[1] === 'image/jpeg' ? '.jpg' : match[1] === 'image/webp' ? '.webp' : '.png' };
};
const bitmapOf = (bytes: Uint8Array<ArrayBuffer>) => createImageBitmap(new Blob([bytes]));

function canvas2d(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error(`画布创建失败（${width}×${height}），可能是内存不够`);
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}
const toPng = async (canvas: HTMLCanvasElement): Promise<RetouchResult> => {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('图片编码失败，可能是内存不够');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: '.png' };
};
// 对齐的相关性低于这个就当模型没按原图画，不贴。实测对上时在 0.98 左右。
const MIN_ALIGN_SCORE = 0.6;
const grayOf = (image: CanvasImageSource, width: number, height: number) => {
  const target = canvas2d(width, height);
  target.ctx.drawImage(image, 0, 0, width, height);
  return toGray(target.ctx.getImageData(0, 0, width, height).data, width, height);
};
const checkRatio = (want: number, image: ImageBitmap) => {
  if (!ratioMatches(want, image.width, image.height)) throw new Error(`模型给的图比例不对（${image.width}×${image.height}），贴回去会错位，没有用。请再试一次`);
};

// 局部修改：marked 是画上标记色的整图，mask 是画布编辑器给的遮罩（没涂的白、涂过的透明）。
export async function localEdit(aiEdit: AiEdit, original: ImageBitmap, input: { marked: string; mask: string; color: string; kind: RetouchKind; custom: string }) {
  const prompt = retouchPrompt(input.kind, input.color, input.custom);
  const { width, height } = original;
  const [marked, mask] = await Promise.all([bitmapOf(bytesOf(input.marked).bytes), bitmapOf(bytesOf(input.mask).bytes)]);
  // 换成「涂过的 alpha 不为 0」，和 retouch.ts 的约定一致。
  const maskCanvas = canvas2d(width, height);
  maskCanvas.ctx.drawImage(mask, 0, 0, width, height);
  const paint = maskCanvas.ctx.getImageData(0, 0, width, height).data;
  for (let index = 3; index < paint.length; index += 4) paint[index] = 255 - paint[index];
  const bounds = maskBounds(paint, width, height);
  if (!bounds) throw new Error('先在图上涂要改的地方');
  const window = editWindow(bounds, width, height);
  const send = sendSize(window, 1536);
  const crop = (image: ImageBitmap) => {
    const target = canvas2d(send.width, send.height);
    target.ctx.drawImage(image, window.x, window.y, window.w, window.h, 0, 0, send.width, send.height);
    return target.canvas;
  };
  const result = await bitmapOf(
    (
      await aiEdit({
        prompt,
        imageDataUrl: crop(marked).toDataURL('image/jpeg', 0.95),
        maskDataUrl: crop(mask).toDataURL('image/png'),
        size: window.ratio.size,
        ratio: window.ratio.label,
      })
    ).bytes,
  );
  checkRatio(window.ratio.value, result);
  // 找出模型把这一块画到了结果的哪里（只比没涂的地方），按找到的位置缩放贴回；结果没盖到的地方保留原图。
  const keep = crop(mask).getContext('2d')!.getImageData(0, 0, send.width, send.height).data;
  const valid = new Uint8Array(send.width * send.height);
  for (let index = 0; index < valid.length; index += 1) valid[index] = keep[index * 4 + 3] > 0 ? 1 : 0;
  const align = estimateAlignment(grayOf(crop(original), send.width, send.height), grayOf(result, result.width, result.height), { scale: result.width / send.width, dx: 0, dy: 0 }, valid, { scale: 0.15, shift: 0.1 });
  if (align.score < MIN_ALIGN_SCORE) throw new Error('AI 给的图和原图对不上（构图被改了），没有用。请再试一次');
  const before = canvas2d(window.w, window.h);
  before.ctx.drawImage(original, window.x, window.y, window.w, window.h, 0, 0, window.w, window.h);
  const scaled = canvas2d(window.w, window.h);
  scaled.ctx.drawImage(before.canvas, 0, 0);
  const factor = 1 / (align.scale * (send.width / window.w));
  scaled.ctx.setTransform(factor, 0, 0, factor, -align.dx * factor, -align.dy * factor);
  scaled.ctx.drawImage(result, 0, 0);
  scaled.ctx.setTransform(1, 0, 0, 1, 0, 0);
  const windowPaint = new Uint8ClampedArray(window.w * window.h * 4);
  for (let row = 0; row < window.h; row += 1) {
    const from = ((window.y + row) * width + window.x) * 4;
    windowPaint.set(paint.subarray(from, from + window.w * 4), row * window.w * 4);
  }
  // 调色对齐：模型常把这一块整体调亮调灰（实测去水印后补的那块发白），按这一块里没涂的地方把结果的颜色拉回原图。
  const beforePixels = before.ctx.getImageData(0, 0, window.w, window.h).data;
  const aiPixels = scaled.ctx.getImageData(0, 0, window.w, window.h).data;
  const painted = (pixel: number) => windowPaint[pixel * 4 + 3] > 0;
  const step = Math.max(1, Math.round((window.w * window.h) / 250_000));
  const matched = transferColors(aiPixels, colorStats(aiPixels, step, painted), colorStats(beforePixels, step, painted));
  const merged = compositeMasked(beforePixels, matched, windowPaint, window.w, window.h);
  const out = canvas2d(width, height);
  out.ctx.drawImage(original, 0, 0);
  out.ctx.putImageData(new ImageData(merged, window.w, window.h), window.x, window.y);
  return toPng(out.canvas);
}

// 扩成方形：新增区域填标记色、遮罩里透明。模型不按原位置画（实测把原图缩到约 79%），所以先找出原图在结果里的位置，
// 把结果缩放到原图 1:1，整体调色对齐，再把紧贴原图外面的 AI 像素调到和原图边缘同色、往外慢慢恢复，最后原样贴回原图。
// 主人 2026-10-24 选了「调色对齐 + 边缘过渡」；实测过渡放在 AI 这一侧就看不出接缝，原图一个像素都不用改（往原图里渐变反而多出一条线）。
// 最后按选的边长裁成方形，原图在模型留的位置上。
export async function outpaint(aiEdit: AiEdit, original: ImageBitmap, extra: number) {
  const plan = outpaintPlan(original.width, original.height, extra);
  // 发送最大 2048：Gemini 按像素数出 2K，GPT 不管 size 固定出约 1254²。
  const n = Math.min(plan.side, 2048);
  const scale = n / plan.side;
  const marked = canvas2d(n, n);
  marked.ctx.fillStyle = '#00ff00';
  marked.ctx.fillRect(0, 0, n, n);
  marked.ctx.drawImage(original, plan.x * scale, plan.y * scale, original.width * scale, original.height * scale);
  const mask = canvas2d(n, n);
  mask.ctx.fillStyle = '#ffffff';
  mask.ctx.fillRect(plan.x * scale, plan.y * scale, original.width * scale, original.height * scale);
  const result = await bitmapOf(
    (await aiEdit({ prompt: retouchPrompt('outpaint'), imageDataUrl: marked.canvas.toDataURL('image/jpeg', 0.95), maskDataUrl: mask.canvas.toDataURL('image/png'), size: `${n}x${n}`, ratio: '1:1' })).bytes,
  );
  checkRatio(1, result);
  const { width, height } = original;
  // 原图缩到最长边 1024 再比，大图也快；k 是按请求时摆的位置预计的「结果像素 / 原图像素」。
  const shrink = Math.min(1, 1024 / Math.max(width, height));
  const k = result.width / plan.side;
  const align = estimateAlignment(grayOf(original, Math.round(width * shrink), Math.round(height * shrink)), grayOf(result, result.width, result.height), { scale: k / shrink, dx: plan.x * k, dy: plan.y * k });
  if (align.score < MIN_ALIGN_SCORE) throw new Error('AI 补的图和原图对不上（构图被改了），没有用。请再试一次');
  const perPixel = align.scale * shrink;
  const full = Math.round(result.width / perPixel);
  const x = Math.round(align.dx / perPixel);
  const y = Math.round(align.dy / perPixel);
  if (x < 0 || y < 0 || x + width > full || y + height > full) throw new Error('AI 补的图把原图切掉了一部分，没有用。请再试一次');
  const canvas = canvas2d(full, full);
  canvas.ctx.drawImage(result, 0, 0, full, full);
  const ai = canvas.ctx.getImageData(0, 0, full, full).data;
  const source = canvas2d(width, height);
  source.ctx.drawImage(original, 0, 0);
  const pixels = source.ctx.getImageData(0, 0, width, height).data;
  // AI 在原图位置画的那块和原图比，得出要怎么调色。
  const step = Math.max(1, Math.round((width * height) / 250_000));
  const matched = transferColors(ai, colorStats(canvas.ctx.getImageData(x, y, width, height).data, step), colorStats(pixels, step));
  // 贴边色差：原图边缘和外面各取 2% 求平均，影响范围到边长的 15%（只改原图外面）。
  const band = Math.max(4, Math.round(Math.max(width, height) * 0.02));
  canvas.ctx.putImageData(new ImageData(matchSeam(matched, full, pixels, width, height, x, y, band, Math.max(16, full * 0.15), Math.max(8, Math.round(full * 0.02))), full, full), 0, 0);
  canvas.ctx.drawImage(original, x, y);
  // 按选的边长裁：原图尽量放在计划的位置，出界就往里收；模型留的边比选的少时就用整张。
  const side = Math.min(plan.side, full);
  const left = Math.min(Math.max(x - plan.x, 0), full - side);
  const top = Math.min(Math.max(y - plan.y, 0), full - side);
  const out = canvas2d(side, side);
  out.ctx.drawImage(canvas.canvas, left, top, side, side, 0, 0, side, side);
  return toPng(out.canvas);
}

// AI 放大用不了时的普通放大：浏览器高质量插值放大 4 倍，只是变大，细节不会变多。
export async function plainUpscale(original: ImageBitmap) {
  const out = canvas2d(original.width * 4, original.height * 4);
  out.ctx.drawImage(original, 0, 0, out.canvas.width, out.canvas.height);
  return toPng(out.canvas);
}

// 整图变清晰：整张重画，按最接近的比例请求（Gemini 按原图大小出 2K/4K），结果按原图比例居中裁，
// 再把整体颜色拉回原图的色调（实测模型会顺手把复古滤镜调成正常饱和度，主人 2026-10-24 定的）。
export async function restore(aiEdit: AiEdit, original: ImageBitmap) {
  const ratio = nearestRatio(original.width, original.height);
  const long = Math.min(Math.max(original.width, original.height), 4096);
  const [w, h] = ratio.value >= 1 ? [long, Math.round(long / ratio.value)] : [Math.round(long * ratio.value), long];
  const send = sendSize({ w: original.width, h: original.height }, 2048);
  const input = canvas2d(send.width, send.height);
  input.ctx.drawImage(original, 0, 0, send.width, send.height);
  const result = await bitmapOf((await aiEdit({ prompt: retouchPrompt('restore'), imageDataUrl: input.canvas.toDataURL('image/jpeg', 0.95), size: `${w}x${h}`, ratio: ratio.label })).bytes);
  const crop = coverCrop(result.width, result.height, original.width / original.height);
  const out = canvas2d(crop.w, crop.h);
  out.ctx.drawImage(result, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
  const restored = out.ctx.getImageData(0, 0, crop.w, crop.h).data;
  const reference = input.ctx.getImageData(0, 0, send.width, send.height).data;
  const step = Math.max(1, Math.round((crop.w * crop.h) / 250_000));
  out.ctx.putImageData(new ImageData(transferColors(restored, colorStats(restored, step), colorStats(reference, step)), crop.w, crop.h), 0, 0);
  return toPng(out.canvas);
}
