// 素材库 AI 助手：图像反推、提示词优化、翻译、分类打标签，以及批量反推和批量分类。
// 提示词、请求和结果解析全用移植的 SuYan 代码（suyan/remoteAiClient、suyan/ollamaAiClient），这里只负责选模型、
// 从 NAS 取图、把结果写回 library.json。不依赖 Electron，Node 测试可直接加载。
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { groupKey, mediaPath, patchItem, thumbPath, uniqueTags, type MaterialItem, type MaterialLibrary } from '../../src/materials/library.ts';
import { mutateLibrary, readLibrary } from './libraryStore.ts';
import { exclusive, reason, type Failure, type Report } from './tasks.ts';
import * as webdav from './webdav.ts';
import type { DavConfig } from './webdav.ts';
import type { AiAnalyzePromptPayload, AiAnalyzeTarget, AiFeatureAction, AiProviderSettings, RemotePromptAnalysisV2 } from './suyan/aiTypes.ts';
import {
  normalizeOllamaBaseUrl,
  optimizePromptWithOllama,
  parseOllamaChatResponse,
  reverseImagePromptWithOllama,
  translatePromptWithOllama,
} from './suyan/ollamaAiClient.ts';
import { isHiddenAiCategoryLabel, photographyCategoryLabels, resolvePhotographyCategory } from './suyan/photographyCategories.ts';
import {
  analyzePromptRemotely,
  buildImageAnalysisUserText,
  buildPromptCategoryAnalysisUserText,
  buildPromptTagsAnalysisUserText,
  buildSystemAnalysisContent,
  optimizePromptRemotely,
  parseRemotePromptAnalysisV2Content,
  readPayloadImageDataUrl,
  reverseImagePromptRemotely,
  translatePromptRemotely,
} from './suyan/remoteAiClient.ts';

export type AiProvider = 'openai-compatible' | 'ollama';
export type AiSlot = { provider: AiProvider; baseUrl: string; apiKey: string; model: string };
// text 用于优化、翻译、按提示词分类；vision 用于反推、按图分类。只配了视觉模型时，文字任务也交给它。
export type AiRuntime = { text: AiSlot | null; vision: AiSlot | null; instructions: (action: AiFeatureAction) => string };
export type AiSuggestion = { category: string; tags: string[]; warnings: string[] };

const toSettings = (slot: AiSlot): AiProviderSettings => ({
  id: 'materials',
  name: '素材库',
  enabled: true,
  provider: slot.provider,
  baseUrl: slot.baseUrl,
  apiKey: slot.apiKey,
  model: slot.model,
  models: [],
});

function textModel(runtime: AiRuntime) {
  const slot = runtime.text ?? runtime.vision;
  if (!slot) throw new Error('还没有设置 AI 模型，请在素材库设置里填写');
  return toSettings(slot);
}

function visionModel(runtime: AiRuntime) {
  if (!runtime.vision) throw new Error('看图需要视觉模型，请在素材库设置里填写视觉模型');
  return toSettings(runtime.vision);
}

// SuYan 认得的图片格式；其余图片和视频用缩略图（视频的缩略图就是封面）。
const VISION_EXTS = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif']);

export function visionSource(item: MaterialItem): string | null {
  if (item.media.kind === 'image' && VISION_EXTS.has(item.media.ext)) return mediaPath(item.media);
  return item.media.hasThumb ? thumbPath(item.media) : null;
}

