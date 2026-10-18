// 创作画布的任务队列：一次提交是一个任务，任务里每张图是一个槽位，单独请求（n=1），一张失败不连累同批的其他图。
// 同时运行的槽位数不超过并发上限，超出的排队；临时失败自动重试；任务和槽位都能取消。
// 生成和保存由调用方注入（index.ts 里接 SuYan 的生图和 NAS 历史），所以这里不依赖 Electron，Node 测试可直接加载。
import crypto from 'node:crypto';
import type { CanvasOrigin } from './canvas.ts';
import type { HistoryMedia, HistoryParams } from './canvasHistory.ts';
import type { AiImageGenerationPayload } from './suyan/aiTypes.ts';

export type SlotStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled';
export type QueueSlot = {
  index: number;
  status: SlotStatus;
  attempts: number;
  error: string;
  media: HistoryMedia | null;
  revisedPrompt: string | null;
  // 生成成功但存进 NAS 历史失败时才有：图还在内存里，界面仍能「存入素材库」或「另存为」，不白花这次的钱。
  dataUrl: string | null;
};
export type TaskMeta = { model: string; prompt: string; negativePrompt: string; params: HistoryParams; origin: CanvasOrigin | null; referenceCount: number };
export type QueueTask = TaskMeta & { id: string; createdAt: string; total: number; slots: QueueSlot[] };
// model 是实际生成这张图的模型：重试前改了设置时，和提交时记下的不一样。
export type Generated = { dataUrl: string; revisedPrompt: string | null; mediaType: 'image' | 'video'; model?: string };

type Deps = {
  generate: (payload: AiImageGenerationPayload) => Promise<Generated>;
  // 存图并把这个槽位写进历史，返回存好的媒体。
  persist: (task: QueueTask, slot: QueueSlot, generated: Generated) => Promise<HistoryMedia>;
  // 把失败的槽位写进历史；写不进去不影响队列。
  recordFailure: (task: QueueTask, slot: QueueSlot) => Promise<void>;
  limits: () => { concurrency: number; retries: number };
  onChange: () => void;
  wait?: (ms: number) => Promise<void>;
};

// 重试也不会成功的错误：参数、Key、权限、内容审核、接口不支持。其余（超时、断网、限流、5xx、返回空）都算临时失败。
const PERMANENT = /状态码 (400|401|402|403|404|405|413|415|422)\b|AI_SETTINGS_INCOMPLETE|AI_PROMPT_EMPTY|AI_BASE_URL_INVALID|AI_REFERENCE_|AI_VIDEO_(PROVIDER|MODEL)_UNSUPPORTED|AI_VIDEO_REFERENCE_LIMIT|AI_VIDEO_TASK_FAILED|还没有设置生图模型|先写正向提示词/;

