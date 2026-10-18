// 创作画布的状态：草稿参数、参考图、来源组、本次打开软件以来的生成批次。
// 放在模块里而不是组件里：切到提示词库、文档库再切回来，没存的结果还在；关掉软件就没了（结果只存 NAS，不落本机）。
import { useSyncExternalStore } from 'react';
import { loadMaterialsCanvasDraft, saveMaterialsCanvasDraft } from '../localState.ts';
import type { MaterialItem } from './library.ts';
import { buildCanvasImageGenerationPayload, normalizeCanvasDraftSettings } from './suyan/canvasGeneration.ts';
import type { CanvasDraftSettings, CanvasReferenceImage } from './suyan/canvasTypes.ts';

export type CanvasResult = { id: string; dataUrl: string; revisedPrompt: string | null; mediaType: 'image' | 'video'; saved: boolean };
export type CanvasBatch = {
  id: number;
  createdAt: string;
  model: string;
  // 生成那一刻的提示词快照：之后改草稿，存进素材库的仍是生成这批图用的提示词。
  prompt: string;
  negativePrompt: string;
  origin: MaterialCanvasOrigin | null;
  results: CanvasResult[];
};
export type CanvasPhase = 'idle' | 'generating' | 'reveal';
export type CanvasState = {
  draft: CanvasDraftSettings;
  origin: MaterialCanvasOrigin | null;
  batches: CanvasBatch[];
  phase: CanvasPhase;
  startedAt: number;
  error: string;
};

let state: CanvasState | null = null;
const listeners = new Set<() => void>();
let nextBatchId = 1;

function current(): CanvasState {
  // 参考图和来源组只在本次会话有效，不进草稿存档（SuYan 也是这样）。
  state ??= { draft: { ...normalizeCanvasDraftSettings(loadMaterialsCanvasDraft()), referenceImages: [], promptOrigin: null }, origin: null, batches: [], phase: 'idle', startedAt: 0, error: '' };
  return state;
}

function set(patch: Partial<CanvasState>) {
  const previous = current();
  state = { ...previous, ...patch };
  if (patch.draft) saveMaterialsCanvasDraft({ ...patch.draft, referenceImages: [], promptOrigin: null });
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getCanvasState = current;
export const useCanvasState = () => useSyncExternalStore(subscribe, current);

export const unsavedCount = (batches: readonly CanvasBatch[]) => batches.reduce((sum, batch) => sum + batch.results.filter((result) => !result.saved).length, 0);

// SuYan 视频只适配 Agnes Video；其余模型都按生图处理。
export const isVideoModel = (model: string) => /^agnes-video-/i.test(model.trim());

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
  // 从素材详情页「发到画布」：带上提示词、来源组（没改提示词时新图归进同一组）和这张图当参考图。
  sendFromItem(item: MaterialItem, reference: CanvasReferenceImage | null) {
    set({
      draft: { ...current().draft, prompt: item.prompt, negativePrompt: item.negativePrompt, negativePromptHidden: !item.negativePrompt, referenceImages: reference ? [reference] : [] },
      origin: item.prompt.trim() ? { prompt: item.prompt, negativePrompt: item.negativePrompt, title: item.title, category: item.category, tags: item.tags } : null,
    });
  },
  reusePrompt(batch: CanvasBatch, result: CanvasResult) {
    set({ draft: { ...current().draft, prompt: result.revisedPrompt || batch.prompt, negativePrompt: batch.negativePrompt }, origin: batch.origin });
  },
  async generate(model: string, request: (payload: ReturnType<typeof buildCanvasImageGenerationPayload>) => Promise<MaterialCanvasGeneration>) {
    const { draft, origin } = current();
    const mediaType = isVideoModel(model) ? 'video' : 'image';
    const payload = buildCanvasImageGenerationPayload(draft, { mediaType });
    set({ phase: 'generating', startedAt: Date.now(), error: '' });
    try {
      const generated = await request(payload);
      if (!generated.images.length) throw new Error('模型没有返回图片');
      const batchId = nextBatchId++;
      const batch: CanvasBatch = {
        id: batchId,
        createdAt: new Date().toISOString(),
        model: generated.model || model,
        prompt: payload.prompt,
        negativePrompt: payload.negativePrompt ?? '',
        // 生成时提示词已经改过的，不再算原组。
        origin: origin && origin.prompt.trim() === payload.prompt.trim() && origin.negativePrompt.trim() === (payload.negativePrompt ?? '').trim() ? origin : null,
        results: generated.images.map((image, index) => ({
          id: `${batchId}-${index}`,
          dataUrl: image.dataUrl,
          revisedPrompt: image.revisedPrompt ?? null,
          mediaType: image.mediaType ?? generated.mediaType ?? mediaType,
          saved: false,
        })),
      };
      set({ batches: [batch, ...current().batches], phase: 'reveal' });
      return true;
    } catch (error) {
      set({ phase: 'idle', error: (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '') });
      return false;
    }
  },
  revealDone() {
    if (current().phase === 'reveal') set({ phase: 'idle' });
  },
  markSaved(resultId: string) {
    set({ batches: current().batches.map((batch) => ({ ...batch, results: batch.results.map((result) => (result.id === resultId ? { ...result, saved: true } : result)) })) });
  },
};
