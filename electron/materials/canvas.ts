// 创作画布：调生图模型，以及把生成结果变成素材条目的内容。请求、参数和结果解析全用 SuYan 的
// generateImagesWithRemoteApi / generateVideosWithRemoteApi。结果只回给画布显示，用户点「存入素材库」才上传（见 index.ts）。
// 不依赖 Electron，Node 测试可直接加载。
import { isGeminiImageModel } from '../../src/materials/library.ts';
import { toSettings, type AiRuntime } from './ai.ts';
import type { AiImageGenerationData, AiImageGenerationPayload, AiProviderSettings } from './suyan/aiTypes.ts';
import { compactAutomaticPromptTitle } from './suyan/promptTitle.ts';
import { buildImageGenerationRequestBody, detectImageMimeFromBytes, generateImagesWithRemoteApi, generateVideosWithRemoteApi, requestChatCompletions } from './suyan/remoteAiClient.ts';
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

// 宽高比偏差超过这么多就提示。网关按自己的档位出图，像素数和选的有出入很正常，不到一半才提示。
const RATIO_TOLERANCE = 0.08;

// 模型给的图横竖不对、宽高比偏差太大、或像素不到选的一半时返回提示，显示在这张图下面，不悄悄存一张不对的图。
// 2026-10-20 真实网关验收：gpt-image-2.5-sunburst 绝大多数比例误差在 0.1% 以内，但 9:16 偶尔给出 850×1851（偏 18%），只比横竖时没有提示。
// 2026-10-21 实测：GPT 生图经主人的 cliproxy（ChatGPT 订阅通道）上游丢掉 size 和 quality，选 2K、4K 都固定约 157 万像素。
export function sizeMismatchWarning(payload: Pick<AiImageGenerationPayload, 'size' | 'ratio'>, buffer: Buffer) {
  const size = parseSize(payload.size);
  const header = size ? readImageHeader(buffer) : null;
  if (!size || !header) return '';
  const wanted = shapeOf(size.width, size.height);
  const got = shapeOf(header.width, header.height);
  if (wanted !== got) {
    return `比例不对：选的是${payload.ratio ? ` ${payload.ratio} ` : ''}${SHAPE_LABELS[wanted]}，模型给的是 ${header.width}×${header.height} ${SHAPE_LABELS[got]}。这个模型或接口没按选的尺寸出图，可以在提示词里写明横版或竖版构图后重试，或者换一个模型`;
  }
  const wantedRatio = size.width / size.height;
  const deviation = Math.abs(header.width / header.height - wantedRatio) / wantedRatio;
  if (deviation > RATIO_TOLERANCE) {
    return `比例偏了：选的是 ${payload.ratio || SHAPE_LABELS[wanted]}（${size.width}×${size.height}），模型给的是 ${header.width}×${header.height}，宽高比差了 ${Math.round(deviation * 100)}%。模型偶尔会这样，可以再生成一次`;
  }
  const wantedPixels = size.width * size.height;
  const gotPixels = header.width * header.height;
  if (gotPixels * 2 >= wantedPixels) return '';
  const wan = (pixels: number) => Math.round(pixels / 10_000);
  return `分辨率不够：选的是 ${size.width}×${size.height}（约 ${wan(wantedPixels)} 万像素），模型给的是 ${header.width}×${header.height}（约 ${wan(gotPixels)} 万像素）。这个模型或接口不按选的分辨率出图（GPT 生图经中转时固定约 160 万像素），要大图请换 Gemini 生图模型，比如 gemini-3.1-flash-image`;
}

// Gemini 生图（Nano Banana）走 /chat/completions，比例和分辨率放在 image_config 里（OpenRouter 的写法，cliproxy 转成 Gemini 的 imageConfig）。
// 2026-10-21 实测主人的 cliproxy：gemini-3.1-flash-image 16:9 选 1K/2K/4K 出 1376×768 / 2752×1536 / 5504×3072。SuYan 没有这条路，写在这里。
const GEMINI_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
// 4K 图 base64 有十几 MB，国内经中转慢，给足时间。
const GEMINI_TIMEOUT_MS = 300_000;

export function geminiImageConfig(payload: Pick<AiImageGenerationPayload, 'size' | 'ratio'>) {
  const size = parseSize(payload.size);
  if (!size) return null;
  const wanted = size.width / size.height;
  const [nearest] = GEMINI_RATIOS.map((ratio) => {
    const [width, height] = ratio.split(':').map(Number);
    return { ratio, deviation: Math.abs(width / height - wanted) / wanted };
  }).sort((left, right) => left.deviation - right.deviation);
  if (nearest.deviation > RATIO_TOLERANCE) {
    throw new Error(`Gemini 生图不支持 ${payload.ratio ?? `${size.width}×${size.height}`} 这个比例，可选 ${GEMINI_RATIOS.join('、')}`);
  }
  // 画布的 1K/2K/4K 约 100 万/400 万/1600 万像素；3K（约 900 万）和大的自定义尺寸按 4K 请求。
  const pixels = size.width * size.height;
  return { aspect_ratio: nearest.ratio, image_size: pixels <= 2_000_000 ? '1K' : pixels <= 6_000_000 ? '2K' : '4K' };
}

type ChatImageResponse = { choices?: Array<{ message?: { content?: unknown; images?: Array<{ image_url?: { url?: string } }> } }> };

async function generateGeminiImage(settings: AiProviderSettings, payload: AiImageGenerationPayload, rules: string): Promise<AiImageGenerationData> {
  const imageConfig = geminiImageConfig(payload);
  // 提示词（正向 + 生成规则 + 负向）和 SuYan 生图时拼的一样；遮罩不发，只靠参考图上的绿色标记（和 Grok 一样）。
  const { prompt } = buildImageGenerationRequestBody(settings, payload, { customInstructions: rules });
  const content = [{ type: 'text', text: prompt }, ...(payload.referenceImageDataUrls ?? []).map((url) => ({ type: 'image_url', image_url: { url } }))];
  const body = { model: settings.model, messages: [{ role: 'user', content }], modalities: ['image', 'text'], ...(imageConfig ? { image_config: imageConfig } : {}) };
  const message = ((await requestChatCompletions(settings, body, false, GEMINI_TIMEOUT_MS)) as ChatImageResponse).choices?.[0]?.message;
  const text = typeof message?.content === 'string' ? message.content : '';
  const dataUrl = message?.images?.[0]?.image_url?.url ?? /data:image\/[\w+.-]+;base64,[A-Za-z0-9+/=]+/.exec(text)?.[0];
  // 没出图时模型通常会用文字说明原因（比如内容不合规），带上给用户看。
  if (!dataUrl) throw new Error(`模型没有返回图片${text.trim() ? `：${text.trim().slice(0, 200)}` : ''}`);
  return { images: [{ dataUrl, revisedPrompt: null, mediaType: 'image' }], model: settings.model, mediaType: 'image' };
}

export function generateMedia(runtime: AiRuntime, payload: AiImageGenerationPayload) {
  if (!runtime.image) throw new Error('还没有设置生图模型，请在「设置 > API 配置」里填写');
  if (!payload.prompt?.trim()) throw new Error('先写正向提示词');
  const settings = toSettings(runtime.image);
  const rules = [runtime.instructions('image-generation'), payload.mediaType === 'video' ? '' : aspectRatioRule(payload)].filter(Boolean).join('\n');
  if (payload.mediaType === 'video') return generateVideosWithRemoteApi(settings, payload, rules);
  return isGeminiImageModel(settings.model) ? generateGeminiImage(settings, payload, rules) : generateImagesWithRemoteApi(settings, payload, rules);
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
