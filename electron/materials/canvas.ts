// 创作画布：调生图模型，以及把生成结果变成素材条目的内容。请求、参数和结果解析全用 SuYan 的
// generateImagesWithRemoteApi / generateVideosWithRemoteApi。结果只回给画布显示，用户点「存入素材库」才上传（见 index.ts）。
// 不依赖 Electron，Node 测试可直接加载。
import { toSettings, type AiRuntime } from './ai.ts';
import type { AiImageGenerationPayload } from './suyan/aiTypes.ts';
import { compactAutomaticPromptTitle } from './suyan/promptTitle.ts';
import { detectImageMimeFromBytes, generateImagesWithRemoteApi, generateVideosWithRemoteApi } from './suyan/remoteAiClient.ts';
import { readImageHeader } from './suyan/shim.ts';

export const CANVAS_CATEGORY = '画布生成';

type Shape = 'landscape' | 'portrait' | 'square';
const SHAPE_LABELS: Record<Shape, string> = { landscape: '横版', portrait: '竖版', square: '方形' };
const SHAPE_EN: Record<Shape, string> = { landscape: 'landscape (wider than tall)', portrait: 'portrait (taller than wide)', square: 'square' };
const parseSize = (size: string | undefined) => {
  const match = /^(\d+)x(\d+)$/.exec(size ?? '');
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
};
// 宽高比相差 10% 以内算方形，网关把 1312×736 换成 1536×1024 这类相近尺寸不算不对。
const shapeOf = (width: number, height: number): Shape => (width / height > 1.1 ? 'landscape' : height / width > 1.1 ? 'portrait' : 'square');

// 选了固定尺寸时把比例也写进生成规则：有的网关不认 size 参数，只按提示词决定横竖
// （实测主人 cliproxyapi 上的 gpt-image-2.5-sunburst：size 传 1312x736、1536x1024、1024x1024 都返回同一个尺寸）。
export function aspectRatioRule(payload: Pick<AiImageGenerationPayload, 'size' | 'ratio'>) {
  const size = parseSize(payload.size);
  if (!size) return '';
  const shape = shapeOf(size.width, size.height);
  const ratio = payload.ratio ? `${payload.ratio} ` : '';
  return `画面比例必须是 ${ratio}${SHAPE_LABELS[shape]}（${size.width}×${size.height}），按这个比例构图，不要改成别的比例。Output aspect ratio must be ${ratio}${SHAPE_EN[shape]}, ${size.width}x${size.height}.`;
}

// 模型给的图横竖和选的不一样时返回提示，显示在这张图下面，不悄悄存一张比例不对的图。
export function sizeMismatchWarning(payload: Pick<AiImageGenerationPayload, 'size' | 'ratio'>, buffer: Buffer) {
  const size = parseSize(payload.size);
  const header = size ? readImageHeader(buffer) : null;
  if (!size || !header) return '';
  const wanted = shapeOf(size.width, size.height);
  const got = shapeOf(header.width, header.height);
  if (wanted === got) return '';
  return `比例不对：选的是${payload.ratio ? ` ${payload.ratio} ` : ''}${SHAPE_LABELS[wanted]}，模型给的是 ${header.width}×${header.height} ${SHAPE_LABELS[got]}。这个模型或接口没按选的尺寸出图，可以在提示词里写明横版或竖版构图后重试，或者换一个模型`;
}

export function generateMedia(runtime: AiRuntime, payload: AiImageGenerationPayload) {
  if (!runtime.image) throw new Error('还没有设置生图模型，请在素材库设置的 AI 助手里填写');
  if (!payload.prompt?.trim()) throw new Error('先写正向提示词');
  const settings = toSettings(runtime.image);
  const rules = [runtime.instructions('image-generation'), payload.mediaType === 'video' ? '' : aspectRatioRule(payload)].filter(Boolean).join('\n');
  return payload.mediaType === 'video'
    ? generateVideosWithRemoteApi(settings, payload, rules)
    : generateImagesWithRemoteApi(settings, payload, rules);
}

const IMAGE_EXTS = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' } as const;

// 生成结果是 data URL；按文件内容判断格式，不信它声明的类型（SuYan 也是这么做的）。
export function decodeGeneratedMedia(dataUrl: string) {
  const match = /^data:([^;,]+)?;base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error('生成结果不是图片数据');
  const buffer = Buffer.from(match[2], 'base64');
  const imageMime = detectImageMimeFromBytes(buffer);
  if (imageMime) return { buffer, ext: IMAGE_EXTS[imageMime] };
  if (buffer.length > 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return { buffer, ext: '.mp4' };
  throw new Error('生成结果不是可识别的 PNG、JPEG、WebP 图片或 MP4 视频');
}

// 从素材详情页「发到画布」带来的来源组。提示词没改时，新图沿用来源组的标题、分类、标签，归进同一组。
export type CanvasOrigin = { prompt: string; negativePrompt: string; title: string; category: string; tags: string[] };

const sameText = (left: string, right: string) => left.trim().replace(/\s+/g, ' ').toLowerCase() === right.trim().replace(/\s+/g, ' ').toLowerCase();

export function savedItemText(input: { prompt: string; negativePrompt: string; origin: CanvasOrigin | null }) {
  const { prompt, negativePrompt, origin } = input;
  if (origin && sameText(origin.prompt, prompt) && sameText(origin.negativePrompt, negativePrompt)) {
    return { text: { title: origin.title, prompt, negativePrompt, tags: origin.tags }, category: origin.category };
  }
  return { text: { title: compactAutomaticPromptTitle(prompt, CANVAS_CATEGORY), prompt, negativePrompt, tags: [] }, category: CANVAS_CATEGORY };
}
