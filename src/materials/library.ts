// 素材库的数据结构和纯逻辑：归一、增删改、分组、筛选。主进程和界面共用，Node 测试直接加载本文件。
// 「同一提示词的多张效果图归为一组」和组内排序规则移植自 SuYan（MIT，guliacer）
// src/features/library/utils/promptImageGroups.ts、normalizePromptText.ts、buildLibraryFile.ts。
import { isVideoMediaFile } from './mediaFileTypes.ts';

export type MaterialMedia = {
  sha256: string;
  ext: string;
  kind: 'image' | 'video';
  name: string;
  size: number;
  width: number | null;
  height: number | null;
  hasThumb: boolean;
};

export type MaterialItem = {
  id: string;
  title: string;
  prompt: string;
  negativePrompt: string;
  category: string;
  tags: string[];
  favorite: boolean;
  media: MaterialMedia;
  createdAt: string;
  updatedAt: string;
};

export type MaterialLibrary = {
  schemaVersion: 1;
  updatedAt: string;
  items: MaterialItem[];
};

export type MaterialPatch = Partial<Pick<MaterialItem, 'title' | 'prompt' | 'negativePrompt' | 'category' | 'tags' | 'favorite'>>;

export type MaterialGroup = {
  id: string;
  primary: MaterialItem;
  items: MaterialItem[];
};

export const UNCATEGORIZED = '未分类';
export const ALL_CATEGORIES = '全部';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const EXT_PATTERN = /^\.[a-z0-9]{1,5}$/;

export const mediaPath = (media: Pick<MaterialMedia, 'sha256' | 'ext'>) => `media/${media.sha256}${media.ext}`;
export const thumbPath = (media: Pick<MaterialMedia, 'sha256'>) => `thumbs/${media.sha256}.jpg`;

export const emptyLibrary = (now = new Date().toISOString()): MaterialLibrary => ({ schemaVersion: 1, updatedAt: now, items: [] });

export function normalizePromptText(value: string): string {
  // 真实换行属于提示词内容，不能像普通空白一样压平；只移除首尾多余空行。
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

export function uniqueTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const dimension = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null);

function normalizeMedia(raw: unknown): MaterialMedia | null {
  if (!raw || typeof raw !== 'object') return null;
  const media = raw as Record<string, unknown>;
  const sha256 = text(media.sha256);
  const ext = text(media.ext).toLowerCase();
  if (!SHA256_PATTERN.test(sha256) || !EXT_PATTERN.test(ext)) return null;
  const name = text(media.name).trim() || `${sha256.slice(0, 8)}${ext}`;
  return {
    sha256,
    ext,
    kind: media.kind === 'video' || isVideoMediaFile(ext) ? 'video' : 'image',
    name,
    size: typeof media.size === 'number' && media.size >= 0 ? media.size : 0,
    width: dimension(media.width),
    height: dimension(media.height),
    hasThumb: media.hasThumb === true,
  };
}

function normalizeItem(raw: unknown): MaterialItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const id = text(item.id).trim();
  const media = normalizeMedia(item.media);
  if (!id || !media) return null;
  const createdAt = Number.isNaN(Date.parse(text(item.createdAt))) ? new Date(0).toISOString() : text(item.createdAt);
  return {
    id,
    title: text(item.title).trim(),
    prompt: normalizePromptText(text(item.prompt)),
    negativePrompt: normalizePromptText(text(item.negativePrompt)),
    category: text(item.category).trim(),
    tags: uniqueTags(Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string') : []),
    favorite: item.favorite === true,
    media,
    createdAt,
    updatedAt: Number.isNaN(Date.parse(text(item.updatedAt))) ? createdAt : text(item.updatedAt),
  };
}

