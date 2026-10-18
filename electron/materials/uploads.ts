// 把一份媒体传到 NAS 并生成素材条目：原图按 sha256 存（已存在就不重传），图片顺带生成缩略图。
// 本机文件、剪贴板、分享链接、Word、分享包的导入都走这里，最后统一用 commitImport 加锁写进 library.json。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { nativeImage } from 'electron';
import { addItems, mediaPath, thumbPath, type MaterialItem, type MaterialMedia } from '../../src/materials/library.ts';
import { getMediaFileExtension, isImageMediaFile, isVideoMediaFile, mimeTypeOf } from '../../src/materials/mediaFileTypes.ts';
import { mutateLibrary, readLibrary } from './libraryStore.ts';
import { parsePromptDraftFromImageMetadata, type PromptImportDraft } from './suyan/promptImportParser.ts';
import type { Failure } from './tasks.ts';
import * as webdav from './webdav.ts';
import type { DavConfig } from './webdav.ts';

const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const THUMB_WIDTH = 480;

// 素材条目里来自提示词的那部分；本机导入时只有标题。
export type ItemText = Partial<Pick<MaterialItem, 'title' | 'prompt' | 'negativePrompt' | 'tags' | 'sourceUrl'>>;

export const textFromDraft = (draft: PromptImportDraft): ItemText => ({
  title: draft.title,
  prompt: draft.prompt,
  negativePrompt: draft.negativePrompt,
  tags: draft.tags,
  sourceUrl: draft.sourceUrl ?? '',
});

// ponytail: 缩略图一律存 JPEG，透明 PNG 的透明处会变黑；需要时改成按原格式保存缩略图。
export function makeThumbnail(image: Electron.NativeImage): Buffer | null {
  if (image.isEmpty()) return null;
  const { width } = image.getSize();
  return (width > THUMB_WIDTH ? image.resize({ width: THUMB_WIDTH, quality: 'good' }) : image).toJPEG(82);
}

function newItem(media: MaterialMedia, text: ItemText, category: string): MaterialItem {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: text.title?.trim() || media.name.slice(0, media.name.length - media.ext.length),
    prompt: text.prompt ?? '',
    negativePrompt: text.negativePrompt ?? '',
    category,
    tags: text.tags ?? [],
    favorite: false,
    sourceUrl: text.sourceUrl ?? '',
    media,
    createdAt: now,
    updatedAt: now,
  };
}

async function putThumbnail(config: DavConfig, sha256: string, image: Electron.NativeImage) {
  const thumb = makeThumbnail(image);
  if (!thumb) return { width: null, height: null, hasThumb: false };
  await webdav.put(config, thumbPath({ sha256 }), new Uint8Array(thumb), { 'Content-Type': 'image/jpeg' });
  return { ...image.getSize(), hasThumb: true };
}

// 内存里的一份媒体（剪贴板、下载、Word、分享包）。
export async function uploadBuffer(config: DavConfig, buffer: Buffer, name: string, text: ItemText, category: string): Promise<MaterialItem> {
  const ext = getMediaFileExtension(name);
  if (!isImageMediaFile(name) && !isVideoMediaFile(name)) throw new Error('不是图片或视频');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  if (!(await webdav.exists(config, mediaPath({ sha256, ext })))) {
    await webdav.put(config, mediaPath({ sha256, ext }), new Uint8Array(buffer), { 'Content-Type': mimeTypeOf(name) });
  }
  const kind = isVideoMediaFile(name) ? 'video' : 'image';
  const thumb = kind === 'image' ? await putThumbnail(config, sha256, nativeImage.createFromBuffer(buffer)) : { width: null, height: null, hasThumb: false };
  return newItem({ sha256, ext, kind, name, size: buffer.length, ...thumb }, text, category);
}

async function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

// 本机文件：流式上传，不整个读进内存。PNG 里如果带着 ComfyUI 等工具写入的提示词，一并读出来。
export async function uploadFile(config: DavConfig, filePath: string, category: string): Promise<MaterialItem> {
  const name = path.basename(filePath);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('不是文件');
  if (!isImageMediaFile(name) && !isVideoMediaFile(name)) throw new Error('不是图片或视频');
  if (stat.size > MAX_FILE_BYTES) throw new Error('超过 2GB');

  const sha256 = await hashFile(filePath);
  const ext = getMediaFileExtension(name);
  if (!(await webdav.exists(config, mediaPath({ sha256, ext })))) {
    const stream = Readable.toWeb(fs.createReadStream(filePath)) as unknown as webdav.DavBody;
    await webdav.put(config, mediaPath({ sha256, ext }), stream, { 'Content-Type': mimeTypeOf(name), 'Content-Length': String(stat.size) });
  }

  const kind = isVideoMediaFile(name) ? 'video' : 'image';
  const thumb = kind === 'image' ? await putThumbnail(config, sha256, nativeImage.createFromPath(filePath)) : { width: null, height: null, hasThumb: false };
  const text = ext === '.png' && stat.size < 64 * 1024 * 1024 ? textFromDraft(parsePromptDraftFromImageMetadata(fs.readFileSync(filePath))) : {};
  return newItem({ sha256, ext, kind, name, size: stat.size, ...thumb }, { ...text, title: text.title || undefined }, category);
}

export async function commitImport(config: DavConfig, items: MaterialItem[], errors: Failure[], extra: { skipped?: number } = {}) {
  if (items.length === 0) {
    return { ...(await readLibrary(config)), added: 0, skipped: extra.skipped ?? 0, errors };
  }
  const { library, dropped, result } = await mutateLibrary(config, (current) => {
    const outcome = addItems(current, items, new Date().toISOString());
    return { library: outcome.library, result: outcome };
  });
  return { library, dropped, added: result.added.length, skipped: result.skipped.length + (extra.skipped ?? 0), errors };
}
