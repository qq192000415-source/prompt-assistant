// 创作画布在界面这边的状态：草稿参数、参考图、来源组，以及主进程推来的任务队列和 NAS 上的生成历史。
// 放在模块里而不是组件里：切到提示词库、文档库再切回来，草稿和列表都还在。任务本身在主进程队列里跑，不受界面影响。
import { useSyncExternalStore } from 'react';
import { loadMaterialsCanvasDraft, saveMaterialsCanvasDraft, type CanvasSortOrder } from '../localState.ts';
import type { MaterialItem } from './library.ts';
import { buildCanvasImageGenerationPayload, normalizeCanvasDraftSettings } from './suyan/canvasGeneration.ts';
import type { CanvasDraftSettings, CanvasReferenceImage } from './suyan/canvasTypes.ts';

export type CanvasState = {
  draft: CanvasDraftSettings;
  origin: MaterialCanvasOrigin | null;
  error: string;
  queue: MaterialCanvasTask[];
  history: MaterialCanvasTask[];
  historyLoaded: boolean;
};

let state: CanvasState | null = null;
const listeners = new Set<() => void>();

function current(): CanvasState {
  // 参考图和来源组只在本次会话有效，不进草稿存档（SuYan 也是这样）。
  state ??= {
    draft: { ...normalizeCanvasDraftSettings(loadMaterialsCanvasDraft()), referenceImages: [], promptOrigin: null },
    origin: null,
    error: '',
    queue: [],
    history: [],
    historyLoaded: false,
  };
  return state;
}

function set(patch: Partial<CanvasState>) {
  state = { ...current(), ...patch };
  if (patch.draft) saveMaterialsCanvasDraft({ ...patch.draft, referenceImages: [], promptOrigin: null });
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getCanvasState = current;
export const useCanvasState = () => useSyncExternalStore(subscribe, current);

// SuYan 视频只适配 Agnes Video；其余模型都按生图处理。
export const isVideoModel = (model: string) => /^agnes-video-/i.test(model.trim());

export const isActive = (task: MaterialCanvasTask) => task.slots.some((slot) => slot.status === 'queued' || slot.status === 'running');

// 列表：队列里的任务在前（能取消、重试），再接生成历史里不在队列中的；按提示词、模型搜索。
// 队列和历史合并后按创建时间排：队列里的任务不再总排在前面，另一台电脑同一时段生成的也按时间插进来。
export function visibleTasks(queue: readonly MaterialCanvasTask[], history: readonly MaterialCanvasTask[], query: string, order: CanvasSortOrder = 'newest') {
  const inQueue = new Set(queue.map((task) => task.id));
  const direction = order === 'oldest' ? 1 : -1;
  const merged = [...queue, ...history.filter((task) => !inQueue.has(task.id))].sort(
    (a, b) => direction * ((Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)),
  );
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return merged;
  return merged.filter((task) => {
    const text = `${task.prompt}\n${task.negativePrompt}\n${task.model}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

// 生成历史里有「已存入素材库」的标记，队列快照里没有，合并时补上。
export function savedInHistory(history: readonly MaterialCanvasTask[], taskId: string, index: number) {
  return Boolean(history.find((task) => task.id === taskId)?.slots.find((slot) => slot.index === index)?.savedToLibrary);
}

export const canvas = {
  setDraft(patch: Partial<CanvasDraftSettings>) {
    set({ draft: { ...current().draft, ...patch } });
  },
  addReferences(images: CanvasReferenceImage[]) {
    set({ draft: { ...current().draft, referenceImages: [...current().draft.referenceImages, ...images] } });
  },
  removeReference(index: number) {
    set({ draft: { ...current().draft, referenceImages: current().draft.referenceImages.filter((_, position) => position !== index) } });
  },
  clearError() {
    set({ error: '' });
  },
  showError(error: string) {
    set({ error });
  },
  setQueue(queue: MaterialCanvasTask[]) {
    set({ queue });
  },
  setHistory(history: MaterialCanvasTask[]) {
    set({ history, historyLoaded: true });
  },
  // 从素材详情页「发到画布」：带上提示词、来源组（没改提示词时新图归进同一组）和这张图当参考图。
  sendFromItem(item: MaterialItem, reference: CanvasReferenceImage | null) {
    set({
      draft: { ...current().draft, prompt: item.prompt, negativePrompt: item.negativePrompt, negativePromptHidden: !item.negativePrompt, referenceImages: reference ? [reference] : [] },
      origin: item.prompt.trim() ? { prompt: item.prompt, negativePrompt: item.negativePrompt, title: item.title, category: item.category, tags: item.tags } : null,
    });
  },
  reusePrompt(task: MaterialCanvasTask, slot?: MaterialCanvasSlot) {
    set({ draft: { ...current().draft, prompt: slot?.revisedPrompt || task.prompt, negativePrompt: task.negativePrompt }, origin: task.origin });
  },
  // 把当前草稿提交进队列，立刻返回；提示词改过就不算来源组。
  async submit(model: string, request: (input: { payload: ReturnType<typeof buildCanvasImageGenerationPayload>; count: number; origin: MaterialCanvasOrigin | null }) => Promise<string>) {
    const { draft, origin } = current();
    const payload = buildCanvasImageGenerationPayload(draft, { mediaType: isVideoModel(model) ? 'video' : 'image' });
    const keepOrigin = origin && origin.prompt.trim() === payload.prompt.trim() && origin.negativePrompt.trim() === (payload.negativePrompt ?? '').trim();
    set({ error: '' });
    try {
      await request({ payload, count: draft.count, origin: keepOrigin ? origin : null });
      return true;
    } catch (error) {
      set({ error: (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '') });
      return false;
    }
  },
};