// dropped 是读不懂的记录条数。界面要提示出来：下次写入时这些记录不会被保留。
export function normalizeLibrary(raw: unknown): { library: MaterialLibrary; dropped: number } {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rawItems = Array.isArray(source.items) ? source.items : [];
  const seen = new Set<string>();
  const items: MaterialItem[] = [];
  for (const rawItem of rawItems) {
    const item = normalizeItem(rawItem);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  const updatedAt = Number.isNaN(Date.parse(text(source.updatedAt))) ? new Date(0).toISOString() : text(source.updatedAt);
  return { library: { schemaVersion: 1, updatedAt, items }, dropped: rawItems.length - items.length };
}

// 同一个文件（sha256 相同）只收一次。
export function addItems(library: MaterialLibrary, incoming: readonly MaterialItem[], now: string) {
  const known = new Set(library.items.map((item) => item.media.sha256));
  const added: MaterialItem[] = [];
  const skipped: MaterialItem[] = [];
  for (const item of incoming) {
    if (known.has(item.media.sha256)) {
      skipped.push(item);
      continue;
    }
    known.add(item.media.sha256);
    added.push(item);
  }
  return { library: { ...library, updatedAt: now, items: [...library.items, ...added] }, added, skipped };
}

function normalizeGroupText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

// 标题、正负提示词、标签、分类都一样的素材是同一组效果图；全空的素材各自成组。
export function groupKey(item: MaterialItem): string {
  const title = normalizeGroupText(item.title);
  const prompt = normalizeGroupText(item.prompt);
  const negativePrompt = normalizeGroupText(item.negativePrompt);
  const tags = item.tags.map(normalizeGroupText).filter(Boolean).sort().join('|');
  const category = normalizeGroupText(item.category);
  if (!title && !prompt && !negativePrompt && !tags && !category) {
    return `blank:${item.id}`;
  }
  return [title, prompt, negativePrompt, tags, category].join('\n');
}

const TEXT_PATCH_KEYS = ['title', 'prompt', 'negativePrompt', 'category', 'tags'] as const;

// 改文字时整组一起改，组才不会被拆散；收藏只改这一张。
export function patchItem(library: MaterialLibrary, itemId: string, patch: MaterialPatch, now: string): MaterialLibrary {
  const base = library.items.find((item) => item.id === itemId);
  if (!base) {
    throw new Error('这条素材已经不存在，可能在另一台电脑上被删除了');
  }
  const changesText = TEXT_PATCH_KEYS.some((key) => key in patch);
  const baseKey = groupKey(base);
  const targets = new Set(
    changesText ? library.items.filter((item) => groupKey(item) === baseKey).map((item) => item.id) : [itemId],
  );
  const cleanPatch: MaterialPatch = { ...patch };
  if (patch.title !== undefined) cleanPatch.title = patch.title.trim();
  if (patch.prompt !== undefined) cleanPatch.prompt = normalizePromptText(patch.prompt);
  if (patch.negativePrompt !== undefined) cleanPatch.negativePrompt = normalizePromptText(patch.negativePrompt);
  if (patch.category !== undefined) cleanPatch.category = patch.category.trim() === UNCATEGORIZED ? '' : patch.category.trim();
  if (patch.tags !== undefined) cleanPatch.tags = uniqueTags(patch.tags);
  return {
    ...library,
    updatedAt: now,
    items: library.items.map((item) => (targets.has(item.id) ? { ...item, ...cleanPatch, updatedAt: now } : item)),
  };
}

// orphaned 是删完后没有任何素材再引用的文件，调用方据此删除 NAS 上的原图和缩略图。
export function deleteItems(library: MaterialLibrary, ids: readonly string[], now: string) {
  const removing = new Set(ids);
  const items = library.items.filter((item) => !removing.has(item.id));
  const stillUsed = new Set(items.map((item) => item.media.sha256));
  const orphaned = new Map<string, MaterialMedia>();
  for (const item of library.items) {
    if (removing.has(item.id) && !stillUsed.has(item.media.sha256)) {
      orphaned.set(item.media.sha256, item.media);
    }
  }
  return { library: { ...library, updatedAt: now, items }, orphaned: [...orphaned.values()] };
}

// 组内按加入时间排，原始效果图在前；组与组按最近一次加入排，新导入的在最前。
export function groupMaterials(items: readonly MaterialItem[]): MaterialGroup[] {
  const groups = new Map<string, MaterialItem[]>();
  for (const item of items) {
    const key = groupKey(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  const time = (item: MaterialItem) => Date.parse(item.createdAt) || 0;
  return [...groups.entries()]
    .map(([id, groupItems]) => {
      const sorted = [...groupItems].sort((a, b) => time(a) - time(b));
      return { id, primary: sorted[0], items: sorted, latest: Math.max(...sorted.map(time)) };
    })
    .sort((a, b) => b.latest - a.latest)
    .map(({ id, primary, items: groupItems }) => ({ id, primary, items: groupItems }));
}

export const categoryOf = (item: MaterialItem) => item.category || UNCATEGORIZED;

export function filterGroups(groups: readonly MaterialGroup[], options: { query: string; category: string }): MaterialGroup[] {
  const query = options.query.trim().toLowerCase();
  return groups.filter((group) => {
    const item = group.primary;
    if (options.category !== ALL_CATEGORIES && categoryOf(item) !== options.category) return false;
    if (!query) return true;
    const haystack = [item.title, item.prompt, item.negativePrompt, categoryOf(item), ...item.tags, ...group.items.map((member) => member.media.name)]
      .join('\n')
      .toLowerCase();
    return haystack.includes(query);
  });
}

// 「全部」在最前，未分类在最后，其余按组数从多到少。
export function categoryCounts(groups: readonly MaterialGroup[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const group of groups) {
    const name = categoryOf(group.primary);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const named = [...counts.entries()]
    .filter(([name]) => name !== UNCATEGORIZED)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .map(([name, count]) => ({ name, count }));
  const uncategorized = counts.get(UNCATEGORIZED);
  return [
    { name: ALL_CATEGORIES, count: groups.length },
    ...named,
    ...(uncategorized ? [{ name: UNCATEGORIZED, count: uncategorized }] : []),
  ];
}
