// 原样移植自 SuYan（MIT，guliacer）src/features/library/types/ai.ts 里生图相关的类型。
// 只摘了画布用到的这几个类型，原文照抄；主进程那份完整的在 electron/materials/suyan/aiTypes.ts。

export type AiImageGenerationSize = "auto" | `${number}x${number}`;

// 提示词助手改动（上游没有）：4:5、5:4、9:21。
export type AiImageGenerationRatio = "1:1" | "3:4" | "4:3" | "16:9" | "9:16" | "2:3" | "3:2" | "5:4" | "4:5" | "21:9" | "9:21";

export type AiImageGenerationQuality = "auto" | "low" | "medium" | "high";

export type AiImageGenerationFormat = "png" | "jpeg" | "webp";

export type AiImageGenerationBackground = "auto" | "opaque" | "transparent";

export type AiImageGenerationPayload = {
  /** Standard configured API or the embedded Doubao free web canvas. */
  generationProvider?: "api" | "doubao-web";
  /** The canvas media output. Omitted values retain the image default. */
  mediaType?: "image" | "video";
  apiProfileId?: string;
  apiModelId?: string;
  customInstructions?: string;
  /** Multiple reference images for image-to-image generation. */
  referenceImageFileNames?: string[];
  /** Multiple reference images as data URLs (image-to-image). */
  referenceImageDataUrls?: string[];
  prompt: string;
  negativePrompt?: string;
  size?: AiImageGenerationSize;
  /** Agnes Image 2.1 的档位式尺寸请求所使用的宽高比。 */
  ratio?: AiImageGenerationRatio;
  quality?: AiImageGenerationQuality;
  outputFormat?: AiImageGenerationFormat;
  background?: AiImageGenerationBackground;
  n?: number;
  /** 是否在生成完成或失败后向 TapRelay (localhost:1122) 发送提醒通知 */
  notificationEnabled?: boolean;
  /** Agnes video duration in seconds (4-12 for the 2.5 family). */
  videoSeconds?: number;
  /** Agnes video resolution tier. Flash only accepts 720P. */
  videoSize?: "720P" | "960P" | "2K";
  /** 豆包网页画布：用户选中的模型标签；空串表示跟随网页默认，不做自动切换。 */
  doubaoModel?: string;
  /** 豆包网页画布：用户选中的风格标签；空串表示跟随网页默认，不做自动切换。 */
  doubaoStyle?: string;
};

export type AiGeneratedImage = {
  /** Opaque main-process receipt for the account at generation time; not a login token. */
  attributionId?: string;
  dataUrl: string;
  revisedPrompt?: string | null;
  mediaType?: "image" | "video";
};
