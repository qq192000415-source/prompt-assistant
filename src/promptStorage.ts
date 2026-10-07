import { DEFAULT_CATEGORIES, SAMPLE_PROMPTS } from './data';
import { createId, parseTags } from './promptUtils';
import type { PromptItem } from './types';

const STORAGE_KEY = 'prompt-library.items.v1';
const CATEGORY_STORAGE_KEY = 'prompt-library.categories.v1';
const SUBCATEGORY_STORAGE_KEY = 'prompt-library.subcategories.v1';

const isPromptItem = (item: unknown): item is PromptItem => {
  if (!item || typeof item !== 'object') {
    return false;
  }

  const candidate = item as Partial<PromptItem>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.content === 'string' &&
    typeof candidate.category === 'string' &&
    Array.isArray(candidate.tags) &&
    typeof candidate.favorite === 'boolean' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string'
  );
};

export const normalizePrompt = (item: PromptItem): PromptItem => ({
  ...item,
  description: item.description ?? '',
  subcategory: item.subcategory?.trim() || undefined,
  tags: item.tags.filter((tag) => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean),
  lastUsedAt: item.lastUsedAt || undefined,
});

const normalizeImportedItem = (item: unknown): PromptItem | null => {
  if (isPromptItem(item)) {
    return normalizePrompt(item);
  }

  if (!item || typeof item !== 'object') {
    return null;
  }

  const candidate = item as Partial<PromptItem> & { tags?: string[] | string };
  if (typeof candidate.title !== 'string' || typeof candidate.content !== 'string') {
    return null;
  }

  const now = new Date().toISOString();
  const tags = Array.isArray(candidate.tags)
    ? candidate.tags.filter((tag) => typeof tag === 'string')
    : parseTags(candidate.tags ?? '');

  return {
    id: typeof candidate.id === 'string' ? candidate.id : createId(),
    title: candidate.title,
    description: typeof candidate.description === 'string' ? candidate.description : '',
    content: candidate.content,
    category: typeof candidate.category === 'string' ? candidate.category : '其他',
    subcategory: typeof candidate.subcategory === 'string' && candidate.subcategory.trim() ? candidate.subcategory.trim() : undefined,
    tags,
    favorite: typeof candidate.favorite === 'boolean' ? candidate.favorite : false,
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : now,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : now,
    lastUsedAt: typeof candidate.lastUsedAt === 'string' ? candidate.lastUsedAt : undefined,
  };
};

const getImportArray = (parsed: unknown) => {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (parsed && typeof parsed === 'object') {
    const candidate = parsed as { prompts?: unknown; items?: unknown; data?: unknown };
    if (Array.isArray(candidate.prompts)) return candidate.prompts;
    if (Array.isArray(candidate.items)) return candidate.items;
    if (Array.isArray(candidate.data)) return candidate.data;
  }

  return null;
};

export const loadPrompts = (): PromptItem[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return SAMPLE_PROMPTS;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isPromptItem).map(normalizePrompt);
  } catch {
    return [];
  }
};

export const savePrompts = (prompts: PromptItem[]) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
};

export const loadCategories = (): string[] => {
  try {
    const raw = window.localStorage.getItem(CATEGORY_STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_CATEGORIES;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const categories = parsed.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
    return Array.from(new Set(categories));
  } catch {
    return [];
  }
};

export const saveCategories = (categories: string[]) => {
  const normalized = Array.from(new Set(categories.map((category) => category.trim()).filter(Boolean)));
  window.localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(normalized));
};

export const loadSubcategories = (): Record<string, string[]> => {
  try {
    const raw = window.localStorage.getItem(SUBCATEGORY_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([category, subcategories]) => typeof category === 'string' && Array.isArray(subcategories))
        .map(([category, subcategories]) => [
          category.trim(),
          Array.from(
            new Set(
              (subcategories as unknown[])
                .filter((item): item is string => typeof item === 'string')
                .map((item) => item.trim())
                .filter(Boolean),
            ),
          ),
        ])
        .filter(([category]) => Boolean(category)),
    );
  } catch {
    return {};
  }
};

export const saveSubcategories = (subcategories: Record<string, string[]>) => {
  const normalized = Object.fromEntries(
    Object.entries(subcategories)
      .map(([category, items]) => [
        category.trim(),
        Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))),
      ])
      .filter(([category, items]) => Boolean(category) && Array.isArray(items) && items.length),
  );

  window.localStorage.setItem(SUBCATEGORY_STORAGE_KEY, JSON.stringify(normalized));
};

export const parseImportedPrompts = (raw: string): PromptItem[] => {
  const parsed = JSON.parse(raw);
  const importArray = getImportArray(parsed);
  if (!importArray) {
    throw new Error('导入文件必须包含提示词数组。');
  }

  const prompts = importArray.map(normalizeImportedItem).filter((item): item is PromptItem => Boolean(item));
  if (!prompts.length) {
    throw new Error('没有找到可导入的提示词。');
  }

  return prompts;
};
