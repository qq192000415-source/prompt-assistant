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