export function isRetryable(error: unknown) {
  const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : '';
  const message = error instanceof Error ? error.message : String(error);
  return !PERMANENT.test(`${code} ${message}`);
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
const RETRY_DELAY_MS = 1500;

export function createCanvasQueue(deps: Deps) {
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const tasks: QueueTask[] = [];
  const payloads = new Map<string, AiImageGenerationPayload>();
  // 每次开跑一个槽位发一个令牌；取消或重试后令牌变了，迟到的结果直接丢掉。
  const tokens = new Map<QueueSlot, object>();
  let running = 0;

  const find = (taskId: string) => {
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task) throw new Error('这个任务已经不在队列里了');
    return task;
  };

  async function run(task: QueueTask, slot: QueueSlot, token: object) {
    const payload = payloads.get(task.id)!;
    const alive = () => tokens.get(slot) === token;
    const { retries } = deps.limits();
    try {
      for (let attempt = 1; ; attempt += 1) {
        slot.attempts = attempt;
        let generated: Generated;
        try {
          generated = await deps.generate(payload);
        } catch (error) {
          if (!alive()) return;
          if (attempt > retries || !isRetryable(error)) {
            slot.status = 'failed';
            slot.error = reason(error);
            deps.onChange();
            await deps.recordFailure(task, slot).catch((recordError) => console.warn('失败记录没写进生成历史', recordError));
            return;
          }
          slot.error = `第 ${attempt} 次失败：${reason(error)}，正在重试`;
          deps.onChange();
          await wait(RETRY_DELAY_MS * attempt);
          if (!alive()) return;
          continue;
        }
        if (!alive()) return;
        if (generated.model) task.model = generated.model;
        try {
          slot.media = await deps.persist(task, slot, generated);
          slot.dataUrl = null;
          slot.error = '';
        } catch (error) {
          slot.dataUrl = generated.dataUrl;
          slot.error = `图生成好了，但没存进 NAS 的生成历史：${reason(error)}。可以先存入素材库或另存为`;
        }
        if (!alive()) return;
        slot.revisedPrompt = generated.revisedPrompt;
        slot.status = 'done';
        deps.onChange();
        return;
      }
    } finally {
      if (alive()) {
        tokens.delete(slot);
        running -= 1;
        pump();
      }
    }
  }

  function pump() {
    const { concurrency } = deps.limits();
    for (const task of [...tasks].reverse()) {
      for (const slot of task.slots) {
        if (running >= concurrency) return;
        if (slot.status !== 'queued') continue;
        slot.status = 'running';
        slot.error = '';
        const token = {};
        tokens.set(slot, token);
        running += 1;
        deps.onChange();
        void run(task, slot, token);
      }
    }
  }

  // 释放正在跑的槽位：已经发出的请求停不下来（SuYan 的生图函数不接收取消信号），服务商那边可能仍会生成并计费，结果到了也丢掉。
  function release(slot: QueueSlot) {
    if (slot.status === 'running' && tokens.has(slot)) {
      tokens.delete(slot);
      running -= 1;
    }
  }

  return {
    // 先提交的先跑；界面上最新的任务排在最前面。
    submit(meta: TaskMeta, payload: AiImageGenerationPayload, count: number) {
      const total = meta.params.mediaType === 'video' ? 1 : Math.max(1, Math.min(4, Math.round(count)));
      const task: QueueTask = {
        ...meta,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        total,
        slots: Array.from({ length: total }, (_, index) => ({ index, status: 'queued', attempts: 0, error: '', media: null, revisedPrompt: null, dataUrl: null })),
      };
      payloads.set(task.id, { ...payload, n: 1 });
      tasks.unshift(task);
      deps.onChange();
      pump();
      return task.id;
    },
    cancel(taskId: string) {
      const task = find(taskId);
      for (const slot of task.slots) {
        if (slot.status !== 'queued' && slot.status !== 'running') continue;
        release(slot);
        slot.status = 'canceled';
        slot.error = '';
      }
      deps.onChange();
      pump();
    },
    // 只重新生成这一张（失败或取消的）。
    retry(taskId: string, index: number) {
      const slot = find(taskId).slots.find((entry) => entry.index === index);
      if (!slot || (slot.status !== 'failed' && slot.status !== 'canceled')) throw new Error('这张图不需要重试');
      Object.assign(slot, { status: 'queued', attempts: 0, error: '', media: null, revisedPrompt: null, dataUrl: null });
      deps.onChange();
      pump();
    },
    // 全部槽位都结束的任务从队列里拿掉（它们已经在生成历史里）；还有内存里的图没存进历史的不拿掉。
    dismiss(taskId: string) {
      const index = tasks.findIndex((entry) => entry.id === taskId);
      if (index < 0) return;
      if (tasks[index].slots.some((slot) => slot.status === 'queued' || slot.status === 'running')) throw new Error('任务还在进行，先取消再移除');
      tasks.splice(index, 1);
      payloads.delete(taskId);
      deps.onChange();
    },
    snapshot: () => tasks.map((task) => ({ ...task, slots: task.slots.map((slot) => ({ ...slot })) })),
    running: () => running,
  };
}
