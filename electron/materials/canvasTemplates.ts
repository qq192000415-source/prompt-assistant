// 创作画布的提示词模板：和提示词库分开，只放生图用的，存在 NAS 的 canvas-templates.json，几台电脑共用。
// 写入一律走 mutateJsonFile 加锁，和生成历史一样。不依赖 Electron，Node 测试可直接加载。
import { randomUUID } from 'node:crypto';
import { mutateJsonFile } from './libraryStore.ts';
import * as webdav from './webdav.ts';
import type { DavConfig } from './webdav.ts';

export const TEMPLATES_FILE = 'canvas-templates.json';
export const DEFAULT_TEMPLATE_CATEGORY = '未分类';

export type CanvasTemplate = { id: string; title: string; content: string; category: string; useCount: number; createdAt: string; updatedAt: string };
export type CanvasTemplates = { schemaVersion: 1; updatedAt: string; templates: CanvasTemplate[] };
export type TemplateInput = { id?: string; title: string; content: string; category: string };

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function normalizeTemplate(raw: unknown): CanvasTemplate | null {
  if (!isRecord(raw) || !text(raw.id) || !text(raw.content).trim()) return null;
  return {
    id: text(raw.id),
    title: text(raw.title).trim() || text(raw.content).trim().split(/\r?\n/)[0].slice(0, 24),
    content: text(raw.content),
    category: text(raw.category).trim() || DEFAULT_TEMPLATE_CATEGORY,
    useCount: typeof raw.useCount === 'number' && raw.useCount > 0 ? Math.floor(raw.useCount) : 0,
    createdAt: text(raw.createdAt),
    updatedAt: text(raw.updatedAt),
  };
}

// 读不懂的模板跳过并计数，界面会提示下次写入时它们不会被保留。
export function normalizeTemplates(raw: unknown): { templates: CanvasTemplates; dropped: number } {
  const source = isRecord(raw) && Array.isArray(raw.templates) ? raw.templates : [];
  const templates = source.map(normalizeTemplate).filter((entry): entry is CanvasTemplate => entry !== null);
  return { templates: { schemaVersion: 1, updatedAt: isRecord(raw) ? text(raw.updatedAt) : '', templates }, dropped: source.length - templates.length };
}

function parseTemplates(content: string | null) {
  if (content === null || !content.trim()) return { data: normalizeTemplates(null).templates, dropped: 0 };
  try {
    const { templates, dropped } = normalizeTemplates(JSON.parse(content));
    return { data: templates, dropped };
  } catch {
    throw new Error(`NAS 上的 ${TEMPLATES_FILE} 不是有效的 JSON，已停止，避免覆盖。请先检查这个文件`);
  }
}

export async function readTemplates(config: DavConfig) {
  const { data, dropped } = parseTemplates(await webdav.readText(config, TEMPLATES_FILE));
  return { templates: data, dropped };
}

export async function mutateTemplates<T>(config: DavConfig, change: (templates: CanvasTemplates) => { templates: CanvasTemplates; result: T }) {
  const { data, dropped, result } = await mutateJsonFile(
    config,
    TEMPLATES_FILE,
    parseTemplates,
    (templates) => {
      const changed = change(templates);
      return { data: changed.templates, result: changed.result };
    },
    '画布模板',
  );
  return { templates: data, dropped, result };
}

const withList = (current: CanvasTemplates, list: CanvasTemplate[], now: string): CanvasTemplates => ({ ...current, updatedAt: now, templates: list });

// 没有 id 是新建（内容和已有的一样就不加，返回 duplicate），有 id 是改那一条（找不到报错）。
export function saveTemplate(current: CanvasTemplates, input: TemplateInput, now: string): { templates: CanvasTemplates; result: { id: string; duplicate: boolean } } {
  const content = text(input.content).trim();
  if (!content) throw new Error('模板内容不能是空的');
  const title = text(input.title).trim() || content.split(/\r?\n/)[0].slice(0, 24);
  const category = text(input.category).trim() || DEFAULT_TEMPLATE_CATEGORY;
  if (input.id) {
    if (!current.templates.some((entry) => entry.id === input.id)) throw new Error('这个模板已经被删掉了（可能是在别的电脑上），没有保存');
    const list = current.templates.map((entry) => (entry.id === input.id ? { ...entry, title, content, category, updatedAt: now } : entry));
    return { templates: withList(current, list, now), result: { id: input.id, duplicate: false } };
  }
  const existing = current.templates.find((entry) => entry.content.trim() === content);
  if (existing) return { templates: current, result: { id: existing.id, duplicate: true } };
  const template: CanvasTemplate = { id: randomUUID(), title, content, category, useCount: 0, createdAt: now, updatedAt: now };
  return { templates: withList(current, [...current.templates, template], now), result: { id: template.id, duplicate: false } };
}

export function deleteTemplate(current: CanvasTemplates, id: string, now: string): CanvasTemplates {
  return withList(current, current.templates.filter((entry) => entry.id !== id), now);
}

// 插入、替换时记一次使用，常用模板按次数排。不改 updatedAt：只是用了，内容没变。
export function markTemplateUsed(current: CanvasTemplates, id: string, now: string): CanvasTemplates {
  return withList(current, current.templates.map((entry) => (entry.id === id ? { ...entry, useCount: entry.useCount + 1 } : entry)), now);
}
