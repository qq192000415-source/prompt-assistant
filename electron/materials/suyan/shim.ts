// 给原样移植的 SuYan 文件用的替身：SuYan 有自己的日志系统和带错误码的 AppError，这里换成控制台日志和普通 Error。

type Details = Record<string, unknown>;

export const logger = {
  info: (scope: string, event: string, details?: Details) => console.info(`[${scope}] ${event}`, details ?? ''),
  warn: (scope: string, event: string, details?: Details) => console.warn(`[${scope}] ${event}`, details ?? ''),
  error: (scope: string, event: string, details?: Details) => console.error(`[${scope}] ${event}`, details ?? ''),
};

export class AppError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// SuYan 的 AI 类型里引用了提示词条目类型，素材库的 AI 用不到这些字段，给个宽松的替身。
export type PromptType = string;
export type PromptVariable = { name: string; [key: string]: unknown };
export type PromptImageLexiconEntry = import('./tagKnowledgeTypes.ts').TagKnowledge & {
  id: string;
  group: string;
  label: string;
  description: string;
  parentId?: string | null;
  imageFileName?: string | null;
};

// SuYan 读的是本机素材库里的文件；这里调用方先把 NAS 上的图下载到临时文件，直接把路径传进来。
export const resolveLibraryMediaPath = async (filePath: string) => filePath;

// 主进程只带 Node 的类型，没有 DOM 的 RequestInfo、BodyInit；SuYan 的请求函数签名里用到它们。
declare global {
  type RequestInfo = string | URL | Request;
  type BodyInit = NonNullable<RequestInit["body"]>;
}

// SuYan 的画布参考图存在本机素材库里，按文件名读；这里参考图一律以 data URL 传入，走不到这条路。
export async function readCanvasReferenceImage(_fileName: string): Promise<{ dataUrl: string; fileName: string }> {
  throw new AppError('AI_REFERENCE_IMAGE_MISSING', '参考图要以图片数据传入');
}

// sharp 的替身：SuYan 生图时只用到 metadata（尺寸、通道）、stats（透明度）和转 JPEG。
// 尺寸和通道读文件头，纯 JS，Node 测试也能用；透明度和转 JPEG 要解码像素，用 Electron 的 nativeImage。
type ImageHeader = { format: 'png' | 'jpeg' | 'webp'; width: number; height: number; channels: number; hasAlpha: boolean };

function readImageHeader(bytes: Buffer): ImageHeader | null {
  if (bytes.length > 26 && bytes.readUInt32BE(0) === 0x89504e47) {
    const colorType = bytes[25];
    const channels = colorType === 6 ? 4 : colorType === 4 ? 2 : colorType === 0 ? 1 : 3;
    return { format: 'png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), channels, hasAlpha: channels === 2 || channels === 4 || bytes.includes('tRNS') };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    // 找 SOF 段（C0–CF，去掉 C4 霍夫曼表、C8 保留、CC 算术编码表）。
    for (let offset = 2; offset + 9 < bytes.length; ) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { format: 'jpeg', height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7), channels: bytes[offset + 9], hasAlpha: false };
      }
      offset += 2 + bytes.readUInt16BE(offset + 2);
    }
    return null;
  }
  if (bytes.length > 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = bytes.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return { format: 'webp', width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff, channels: 3, hasAlpha: false };
    if (chunk === 'VP8L') {
      const bits = bytes.readUInt32LE(21);
      const hasAlpha = Boolean((bits >>> 28) & 1);
      return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, channels: hasAlpha ? 4 : 3, hasAlpha };
    }
    if (chunk === 'VP8X') {
      const hasAlpha = Boolean(bytes[20] & 0x10);
      return { format: 'webp', width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3), channels: hasAlpha ? 4 : 3, hasAlpha };
    }
  }
  return null;
}

async function decode(bytes: Buffer) {
  const { nativeImage } = (await import('electron')) as Partial<typeof import('electron')>;
  if (!nativeImage) throw new Error('当前环境不能解码图片');
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw new Error('无法解码这张图片');
  return image;
}

export function getSharp() {
  return (bytes: Buffer) => {
    let jpegQuality = 0;
    const pipeline = {
      // ponytail: 不按 EXIF 方向旋转；只有参考图转 JPEG 时用到，生图接口返回的图本身没有旋转信息。
      rotate: () => pipeline,
      jpeg: (options: { quality?: number; mozjpeg?: boolean } = {}) => {
        jpegQuality = options.quality ?? 90;
        return pipeline;
      },
      toBuffer: async () => {
        if (!jpegQuality) throw new Error('只支持转 JPEG');
        return (await decode(bytes)).toJPEG(jpegQuality);
      },
      metadata: async () => {
        const header = readImageHeader(bytes);
        if (!header) throw new Error('无法读取图片尺寸');
        return header;
      },
      // 只给出 SuYan 用到的透明通道最小值；nativeImage 的位图是 BGRA，第 4 个字节是透明度。
      // Node 测试里没有 nativeImage 时按不透明处理。
      stats: async () => {
        let minAlpha = 255;
        try {
          const bitmap = (await decode(bytes)).toBitmap();
          for (let index = 3; index < bitmap.length && minAlpha > 0; index += 4) minAlpha = Math.min(minAlpha, bitmap[index]);
        } catch {
          minAlpha = 255;
        }
        return { channels: [{ min: 0 }, { min: 0 }, { min: 0 }, { min: minAlpha }] };
      },
    };
    return pipeline;
  };
}
