// 批量任务的公共部分：同一时间只跑一个、可取消、进度和失败记录的格式。不依赖 Electron，Node 测试可直接加载。

export type BatchProgress = { task: string; done: number; total: number; current: string };
export type Report = (progress: BatchProgress) => void;
export type Failure = { name: string; message: string };

let running: AbortController | null = null;

export function cancelBatch() {
  running?.abort();
}

// 返回的 signal 用于取消；已有任务在跑时直接报错，不排队。
export async function exclusive<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (running) throw new Error('已有一个批量任务在进行，请等它结束或先取消');
  running = new AbortController();
  try {
    return await work(running.signal);
  } finally {
    running = null;
  }
}

export const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
