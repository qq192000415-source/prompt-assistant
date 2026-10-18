// 创作画布：调生图模型，以及把生成结果变成素材条目的内容。请求、参数和结果解析全用 SuYan 的
// generateImagesWithRemoteApi / generateVideosWithRemoteApi。结果只回给画布显示，用户点「存入素材库」才上传（见 index.ts）。
// 不依赖 Electron，Node 测试可直接加载。
import { toSettings, type AiRuntime } from './ai.ts';
import type { AiImageGenerationPayload } from './suyan/aiTypes.ts';
import { compactAutomaticPromptTitle } from './suyan/promptTitle.ts';
import { detectImageMimeFromBytes, generateImagesWithRemoteApi, generateVideosWithRemoteApi } from './suyan/remoteAiClient.ts';

export const CANVAS_CATEGORY = '画布生成';

export function generateMedia(runtime: AiRuntime, payload: AiImageGenerationPayload) {
  if (!runtime.image) throw new Error('还没有设置生图模型，请在素材库设置的 AI 助手里填写');
  if (!payload.prompt?.trim()) throw new Error('先写正向提示词');
  const settings = toSettings(runtime.image);
  const rules = runtime.instructions('image-generation');
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
