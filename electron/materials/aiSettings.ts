// 素材库 AI 设置：文本模型、视觉模型（各自可选 OpenAI 兼容接口或 Ollama）、画布的生图模型（只能是 OpenAI 兼容接口）和每个功能选用的规则。
// 存在本机 userData/materials-ai.json，API Key 用系统加密（safeStorage），不上 NAS，渲染进程拿不到 Key。
import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import type { AiProvider, AiRuntime, AiSlot } from './ai.ts';
import { normalizeAiBaseUrlForProvider } from './suyan/aiBaseUrl.ts';
import { aiFeatureActionMeta, buildAiActionInstructions, normalizeAiRuleSelectionIds, type AiFeatureAction } from './suyan/aiTypes.ts';
import { listOllamaModels, testOllamaConnection } from './suyan/ollamaAiClient.ts';
import { listRemoteModels, testRemoteConnection } from './suyan/remoteAiClient.ts';

type SlotName = 'text' | 'vision' | 'image';
type ActionPreference = { rulePresetIds: string[]; customInstructions: string };
type Stored = {
  text: AiSlot | null;
  vision: AiSlot | null;
  image: AiSlot | null;
  actions: Partial<Record<AiFeatureAction, ActionPreference>>;
  canvas: CanvasOptions;
};

// 画布任务队列：同时跑几张图、临时失败自动重试几次（和 iLab 的默认值一样）。
export type CanvasOptions = { concurrency: number; retries: number };
const DEFAULT_CANVAS: CanvasOptions = { concurrency: 2, retries: 2 };
const clampInt = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
function normalizeCanvasOptions(raw: unknown): CanvasOptions {
  const options = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return { concurrency: clampInt(options.concurrency, 1, 4, DEFAULT_CANVAS.concurrency), retries: clampInt(options.retries, 0, 5, DEFAULT_CANVAS.retries) };
}

// 素材库用到的功能，顺序就是设置里的显示顺序。
const ACTIONS: AiFeatureAction[] = ['image-reverse', 'prompt-optimization', 'prompt-translation', 'image-category', 'image-tags', 'prompt-category', 'prompt-tags', 'image-generation'];
const SLOT_LABELS: Record<SlotName, string> = { text: '文本模型', vision: '视觉模型', image: '生图模型' };

const settingsPath = (userDataDir: string) => path.join(userDataDir, 'materials-ai.json');

const asProvider = (value: unknown): AiProvider => (value === 'ollama' ? 'ollama' : 'openai-compatible');
const asText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function readSlot(raw: unknown): AiSlot | null {
  if (!raw || typeof raw !== 'object') return null;
  const slot = raw as Record<string, unknown>;
  const baseUrl = asText(slot.baseUrl);
  return baseUrl ? { provider: asProvider(slot.provider), baseUrl, apiKey: asText(slot.apiKey), model: asText(slot.model) } : null;
}

function readStored(userDataDir: string): Stored {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(userDataDir), 'utf8')) as Record<string, unknown>;
    const actions: Stored['actions'] = {};
    const rawActions = raw.actions && typeof raw.actions === 'object' ? (raw.actions as Record<string, Record<string, unknown>>) : {};
    for (const action of ACTIONS) {
      const preference = rawActions[action];
      if (!preference) continue;
      actions[action] = {
        rulePresetIds: normalizeAiRuleSelectionIds(action, preference.rulePresetIds),
        customInstructions: asText(preference.customInstructions),
      };
    }
    return { text: readSlot(raw.text), vision: readSlot(raw.vision), image: readSlot(raw.image), actions, canvas: normalizeCanvasOptions(raw.canvas) };
  } catch {
    return { text: null, vision: null, image: null, actions: {}, canvas: DEFAULT_CANVAS };
  }
}

const decrypt = (apiKey: string) => (apiKey ? safeStorage.decryptString(Buffer.from(apiKey, 'base64')) : '');
const decryptSlot = (slot: AiSlot | null): AiSlot | null => (slot ? { ...slot, apiKey: decrypt(slot.apiKey) } : null);

// Ollama 不要 Key；远程接口地址、模型、Key 缺一不可。
const isUsable = (slot: AiSlot | null) => Boolean(slot && slot.model && (slot.provider === 'ollama' || slot.apiKey));

export function getPublicAiSettings(userDataDir: string) {
  const stored = readStored(userDataDir);
  const publicSlot = (slot: AiSlot | null) =>
    slot ? { provider: slot.provider, baseUrl: slot.baseUrl, model: slot.model, hasApiKey: Boolean(slot.apiKey), usable: isUsable(slot) } : null;
  return {
    text: publicSlot(stored.text),
    vision: publicSlot(stored.vision),
    image: publicSlot(stored.image),
    canvas: stored.canvas,
    actions: ACTIONS.map((action) => {
      const meta = aiFeatureActionMeta[action];
      const preference = stored.actions[action];
      return {
        action,
        // SuYan 这一项叫「画布默认模型」（它在这里选模型），我们的模型在上面单独设，这里只有规则。
        label: action === 'image-generation' ? '生图' : meta.label,
        description: meta.description,
        placeholder: meta.rulePlaceholder,
        capability: meta.capability,
        presets: meta.rulePresets.map((preset) => ({ id: preset.id, label: preset.label })),
        rulePresetIds: preference?.rulePresetIds ?? [meta.defaultRulePreset.id],
        customInstructions: preference?.customInstructions ?? '',
      };
    }),
  };
}

