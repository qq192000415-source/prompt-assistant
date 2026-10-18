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

// 主进程只带 Node 的类型，没有 DOM 的 RequestInfo；SuYan 的 platformFetch 签名里用到它。
declare global {
  type RequestInfo = string | URL | Request;
}
