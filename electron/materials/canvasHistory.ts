// 创作画布的生成历史：每张生成的图自动存一份到 NAS 的 canvas-history/，和素材库分开，一直保留到用户删除。
// 布局：canvas-history/history.json（全部任务）、media/<sha256><ext>（原图或视频）、thumbs/<sha256>.jpg（缩略图）。
// 写 history.json 一律走 mutateJsonFile 加锁，两台电脑同时生图也不会互相覆盖。不依赖 Electron，Node 测试可直接加载。
import { mutateJsonFile } from './libraryStore.ts';
import * as webdav from './webdav.ts';
import type { DavConfig } from './webdav.ts';
import type { CanvasOrigin } from './canvas.ts';

export const HISTORY_DIR = 'canvas-history/';
export const HISTORY_FILE = 'canvas-history/history.json';

export type HistoryMedia = { sha256: string; ext: string; kind: 'image' | 'video'; size: number; width: number | null; height: number | null; hasThumb: boolean };
// 历史里只记结束了的槽位：生成好了的带 media，失败的带原因。排队、生成中的只在内存队列里。
// durationMs：生成用了多久（含自动重试），1.14.0 起记；更早的记录是 null。
export type HistorySlot = { index: number; status: 'done' | 'failed'; media: HistoryMedia | null; revisedPrompt: string | null; error: string; attempts: number; savedToLibrary: boolean; durationMs: number | null };
export type HistoryParams = { size: string; ratio: string; quality: string; outputFormat: string; background: string; mediaType: 'image' | 'video' };
export type HistoryTask = {
  id: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  prompt: string;
  negativePrompt: string;
  params: HistoryParams;
  origin: CanvasOrigin | null;
  referenceCount: number;
  // 当时用的参考图（1.8.6 起存，按 sha256 存在 media/ 下），「全量恢复」时放回画布；更早的任务是空的。
  references: HistoryMedia[];
  total: number;
  slots: HistorySlot[];
};
export type CanvasHistory = { schemaVersion: 1; updatedAt: string; tasks: HistoryTask[] };

export const historyMediaPath = (media: Pick<HistoryMedia, 'sha256' | 'ext'>) => `canvas-history/media/${media.sha256}${media.ext}`;
export const historyThumbPath = (media: Pick<HistoryMedia, 'sha256'>) => `canvas-history/thumbs/${media.sha256}.jpg`;

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function normalizeMedia(raw: unknown): HistoryMedia | null {
  if (!isRecord(raw) || !/^[0-9a-f]{64}$/.test(text(raw.sha256)) || !/^\.[a-z0-9]{1,5}$/.test(text(raw.ext))) return null;
  const dimension = (value: unknown) => (typeof value === 'number' && value > 0 ? value : null);
  return {
    sha256: text(raw.sha256),
    ext: text(raw.ext),
    kind: raw.kind === 'video' ? 'video' : 'image',
    size: typeof raw.size === 'number' ? raw.size : 0,
    width: dimension(raw.width),
    height: dimension(raw.height),
    hasThumb: raw.hasThumb === true,
  };
}

function normalizeSlot(raw: unknown): HistorySlot | null {
  if (!isRecord(raw) || typeof raw.index !== 'number' || (raw.status !== 'done' && raw.status !== 'failed')) return null;
  const media = normalizeMedia(raw.media);
  if (raw.status === 'done' && !media) return null;
  return {
    index: raw.index,
    status: raw.status,
    media,
    revisedPrompt: typeof raw.revisedPrompt === 'string' ? raw.revisedPrompt : null,
    error: text(raw.error),
    attempts: typeof raw.attempts === 'number' ? raw.attempts : 1,
    savedToLibrary: raw.savedToLibrary === true,
    durationMs: typeof raw.durationMs === 'number' && raw.durationMs >= 0 ? raw.durationMs : null,
  };
}

function normalizeTask(raw: unknown): HistoryTask | null {
  if (!isRecord(raw) || !text(raw.id) || !text(raw.createdAt)) return null;
  const params = isRecord(raw.params) ? raw.params : {};
  const origin = isRecord(raw.origin)
    ? { prompt: text(raw.origin.prompt), negativePrompt: text(raw.origin.negativePrompt), title: text(raw.origin.title), category: text(raw.origin.category), tags: Array.isArray(raw.origin.tags) ? raw.origin.tags.filter((tag): tag is string => typeof tag === 'string') : [] }
    : null;
  const slots = (Array.isArray(raw.slots) ? raw.slots : []).map(normalizeSlot).filter((slot): slot is HistorySlot => slot !== null);
  return {
    id: text(raw.id),
    createdAt: text(raw.createdAt),
    updatedAt: text(raw.updatedAt) || text(raw.createdAt),
    model: text(raw.model),
    prompt: text(raw.prompt),
    negativePrompt: text(raw.negativePrompt),
    params: {
      size: text(params.size),
      ratio: text(params.ratio),
      quality: text(params.quality),
      outputFormat: text(params.outputFormat),
      background: text(params.background),
      mediaType: params.mediaType === 'video' ? 'video' : 'image',
    },
    origin,
    referenceCount: typeof raw.referenceCount === 'number' ? raw.referenceCount : 0,
    references: (Array.isArray(raw.references) ? raw.references : []).map(normalizeMedia).filter((media): media is HistoryMedia => media !== null),
    total: typeof raw.total === 'number' ? raw.total : slots.length,
    slots,
  };
}