export function loadAiRuntime(userDataDir: string): AiRuntime {
  const stored = readStored(userDataDir);
  const usable = (slot: AiSlot | null) => (isUsable(slot) ? decryptSlot(slot) : null);
  return {
    text: usable(stored.text),
    vision: usable(stored.vision),
    image: usable(stored.image),
    instructions: (action) => buildAiActionInstructions(action, stored.actions[action]),
  };
}

type SlotInput = { provider?: unknown; baseUrl?: unknown; model?: unknown; apiKey?: unknown };

// 界面传来的模型设置；apiKey 留空表示沿用这个位置已保存的 Key。地址为空表示不用这个位置。
function slotFromInput(userDataDir: string, name: SlotName, input: SlotInput | null | undefined): AiSlot | null {
  if (!input) return null;
  // 生图走 SuYan 的 OpenAI 兼容 /images 接口，Ollama 不能生图。
  const provider = name === 'image' ? 'openai-compatible' : asProvider(input.provider);
  const rawUrl = asText(input.baseUrl);
  if (!rawUrl) return null;
  const baseUrl = normalizeAiBaseUrlForProvider(rawUrl, provider);
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error(`${SLOT_LABELS[name]}的接口地址要以 http:// 或 https:// 开头`);
  const saved = readStored(userDataDir)[name];
  const apiKey = asText(input.apiKey) || (saved && saved.provider === provider ? decrypt(saved.apiKey) : '');
  return { provider, baseUrl, model: asText(input.model), apiKey: provider === 'ollama' ? '' : apiKey };
}

export const loadCanvasOptions = (userDataDir: string) => readStored(userDataDir).canvas;

export function saveAiSettings(userDataDir: string, input: { text?: SlotInput | null; vision?: SlotInput | null; image?: SlotInput | null; canvas?: unknown; actions?: Record<string, { rulePresetIds?: unknown; customInstructions?: unknown }> }) {
  const text = slotFromInput(userDataDir, 'text', input.text);
  const vision = slotFromInput(userDataDir, 'vision', input.vision);
  const image = slotFromInput(userDataDir, 'image', input.image);
  if ((text?.apiKey || vision?.apiKey || image?.apiKey) && !safeStorage.isEncryptionAvailable()) {
    throw new Error('这台电脑无法加密保存 API Key，没有保存 AI 设置');
  }
  const encryptSlot = (slot: AiSlot | null) => (slot ? { ...slot, apiKey: slot.apiKey ? safeStorage.encryptString(slot.apiKey).toString('base64') : '' } : null);
  const actions: Stored['actions'] = {};
  for (const action of ACTIONS) {
    const preference = input.actions?.[action];
    if (!preference) continue;
    actions[action] = {
      rulePresetIds: normalizeAiRuleSelectionIds(action, preference.rulePresetIds),
      customInstructions: asText(preference.customInstructions).slice(0, 12000),
    };
  }
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(settingsPath(userDataDir), JSON.stringify({ text: encryptSlot(text), vision: encryptSlot(vision), image: encryptSlot(image), actions, canvas: normalizeCanvasOptions(input.canvas) }, null, 2));
  return getPublicAiSettings(userDataDir);
}

const toProviderSettings = (slot: AiSlot) => ({ id: 'materials', name: '素材库', enabled: true, ...slot, models: [] });

// 查询接口上的模型列表，给界面做下拉选择；视觉、生图能力是 SuYan 按接口字段或模型名推断的，认不出时不一定没有。
// 生图位置不按能力过滤：SuYan 的名称规则不认得 grok-imagine 这类模型，过滤掉就选不到了。
export async function listModels(userDataDir: string, name: SlotName, input: SlotInput) {
  const slot = slotFromInput(userDataDir, name, input);
  if (!slot) throw new Error('先填写接口地址');
  const settings = toProviderSettings(slot);
  const models = slot.provider === 'ollama' ? await listOllamaModels(settings) : await listRemoteModels(settings);
  return models
    .filter((model) => name === 'image' || model.capabilities.includes('text') || model.capabilities.includes('vision'))
    .map((model) => ({
      id: model.id,
      vision: model.capabilities.includes('vision'),
      generation: model.capabilities.includes('image-generation') || model.capabilities.includes('video-generation'),
    }));
}

export async function testModel(userDataDir: string, name: SlotName, input: SlotInput) {
  const slot = slotFromInput(userDataDir, name, input);
  if (!slot?.model) throw new Error('先填写接口地址和模型');
  const settings = toProviderSettings(slot);
  // 生图模型不能聊天，测连接不能发对话请求（还可能扣费）；改为确认接口通、Key 对、模型在列表里。
  if (name === 'image') {
    const models = await listRemoteModels(settings);
    if (!models.some((model) => model.id === slot.model)) throw new Error(`接口能连上，但模型列表里没有 ${slot.model}`);
    return;
  }
  await (slot.provider === 'ollama' ? testOllamaConnection(settings) : testRemoteConnection(settings));
}
