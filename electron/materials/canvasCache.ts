// 画布生成记录的本机缓存：NAS 断开时画布照常显示，断线期间生成的图先存本机，NAS 恢复后传上去再删掉本机这份。
// 布局 <userData>/canvas-cache/<账号>/：history.json（最近一次从 NAS 读到的记录）、thumbs/<sha256>.jpg（看过的缩略图）、
// pending.json + pending/<sha256><ext>（还没传上 NAS 的结果）。缩略图超过 7 天没用过、或总量超过 500MB 时从最久没用的删起；
// 待上传的在传上去之前一直留着，超过上限只提醒，不删。不依赖 Electron，Node 测试可直接加载。
import fs from 'node:fs';
import path from 'node:path';
import { normalizeHistory, recordSlot, type CanvasHistory, type HistorySlot, type HistoryTask } from './canvasHistory.ts';

export const CACHE_MAX_AGE_MS = 7 * 24 * 3600_000;
export const CACHE_MAX_BYTES = 500 * 1024 * 1024;

export type PendingTask = Omit<HistoryTask, 'slots' | 'updatedAt'>;
export type PendingEntry = { task: PendingTask; slot: HistorySlot; at: string };

export const cacheDir = (userDataDir: string, account: string) =>
  path.join(userDataDir, 'canvas-cache', account.trim().toLowerCase().replace(/[^a-z0-9@._+-]/g, '_'));

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

// 先写临时文件再改名，写到一半断电不会留下半个 JSON。
const writeJson = (file: string, data: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
  fs.renameSync(`${file}.tmp`, file);
};

const pendingFile = (dir: string) => path.join(dir, 'pending.json');
const pendingMediaFile = (dir: string, media: { sha256: string; ext: string }) => path.join(dir, 'pending', `${media.sha256}${media.ext}`);
const thumbFile = (dir: string, sha256: string) => path.join(dir, 'thumbs', `${sha256}.jpg`);

export function saveHistoryCopy(dir: string, history: CanvasHistory) {
  writeJson(path.join(dir, 'history.json'), history);
}

export function readHistoryCopy(dir: string): CanvasHistory | null {
  const raw = readJson(path.join(dir, 'history.json'));
  return raw ? normalizeHistory(raw).history : null;
}

export function listPending(dir: string): PendingEntry[] {
  const raw = readJson(pendingFile(dir));
  return Array.isArray(raw) ? raw.filter((entry): entry is PendingEntry => Boolean(entry?.task?.id && typeof entry?.slot?.index === 'number')) : [];
}

// 记一个没写进 NAS 生成历史的槽位：生成好的带原图（和缩略图），失败的只记原因。同一槽位重试后覆盖。
export function addPending(dir: string, task: PendingTask, slot: HistorySlot, files: { media?: Buffer; thumb?: Buffer | null } = {}, at = new Date().toISOString()) {
  if (slot.media && files.media) {
    fs.mkdirSync(path.join(dir, 'pending'), { recursive: true });
    fs.writeFileSync(pendingMediaFile(dir, slot.media), files.media);
  }
  if (slot.media && files.thumb) storeThumb(dir, slot.media.sha256, files.thumb);
  const others = listPending(dir).filter((entry) => !(entry.task.id === task.id && entry.slot.index === slot.index));
  writeJson(pendingFile(dir), [...others, { task, slot, at }]);
}

// 传上 NAS 之后（或被删掉时）去掉；原图没有别的待上传条目再用就删，缩略图留着当普通缓存。
export function removePending(dir: string, match: (entry: PendingEntry) => boolean) {
  const entries = listPending(dir);
  const kept = entries.filter((entry) => !match(entry));
  if (kept.length === entries.length) return 0;
  writeJson(pendingFile(dir), kept);
  const stillUsed = new Set(kept.flatMap((entry) => (entry.slot.media ? [entry.slot.media.sha256] : [])));
  for (const entry of entries) {
    if (entry.slot.media && !stillUsed.has(entry.slot.media.sha256)) fs.rmSync(pendingMediaFile(dir, entry.slot.media), { force: true });
  }
  return entries.length - kept.length;
}