// 读不懂的任务和槽位跳过并计数，和素材库的 normalizeLibrary 一样，界面会提示下次写入时它们不会被保留。
export function normalizeHistory(raw: unknown): { history: CanvasHistory; dropped: number } {
  const source = isRecord(raw) && Array.isArray(raw.tasks) ? raw.tasks : [];
  const tasks: HistoryTask[] = [];
  let dropped = 0;
  for (const entry of source) {
    const task = normalizeTask(entry);
    if (!task) {
      dropped += 1;
      continue;
    }
    dropped += (isRecord(entry) && Array.isArray(entry.slots) ? entry.slots.length : 0) - task.slots.length;
    tasks.push(task);
  }
  return { history: { schemaVersion: 1, updatedAt: isRecord(raw) ? text(raw.updatedAt) : '', tasks }, dropped };
}

function parseHistory(content: string | null) {
  if (content === null || !content.trim()) return { data: normalizeHistory(null).history, dropped: 0 };
  try {
    const { history, dropped } = normalizeHistory(JSON.parse(content));
    return { data: history, dropped };
  } catch {
    throw new Error('NAS 上的 canvas-history/history.json 不是有效的 JSON，已停止，避免覆盖。请先检查这个文件');
  }
}

export async function readHistory(config: DavConfig) {
  const { data, dropped } = parseHistory(await webdav.readText(config, HISTORY_FILE));
  return { history: data, dropped };
}

export async function mutateHistory<T>(config: DavConfig, change: (history: CanvasHistory) => { history: CanvasHistory; result: T }) {
  const { data, dropped, result } = await mutateJsonFile(
    config,
    HISTORY_FILE,
    parseHistory,
    (history) => {
      const changed = change(history);
      return { data: changed.history, result: changed.result };
    },
    '画布生成历史',
  );
  return { history: data, dropped, result };
}

// 任务第一次有槽位结束时建记录，之后每个槽位结束就写进去（同一槽位重试后覆盖）。最新的任务在前。
// 模型取最新一次的：重试前换了模型，记录里显示实际生成用的。
export function recordSlot(history: CanvasHistory, task: Omit<HistoryTask, 'slots' | 'updatedAt'>, slot: HistorySlot, now: string): CanvasHistory {
  const existing = history.tasks.find((entry) => entry.id === task.id);
  const base: HistoryTask = existing ?? { ...task, updatedAt: now, slots: [] };
  const updated: HistoryTask = {
    ...base,
    model: task.model || base.model,
    references: base.references?.length ? base.references : (task.references ?? []),
    updatedAt: now,
    slots: [...base.slots.filter((entry) => entry.index !== slot.index), slot].sort((left, right) => left.index - right.index),
  };
  return { ...history, updatedAt: now, tasks: [updated, ...history.tasks.filter((entry) => entry.id !== task.id)] };
}

export function markSavedToLibrary(history: CanvasHistory, taskId: string, index: number, now: string): CanvasHistory {
  return {
    ...history,
    updatedAt: now,
    tasks: history.tasks.map((task) =>
      task.id === taskId ? { ...task, slots: task.slots.map((slot) => (slot.index === index ? { ...slot, savedToLibrary: true } : slot)) } : task,
    ),
  };
}

// 一个任务用到的所有文件：生成的图和参考图（同一张图可能既是某个任务的结果，又是另一个任务的参考图）。
const taskMedia = (task: HistoryTask) => [...task.slots.flatMap((slot) => (slot.media ? [slot.media] : [])), ...(task.references ?? [])];

// 删任务或单张：`任务 id` 删整个任务，`任务 id:图序号` 只删那一张，一张不剩时任务（连参考图）一起删。
// orphaned 是删完后没有别的历史任务再用的文件，调用方据此删 NAS 上的原图和缩略图。
export function deleteHistoryTasks(history: CanvasHistory, ids: readonly string[], now: string) {
  const removing = new Set(ids);
  const tasks = history.tasks.flatMap((task) => {
    if (removing.has(task.id)) return [];
    const slots = task.slots.filter((slot) => !removing.has(`${task.id}:${slot.index}`));
    if (slots.length === task.slots.length) return [task];
    return slots.length ? [{ ...task, updatedAt: now, slots }] : [];
  });
  const stillUsed = new Set(tasks.flatMap(taskMedia).map((media) => media.sha256));
  const orphaned = new Map<string, HistoryMedia>();
  for (const media of history.tasks.flatMap(taskMedia)) {
    if (!stillUsed.has(media.sha256)) orphaned.set(media.sha256, media);
  }
  return { history: { ...history, updatedAt: now, tasks }, orphaned: [...orphaned.values()] };
}

export function findSlot(history: CanvasHistory, taskId: string, index: number) {
  const task = history.tasks.find((entry) => entry.id === taskId);
  const slot = task?.slots.find((entry) => entry.index === index);
  if (!task || !slot?.media) throw new Error('这张图已经不在生成历史里了，可能在另一台电脑上被删除了');
  return { task, slot, media: slot.media };
}
