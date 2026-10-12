import { DEFAULT_CATEGORIES, SAMPLE_PROMPTS } from './data.ts';
import { createId, parseTags } from './promptUtils.ts';
import type { DocumentFile, PromptItem } from './types';

const STORAGE_KEY = 'prompt-library.items.v1';
const CATEGORY_STORAGE_KEY = 'prompt-library.categories.v1';
const SUBCATEGORY_STORAGE_KEY = 'prompt-library.subcategories.v1';
export const DOCUMENT_CATEGORY_STORAGE_KEY = 'prompt-library.documentCategories.v1';
export const DOCUMENT_SUBCATEGORY_STORAGE_KEY = 'prompt-library.documentSubcategories.v1';

const isDocumentFile = (value: unknown) => {
  if (!value || typeof value !== 'object') return false;
  const file = value as Partial<DocumentFile>;
  return (
    typeof file.name === 'string' &&
    typeof file.size === 'number' &&
    typeof file.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(file.sha256) &&
    typeof file.addedAt === 'string'
  );
};

const isPromptItem = (item: unknown): item is PromptItem => {
  if (!item || typeof item !== 'object') {
    return false;
  }

  const candidate = item as Partial<PromptItem>;
  if (candidate.kind !== undefined && (candidate.kind !== 'document' || !isDocumentFile(candidate.file))) {
    return false;
  }

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
  if (candidate.kind !== undefined || typeof candidate.title !== 'string' || typeof candidate.content !== 'string') {
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

export const loadCategories = (key = CATEGORY_STORAGE_KEY, fallback: string[] = DEFAULT_CATEGORIES): string[] => {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      return fallback;
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

export const saveCategories = (categories: string[], key = CATEGORY_STORAGE_KEY) => {
  const normalized = Array.from(new Set(categories.map((category) => category.trim()).filter(Boolean)));
  window.localStorage.setItem(key, JSON.stringify(normalized));
};

export const loadSubcategories = (key = SUBCATEGORY_STORAGE_KEY): Record<string, string[]> => {
  try {
    const raw = window.localStorage.getItem(key);
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

export const saveSubcategories = (subcategories: Record<string, string[]>, key = SUBCATEGORY_STORAGE_KEY) => {
  const normalized = Object.fromEntries(
    Object.entries(subcategories)
      .map(([category, items]) => [
        category.trim(),
        Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))),
      ])
      .filter(([category, items]) => Boolean(category) && Array.isArray(items) && items.length),
  );

  window.localStorage.setItem(key, JSON.stringify(normalized));
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

const parseCsvRows = (raw: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (quoted) {
      if (char === '"' && raw[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows.filter((cells) => cells.some((item) => item.trim()));
};

const makeImportedPrompt = (title: string, category: string, content: string): PromptItem => {
  const now = new Date().toISOString();
  return {
    id: createId(),
    title: title.trim() || `导入提示词 ${now.slice(11, 19)}`,
    description: '',
    content: content.trim(),
    category: category.trim() || '其他',
    subcategory: undefined,
    tags: [],
    favorite: false,
    createdAt: now,
    updatedAt: now,
  };
};

export const parseTextPrompts = (raw: string): PromptItem[] => {
  const blocks = raw
    .split(/\n\s*---\s*\n|\n{2,}(?=主文件名：)/g)
    .map((block) => block.trim())
    .filter(Boolean);

  const prompts = blocks
    .map((block, index) => {
      const lines = block.split(/\r?\n/);
      if (lines[0]?.startsWith('主文件名：')) {
        const category = lines.shift()?.replace(/^主文件名：/, '').trim() || '其他';
        const titleLine = lines[0]?.startsWith('子文件名：') ? lines.shift() : '';
        const title = titleLine?.replace(/^子文件名：/, '').trim() || `导入提示词 ${index + 1}`;
        if (lines[0]?.startsWith('提示词内容：')) {
          lines.shift();
        }

        const content = lines.join('\n').trim();
        return content ? makeImportedPrompt(title, category, content) : null;
      }

      const firstLine = lines.shift()?.trim() ?? '';
      const title = firstLine.replace(/^#+\s*/, '').trim() || `导入提示词 ${index + 1}`;
      let category = '其他';

      if (lines[0]?.startsWith('主文件夹：') || lines[0]?.startsWith('分类：')) {
        category = lines.shift()?.replace(/^主文件夹：|^分类：/, '').trim() || '其他';
      }

      const content = lines.join('\n').trim() || block;
      return content ? makeImportedPrompt(title, category, content) : null;
    })
    .filter((prompt): prompt is PromptItem => Boolean(prompt));

  if (!prompts.length) {
    throw new Error('没有找到可导入的提示词。');
  }

  return prompts;
};

export const parseCsvPrompts = (raw: string): PromptItem[] => {
  const rows = parseCsvRows(raw);
  const header = rows[0]?.map((item) => item.trim()) ?? [];
  const hasHeader = header.some((item) => ['主文件夹', '分类', '子文件名称', '标题', '提示词内容', '正文', 'content'].includes(item));
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const getIndex = (names: string[], fallback: number) => {
    const index = header.findIndex((item) => names.includes(item));
    return index === -1 ? fallback : index;
  };

  const categoryIndex = hasHeader ? getIndex(['主文件夹', '分类', 'category'], 0) : 0;
  const titleIndex = hasHeader ? getIndex(['子文件名称', '标题', 'title'], 1) : 1;
  const contentIndex = hasHeader ? getIndex(['提示词内容', '正文', 'content'], 2) : 2;

  const prompts = dataRows
    .map((row, index) => {
      const category = row[categoryIndex] ?? '其他';
      const title = row[titleIndex] ?? row[0] ?? `导入提示词 ${index + 1}`;
      const content = row[contentIndex] ?? row[row.length - 1] ?? '';
      return content.trim() ? makeImportedPrompt(title, category, content) : null;
    })
    .filter((prompt): prompt is PromptItem => Boolean(prompt));

  if (!prompts.length) {
    throw new Error('没有找到可导入的提示词。');
  }

  return prompts;
};