// SuYan 按文件路径读图：先下载到临时文件，用完就删，素材不留在本机。
async function withImageFile<T>(config: DavConfig, item: MaterialItem, use: (filePath: string) => Promise<T>): Promise<T> {
  const source = visionSource(item);
  if (!source) throw new Error('这条素材没有可以给 AI 看的图片（视频还没有封面）');
  const ext = path.extname(source) === '.jfif' ? '.jpg' : path.extname(source);
  const filePath = path.join(os.tmpdir(), `prompt-assistant-ai-${crypto.randomUUID()}${ext}`);
  try {
    await webdav.downloadToFile(config, source, filePath);
    return await use(filePath);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
}

export async function reversePrompt(runtime: AiRuntime, config: DavConfig, item: MaterialItem) {
  const settings = visionModel(runtime);
  const rules = runtime.instructions('image-reverse');
  return withImageFile(config, item, (imageFileName) =>
    settings.provider === 'ollama'
      ? reverseImagePromptWithOllama(settings, { imageFileName }, rules)
      : reverseImagePromptRemotely(settings, { imageFileName }, rules),
  );
}

export async function optimizePrompt(runtime: AiRuntime, prompt: string, kind: 'positive' | 'negative') {
  if (!prompt.trim()) throw new Error('提示词是空的，没有可优化的内容');
  const settings = textModel(runtime);
  const rules = runtime.instructions('prompt-optimization');
  return settings.provider === 'ollama'
    ? optimizePromptWithOllama(settings, prompt, rules, kind)
    : optimizePromptRemotely(settings, prompt, rules, kind);
}

// 有中文就译成英文，否则译成中文；正向和负向一起译。
export async function translatePrompt(runtime: AiRuntime, prompt: string, negativePrompt: string) {
  if (!prompt.trim() && !negativePrompt.trim()) throw new Error('提示词是空的，没有可翻译的内容');
  const settings = textModel(runtime);
  const targetLanguage = /[一-鿿]/.test(prompt + negativePrompt) ? 'en' : 'zh';
  const payload = { targetLanguage, sourceLanguage: 'auto', prompt, negativePrompt } as const;
  const rules = runtime.instructions('prompt-translation');
  const result =
    settings.provider === 'ollama'
      ? await translatePromptWithOllama(settings, payload, rules)
      : await translatePromptRemotely(settings, payload, rules);
  // 实测 grok-4.3 会把正向提示词原样返回、只译负向；原文进原文出不算翻译，明确报错，不把原文当译文填回去。
  const unchanged = (source: string, translated: string) => Boolean(source.trim()) && translated.trim() === source.trim();
  if (unchanged(prompt, result.prompt) || unchanged(negativePrompt, result.negativePrompt)) {
    throw new Error(`模型 ${settings.model} 没有翻译，原样返回了原文，换个文本模型试试`);
  }
  return { ...result, targetLanguage };
}

// 分类候选＝素材库已有分类＋SuYan 摄影分类体系；库里自己的分类会单列成「自定义分类」，提示模型优先用它们。
export function knownCategoriesOf(library: MaterialLibrary) {
  return [...new Set([...library.items.map((item) => item.category).filter(Boolean), ...photographyCategoryLabels])];
}

const PREFER_OWN_CATEGORIES = '【自定义分类】里是用户素材库已有的分类：画面或提示词能归入其中时，优先选它作为主分类。';

// 分类只认候选列表里的名称（或 SuYan 别名表能对上的），小模型常把「场景细分」这类维度组名当分类返回，直接丢掉。
function acceptCategory(label: string, knownCategories: readonly string[]) {
  if (knownCategories.includes(label)) return label;
  const resolved = resolvePhotographyCategory(label);
  return resolved && knownCategories.includes(resolved) ? resolved : '';
}

// 主分类写进分类；其余维度（人物题材、场景等）和识别出的特征并入标签。光线、色彩等 SuYan 不展示的维度丢掉。
export function suggestionFromAnalyses(
  categoryAnalysis: RemotePromptAnalysisV2 | null,
  tagAnalysis: RemotePromptAnalysisV2 | null,
  knownCategories: readonly string[],
) {
  const categories = categoryAnalysis
    ? [...categoryAnalysis.categories]
        .sort((left, right) => Number(right.primary) - Number(left.primary))
        .map((candidate) => acceptCategory(candidate.label, knownCategories))
        .filter((label) => label && !isHiddenAiCategoryLabel(label))
    : [];
  const tags = tagAnalysis ? tagAnalysis.tags.map((tag) => tag.normalizedLabel || tag.label) : [];
  return { category: categories[0] ?? '', tags: uniqueTags([...categories.slice(1), ...tags]) };
}

// SuYan 的 Ollama 请求没设 num_ctx，Ollama 默认上下文只有 4096 token，而分类提示词带着整个分类目录约 7600 token，会被拒绝。
// 这里照 SuYan 的 analyzePromptWithOllama 拼同样的提示词、用同样的解析，只把上下文调大。反推、优化、翻译的提示词短，仍直接用 SuYan 的。
// ponytail: 固定 16384，显存小的电脑 Ollama 会挪一部分到内存里跑，慢但能用；要省显存再按提示词长度估算。
const OLLAMA_ANALYSIS_CONTEXT = 16384;
const OLLAMA_ANALYSIS_TIMEOUT_MS = 180_000;

async function analyzeWithOllama(settings: AiProviderSettings, payload: AiAnalyzePromptPayload) {
  const custom = payload.customInstructions?.trim();
  const base = buildSystemAnalysisContent(payload.target);
  const system = custom ? `${base}

用户配置的补充规则：
${custom}` : base;
  let user: { role: 'user'; content: string; images?: string[] };
  if (payload.target === 'prompt-category') user = { role: 'user', content: buildPromptCategoryAnalysisUserText(payload) };
  else if (payload.target === 'prompt-tags') user = { role: 'user', content: buildPromptTagsAnalysisUserText(payload) };
  else {
    const dataUrl = await readPayloadImageDataUrl(payload.imageFileName, { compact: true, purpose: payload.target === 'image-category' ? 'category' : 'tags' });
    if (!dataUrl) throw new Error('需要可用参考图才能进行图像识别。');
    user = { role: 'user', content: buildImageAnalysisUserText(payload), images: [dataUrl.slice(dataUrl.indexOf(',') + 1)] };
  }
  const response = await fetch(`${normalizeOllamaBaseUrl(settings.baseUrl)}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.model,
      messages: [{ role: 'system', content: system }, user],
      stream: false,
      format: 'json',
      options: { temperature: 0.1, num_predict: 6000, num_ctx: OLLAMA_ANALYSIS_CONTEXT },
    }),
    signal: AbortSignal.timeout(OLLAMA_ANALYSIS_TIMEOUT_MS),
  }).catch((error) => {
    throw new Error(error?.name === 'TimeoutError' ? 'Ollama 3 分钟内没有返回结果' : '无法连接 Ollama，请确认 Ollama 已启动并监听当前地址');
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = text.slice(0, 240);
    try {
      const error = (JSON.parse(text) as { error?: unknown }).error;
      detail = typeof error === 'string' ? error : JSON.stringify(error ?? detail);
    } catch {
      // 不是 JSON 就用原文。
    }
    throw new Error(`Ollama 请求失败：${detail}`);
  }
  return parseRemotePromptAnalysisV2Content(parseOllamaChatResponse(JSON.parse(text)), payload.target);
}

// 有视觉模型且有图时看图分类，否则按提示词分类。分类和标签各一次请求，一个失败时保留另一个的结果。
export async function classifyItem(runtime: AiRuntime, config: DavConfig, item: MaterialItem, prompt: string, knownCategories: string[]): Promise<AiSuggestion> {
  const byImage = Boolean(runtime.vision && visionSource(item));
  if (!byImage && !prompt.trim()) {
    throw new Error(runtime.vision ? '这条素材没有可以看的图片，也没有提示词' : '没有视觉模型时按提示词分类，这条素材还没有提示词');
  }
  const settings = byImage ? visionModel(runtime) : textModel(runtime);
  const ownCategories = knownCategories.some((label) => !photographyCategoryLabels.includes(label));
  const analyze = (target: AiAnalyzeTarget, imageFileName?: string) => {
    const kind = target.endsWith('category') ? 'category' : 'tags';
    const rules = [runtime.instructions(target), kind === 'category' && ownCategories ? PREFER_OWN_CATEGORIES : ''].filter(Boolean).join('\n\n');
    const payload: AiAnalyzePromptPayload = {
      target,
      title: item.title,
      imageFileName,
      prompt,
      negativePrompt: '',
      tags: [],
      category: '',
      knownCategories,
      customInstructions: rules,
    };
    return settings.provider === 'ollama' ? analyzeWithOllama(settings, payload) : analyzePromptRemotely(settings, payload);
  };
  const run = (imageFileName?: string) =>
    Promise.allSettled([
      analyze(byImage ? 'image-category' : 'prompt-category', imageFileName),
      analyze(byImage ? 'image-tags' : 'prompt-tags', imageFileName),
    ]);
  const [categoryResult, tagResult] = byImage ? await withImageFile(config, item, run) : await run();
  if (categoryResult.status === 'rejected' && tagResult.status === 'rejected') throw categoryResult.reason;
  const warnings = [
    categoryResult.status === 'rejected' ? `分类没识别出来：${reason(categoryResult.reason)}` : '',
    tagResult.status === 'rejected' ? `标签没识别出来：${reason(tagResult.reason)}` : '',
  ].filter(Boolean);
  return {
    ...suggestionFromAnalyses(
      categoryResult.status === 'fulfilled' ? categoryResult.value : null,
      tagResult.status === 'fulfilled' ? tagResult.value : null,
      knownCategories,
    ),
    warnings,
  };
}

// 提示词、分类、标签是整组共用的，批量时每组只跑一次。
function pickGroups(library: MaterialLibrary, ids: readonly string[]) {
  const wanted = new Set(ids);
  const seen = new Set<string>();
  return library.items.filter((item) => {
    if (!wanted.has(item.id) || seen.has(groupKey(item))) return false;
    seen.add(groupKey(item));
    return true;
  });
}

const itemName = (item: MaterialItem) => item.title || item.media.name;

// 批量反推：只补还没有提示词的组；跑的过程中别处写了提示词，就不覆盖。每组跑完立刻写回 NAS，取消或出错不丢已完成的。
export function batchReverse(runtime: AiRuntime, config: DavConfig, ids: string[], report: Report) {
  return exclusive(async (signal) => {
    visionModel(runtime);
    const groups = pickGroups((await readLibrary(config)).library, ids);
    const targets = groups.filter((item) => !item.prompt.trim());
    const failures: Failure[] = [];
    let processed = 0;
    for (const [index, item] of targets.entries()) {
      if (signal.aborted) break;
      report({ task: 'AI 反推', done: index, total: targets.length, current: itemName(item) });
      try {
        const prompt = await reversePrompt(runtime, config, item);
        const { result: written } = await mutateLibrary(config, (current) => {
          const latest = current.items.find((entry) => entry.id === item.id);
          if (latest?.prompt.trim()) return { library: current, result: false };
          return { library: patchItem(current, item.id, { prompt }, new Date().toISOString()), result: true };
        });
        if (written) processed += 1;
        else failures.push({ name: itemName(item), message: '反推期间这条素材在别处填了提示词，没有覆盖' });
      } catch (error) {
        failures.push({ name: itemName(item), message: reason(error) });
      }
    }
    return { ...(await readLibrary(config)), processed, skipped: groups.length - targets.length, failures, canceled: signal.aborted };
  });
}

// 批量分类打标签：AI 给出的主分类覆盖原分类（没给出就保留），标签并入原有标签。
export function batchClassify(runtime: AiRuntime, config: DavConfig, ids: string[], report: Report) {
  return exclusive(async (signal) => {
    textModel(runtime);
    let { library } = await readLibrary(config);
    const targets = pickGroups(library, ids);
    const failures: Failure[] = [];
    let processed = 0;
    for (const [index, item] of targets.entries()) {
      if (signal.aborted) break;
      report({ task: 'AI 分类打标签', done: index, total: targets.length, current: itemName(item) });
      try {
        const suggestion = await classifyItem(runtime, config, item, item.prompt, knownCategoriesOf(library));
        ({ library } = await mutateLibrary(config, (current) => {
          const latest = current.items.find((entry) => entry.id === item.id);
          if (!latest) throw new Error('这条素材已经不存在，可能在另一台电脑上被删除了');
          const patch = { tags: [...latest.tags, ...suggestion.tags], ...(suggestion.category ? { category: suggestion.category } : {}) };
          return { library: patchItem(current, item.id, patch, new Date().toISOString()), result: null };
        }));
        processed += 1;
        for (const warning of suggestion.warnings) failures.push({ name: itemName(item), message: warning });
      } catch (error) {
        failures.push({ name: itemName(item), message: reason(error) });
      }
    }
    return { ...(await readLibrary(config)), processed, skipped: 0, failures, canceled: signal.aborted };
  });
}
