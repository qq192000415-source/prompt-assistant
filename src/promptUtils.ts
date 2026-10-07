import type { PromptItem, ViewKey } from './types';

const SUBCATEGORY_SEPARATOR = '::';

export const createId = () => {
  if ('crypto' in window && 'randomUUID' in window.crypto) {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const parseTags = (value: string) =>
  value
    .split(/[,，\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);

export const parseVariables = (content: string) => {
  const matches = content.matchAll(/\{([^{}\n]+)\}/g);
  return Array.from(new Set(Array.from(matches, (match) => match[1].trim()).filter(Boolean)));
};

export const makeSubcategoryView = (category: string, subcategory: string): ViewKey =>
  `subcategory:${encodeURIComponent(category)}${SUBCATEGORY_SEPARATOR}${encodeURIComponent(subcategory)}`;

export const parseSubcategoryView = (view: ViewKey) => {
  if (!view.startsWith('subcategory:')) {
    return null;
  }

  const raw = view.replace('subcategory:', '');
  const [category, subcategory] = raw.split(SUBCATEGORY_SEPARATOR);
  if (!category || !subcategory) {
    return null;
  }

  return {
    category: decodeURIComponent(category),
    subcategory: decodeURIComponent(subcategory),
  };
};

export const fillVariables = (content: string, values: Record<string, string>) =>
  content.replace(/\{([^{}\n]+)\}/g, (match, key) => {
    const value = values[key.trim()];
    return value?.trim() ? value : match;
  });

const copyWithSelectionFallback = (content: string) => {
  const textarea = document.createElement('textarea');
  const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  textarea.value = content;
  textarea.setAttribute('readonly', '');
  textarea.style.opacity = '0';
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';
  textarea.style.width = '1px';
  textarea.style.height = '1px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  previousActiveElement?.focus();

  if (!copied) {
    throw new Error('copy command failed');
  }
};

export const copyToClipboard = async (content: string) => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(content);
      return;
    } catch {
      // Fall through to the selection-based copy path for stricter browser shells.
    }
  }

  try {
    copyWithSelectionFallback(content);
    return;
  } catch (fallbackError) {
    throw fallbackError;
  }
};

export const filterPrompts = (prompts: PromptItem[], view: ViewKey, query: string) => {
  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = (prompt: PromptItem) => {
    if (!normalizedQuery) {
      return true;
    }

    const target = [prompt.title, prompt.description, prompt.content, prompt.category, prompt.subcategory, ...prompt.tags]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return target.includes(normalizedQuery);
  };

  if (normalizedQuery) {
    return prompts.filter(matchesQuery);
  }

  const filtered = prompts
    .filter((prompt) => {
      if (view === 'favorites') {
        return prompt.favorite;
      }

      if (view === 'recent') {
        return Boolean(prompt.lastUsedAt);
      }

      if (view === 'trash') {
        return false;
      }

      const subcategoryView = parseSubcategoryView(view);
      if (subcategoryView) {
        return prompt.category === subcategoryView.category && prompt.subcategory === subcategoryView.subcategory;
      }

      if (view.startsWith('category:')) {
        return prompt.category === view.replace('category:', '');
      }

      return true;
    });

  if (view === 'recent') {
    return filtered.sort((a, b) => Date.parse(b.lastUsedAt ?? b.updatedAt) - Date.parse(a.lastUsedAt ?? a.updatedAt));
  }

  return filtered;
};

export const getViewLabel = (view: ViewKey) => {
  if (view === 'all') return '全部提示词';
  if (view === 'favorites') return '收藏';
  if (view === 'recent') return '最近使用';
  if (view === 'trash') return '删除记录';
  const subcategoryView = parseSubcategoryView(view);
  if (subcategoryView) return `${subcategoryView.category} / ${subcategoryView.subcategory}`;
  return view.replace('category:', '');
};

export const formatDate = (value?: string) => {
  if (!value) return '未使用';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
};
