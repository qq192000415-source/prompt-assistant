// 创作画布在界面这边的状态：草稿参数、参考图、来源组，以及主进程推来的任务队列和 NAS 上的生成历史。
// 放在模块里而不是组件里：切到提示词库、文档库再切回来，草稿和列表都还在。任务本身在主进程队列里跑，不受界面影响。
import { useSyncExternalStore } from 'react';
import { loadMaterialsCanvasDraft, saveMaterialsCanvasDraft, type CanvasSortOrder } from '../localState.ts';
import type { MaterialItem } from './library.ts';
import { buildCanvasImageGenerationPayload, canvasAspectRatioOptions, normalizeCanvasDraftSettings, resolveCanvasGenerationSize } from './suyan/canvasGeneration.ts';
import type { CanvasBaseResolution, CanvasDraftSettings, CanvasReferenceImage } from './suyan/canvasTypes.ts';

// 参考图编辑（局部重绘）后多两样：没涂之前的原图，和给 /images/edits 的遮罩 PNG（涂过的地方透明）。dataUrl 是涂了绿色标记的图，提交的就是它。
export type CanvasReference = CanvasReferenceImage & { sourceDataUrl?: string; maskDataUrl?: string };

export type CanvasState = {
  draft: CanvasDraftSettings;
  origin: MaterialCanvasOrigin | null;
  error: string;
  queue: MaterialCanvasTask[];
  history: MaterialCanvasTask[];
  historyLoaded: boolean;
  // 这些队列、历史、参考图属于哪个云同步账号；换了账号就清掉，不让下一个账号看到。
  account: string;
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
    account: '',
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

// 「全量恢复」：从历史任务记下的参数反推草稿的尺寸、质量、格式、张数。
// 尺寸先按「比例 + 分辨率」找回（和提交时算尺寸用的是同一个函数），找不到就当自定义宽高，auto 就是自动。
const RESOLUTIONS: CanvasBaseResolution[] = ['1k', '2k', '3k', '4k'];
const QUALITIES = ['auto', 'low', 'medium', 'high'] as const;
const FORMATS = ['png', 'jpeg', 'webp'] as const;
export function restoreDraftParams(task: Pick<MaterialCanvasTask, 'params' | 'total'>): Partial<CanvasDraftSettings> {
  const { params } = task;
  const patch: Partial<CanvasDraftSettings> = {
    count: Math.max(1, Math.min(4, task.total || 1)),
    transparentBackground: params.background === 'transparent',
  };
  if ((QUALITIES as readonly string[]).includes(params.quality)) patch.quality = params.quality as CanvasDraftSettings['quality'];
  if ((FORMATS as readonly string[]).includes(params.outputFormat)) patch.outputFormat = params.outputFormat as CanvasDraftSettings['outputFormat'];
  const size = params.size.trim().toLowerCase();
  if (!size || size === 'auto') return { ...patch, sizeMode: 'auto' };
  // 记下的比例优先，同一个尺寸在别的比例下也凑得出来时不会选错
  const ratios = [...canvasAspectRatioOptions].sort((a, b) => Number(b.value === params.ratio) - Number(a.value === params.ratio));
  for (const { value: aspectRatio } of ratios) {
    for (const baseResolution of RESOLUTIONS) {
      if (resolveCanvasGenerationSize({ sizeMode: 'ratio', aspectRatio, baseResolution, customWidth: 0, customHeight: 0 }) === size) {
        return { ...patch, sizeMode: 'ratio', aspectRatio, baseResolution };
      }
    }
  }
  const [, width, height] = size.match(/^(\d+)x(\d+)$/) ?? [];
  return width ? { ...patch, sizeMode: 'custom', customWidth: Number(width), customHeight: Number(height) } : { ...patch, sizeMode: 'auto' };
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
  // 编辑完换掉原来那张：按对象找（编辑期间可能拖动换了位置），找不到（被删了）返回 false。
  replaceReference(previous: CanvasReferenceImage, next: CanvasReference) {
    const images = current().draft.referenceImages;
    const index = images.indexOf(previous);
    if (index < 0) return false;
    set({ draft: { ...current().draft, referenceImages: images.map((image, position) => (position === index ? next : image)) } });
    return true;
  },
  clearReferences() {
    set({ draft: { ...current().draft, referenceImages: [] } });
  },
  // 参考图的顺序就是提交顺序（视频的首帧、尾帧也按这个顺序）。
  moveReference(from: number, to: number) {
    const images = [...current().draft.referenceImages];
    if (from === to || from < 0 || to < 0 || from >= images.length || to >= images.length) return;
    const [moved] = images.splice(from, 1);
    images.splice(to, 0, moved);
    set({ draft: { ...current().draft, referenceImages: images } });
  },
  clearError() {
    set({ error: '' });
  },
  showError(error: string) {
    set({ error });
  },
  // 提示词和参数是这台电脑的草稿，留着；参考图、来源组、队列、历史是上一个账号的，清掉。
  switchAccount(account: string) {
    const { account: previous, draft } = current();
    if (previous === account) return;
    set({ account, queue: [], history: [], historyLoaded: false, origin: null, error: '', draft: { ...draft, referenceImages: [], promptOrigin: null } });
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
  // 全量恢复：提示词、负向、尺寸等参数，参考图换成当时用的（取不回来的传空数组）。
  restoreTask(task: MaterialCanvasTask, references: CanvasReferenceImage[]) {
    const draft = { ...current().draft, ...restoreDraftParams(task), prompt: task.prompt, negativePrompt: task.negativePrompt, referenceImages: references };
    set({ draft: { ...draft, negativePromptHidden: draft.negativePromptHidden && !task.negativePrompt }, origin: task.origin });
  },
  // 把当前草稿提交进队列，立刻返回；提示词改过就不算来源组。
  async submit(model: string, request: (input: { payload: ReturnType<typeof buildCanvasImageGenerationPayload>; count: number; origin: MaterialCanvasOrigin | null }) => Promise<string>) {
    const { draft, origin } = current();
    // OpenAI 的 mask 只作用于第一张图，所以带遮罩的只能是第 1 张、只能有一张。
    const masked = draft.referenceImages.filter((image: CanvasReference) => image.maskDataUrl);
    const maskDataUrl = (draft.referenceImages[0] as CanvasReference | undefined)?.maskDataUrl;
    if (masked.length > 1 || (masked.length === 1 && !maskDataUrl)) {
      set({ error: '带遮罩（局部重绘）的参考图只能有一张，并且要放在第 1 张：拖动调整顺序后再生成' });
      return false;
    }
    const payload = { ...buildCanvasImageGenerationPayload(draft, { mediaType: isVideoModel(model) ? 'video' : 'image' }), ...(maskDataUrl ? { maskDataUrl } : {}) };
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
