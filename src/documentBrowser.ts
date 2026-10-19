// 文档库文件夹视图的纯逻辑：按扩展名分类型、排序、按类型筛。只用 import type 和带 .ts 后缀的导入，Node 测试能直接加载。
import { getFileExtension } from './promptUtils.ts';
import type { PromptItem } from './types';

export type DocumentKind = 'word' | 'pdf' | 'markdown' | 'sheet' | 'slide' | 'text' | 'other';
export type DocumentSort = 'recent' | 'name' | 'size';

const KINDS: Array<{ kind: DocumentKind; label: string; extensions: string[] }> = [
  { kind: 'word', label: 'Word', extensions: ['doc', 'docx'] },
  { kind: 'pdf', label: 'PDF', extensions: ['pdf'] },
  { kind: 'markdown', label: 'Markdown', extensions: ['md', 'markdown'] },
  { kind: 'sheet', label: '表格', extensions: ['xls', 'xlsx', 'csv'] },
  { kind: 'slide', label: '演示', extensions: ['ppt', 'pptx'] },
  { kind: 'text', label: '文本', extensions: ['txt'] },
];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  ...(Object.fromEntries(KINDS.map(({ kind, label }) => [kind, label])) as Record<Exclude<DocumentKind, 'other'>, string>),
  other: '其他',
};

// 色块上的字：大写扩展名，最多 4 个字符；没有扩展名写 FILE。
export function documentKind(name: string) {
  const extension = getFileExtension(name);
  const kind = KINDS.find((entry) => entry.extensions.includes(extension))?.kind ?? 'other';
  return { kind, label: DOCUMENT_KIND_LABELS[kind], ext: extension ? extension.slice(0, 4).toUpperCase() : 'FILE' };
}

const addedTime = (item: PromptItem) => Date.parse(item.file?.addedAt ?? item.createdAt) || 0;

// 稳定排序：同时间、同名、同大小的保持原来的顺序。
export function sortDocuments(items: readonly PromptItem[], order: DocumentSort) {
  const compare: Record<DocumentSort, (a: PromptItem, b: PromptItem) => number> = {
    recent: (a, b) => addedTime(b) - addedTime(a),
    name: (a, b) => a.title.localeCompare(b.title, 'zh-CN'),
    size: (a, b) => (b.file?.size ?? 0) - (a.file?.size ?? 0),
  };
  return [...items].sort(compare[order]);
}

export function filterDocumentsByKind(items: readonly PromptItem[], kind: DocumentKind | 'all') {
  return kind === 'all' ? [...items] : items.filter((item) => documentKind(item.file?.name ?? '').kind === kind);
}

// 列表里出现过的类型和数量，按固定顺序；类型筛选只列这些。
export function documentKindCounts(items: readonly PromptItem[]) {
  const counts = new Map<DocumentKind, number>();
  for (const item of items) {
    const { kind } = documentKind(item.file?.name ?? '');
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...KINDS.map((entry) => entry.kind), 'other' as const].filter((kind) => counts.has(kind)).map((kind) => ({ kind, label: DOCUMENT_KIND_LABELS[kind], count: counts.get(kind)! }));
}