export function readPendingMedia(dir: string, entry: PendingEntry): Buffer | null {
  if (!entry.slot.media) return null;
  try {
    return fs.readFileSync(pendingMediaFile(dir, entry.slot.media));
  } catch {
    return null;
  }
}

// 界面看到的生成记录 = NAS 上的（或断线时本机那份）+ 还没传上去的。
export const mergePending = (history: CanvasHistory, entries: readonly PendingEntry[]) =>
  entries.reduce((merged, entry) => recordSlot(merged, entry.task, entry.slot, entry.at), history);

export function storeThumb(dir: string, sha256: string, buffer: Buffer) {
  fs.mkdirSync(path.join(dir, 'thumbs'), { recursive: true });
  fs.writeFileSync(thumbFile(dir, sha256), buffer);
}

const THUMB_PATH = /^canvas-history\/thumbs\/([0-9a-f]{64})\.jpg$/;
const MEDIA_PATH = /^canvas-history\/media\/([0-9a-f]{64})(\.[a-z0-9]{1,5})$/;

export const thumbShaOf = (relativePath: string) => relativePath.match(THUMB_PATH)?.[1] ?? null;

// nas-media://canvas-history/… 先看本机有没有：没传上 NAS 的原图、缓存过的缩略图。读缩略图时更新修改时间，清理时按它算最近用过。
export function localCanvasFile(dir: string, relativePath: string): string | null {
  const thumb = relativePath.match(THUMB_PATH);
  const media = relativePath.match(MEDIA_PATH);
  const file = thumb ? thumbFile(dir, thumb[1]) : media ? pendingMediaFile(dir, { sha256: media[1], ext: media[2] }) : null;
  if (!file || !fs.existsSync(file)) return null;
  if (thumb) {
    const now = new Date();
    fs.utimesSync(file, now, now);
  }
  return file;
}

// 断线时原图读不到，用缓存的缩略图代替（只有图片有缩略图）。
export function thumbInsteadOf(dir: string, relativePath: string): string | null {
  const media = relativePath.match(MEDIA_PATH);
  return media ? localCanvasFile(dir, `canvas-history/thumbs/${media[1]}.jpg`) : null;
}

const filesIn = (folder: string) => {
  try {
    return fs.readdirSync(folder).map((name) => {
      const file = path.join(folder, name);
      const stat = fs.statSync(file);
      return { name, file, size: stat.size, mtimeMs: stat.mtimeMs };
    });
  } catch {
    return [];
  }
};

export function pendingStats(dir: string, now = Date.now()) {
  const entries = listPending(dir);
  const bytes = filesIn(path.join(dir, 'pending')).reduce((sum, file) => sum + file.size, 0);
  const oldest = entries.reduce((min, entry) => Math.min(min, Date.parse(entry.at) || now), now);
  return { count: entries.length, bytes, overLimit: bytes > CACHE_MAX_BYTES || now - oldest > CACHE_MAX_AGE_MS };
}

// 清理缩略图缓存，返回删了几个。待上传的原图和它们的缩略图不删。
export function pruneCache(dir: string, now = Date.now()) {
  const keep = new Set(listPending(dir).flatMap((entry) => (entry.slot.media ? [entry.slot.media.sha256] : [])));
  const thumbs = filesIn(path.join(dir, 'thumbs')).sort((left, right) => left.mtimeMs - right.mtimeMs);
  let total = pendingStats(dir, now).bytes + thumbs.reduce((sum, file) => sum + file.size, 0);
  let removed = 0;
  for (const thumb of thumbs) {
    if (keep.has(thumb.name.replace(/\.jpg$/, ''))) continue;
    if (now - thumb.mtimeMs <= CACHE_MAX_AGE_MS && total <= CACHE_MAX_BYTES) continue;
    fs.rmSync(thumb.file, { force: true });
    total -= thumb.size;
    removed += 1;
  }
  return removed;
}
