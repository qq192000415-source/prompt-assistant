// 从剪贴板导入：分享链接、带提示词的图片、纯提示词文字。流程移植自 SuYan（MIT，guliacer）
// electron/main/clipboard/readClipboardImage.ts：先认已知站点的分享链接，再看剪贴板图片，最后把文字当提示词。
// 改动：下载的效果图传到 NAS（uploadBuffer）而不是写本机；去掉了 SuYan 的「只存链接」模式和账号署名；
// 下载走抓取专用会话（linkSession），代理只作用在这里。
import { clipboard } from 'electron';
import { mimeTypeOf, getMediaFileExtension, isImageMediaFile, isVideoMediaFile } from '../../src/materials/mediaFileTypes.ts';
import type { MaterialItem } from '../../src/materials/library.ts';
import { net } from './linkSession.ts';
import { readLibrary } from './libraryStore.ts';
import { buildImportedPromptPlaceholderSeed, createImportedPromptPlaceholderImage } from './suyan/placeholderImage.ts';
import {
  createEmptyPromptImportDraft,
  createPromptImportDuplicateKey,
  getImportableRemoteMediaUrls,
  mergePromptImportDrafts,
  parsePromptDraftFromImageMetadata,
  type PromptImportDraft,
} from './suyan/promptImportParser.ts';
import {
  assertImportNotTimedOut,
  createImportAbortTimeout,
  createImportDeadline,
  resolveKnownShareDraftsFromText,
  resolvePromptDraftFromText,
  rethrowIfImportTimedOut,
  type ImportDeadline,
} from './suyan/shareSourceFetchers.ts';
import { commitImport, textFromDraft, uploadBuffer } from './uploads.ts';
import type { Failure } from './tasks.ts';
import type { DavConfig } from './webdav.ts';

const PROMPT_IMPORT_TOTAL_TIMEOUT_MS = 90_000;
const MAX_REMOTE_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_REMOTE_VIDEO_BYTES = 80 * 1024 * 1024;

const extensionByMime = new Map<string, string>();
for (const ext of ['.png', '.jpg', '.webp', '.gif', '.bmp', '.avif', '.heic', '.heif', '.tiff', '.svg', '.ico', '.mp4', '.webm', '.mov', '.mkv']) {
  extensionByMime.set(mimeTypeOf(ext), ext);
}

// 先看服务器给的类型，再看链接路径里的扩展名；都不是图片或视频就放弃。
function remoteMediaExtension(sourceUrl: string, contentType: string): string | null {
  const fromMime = extensionByMime.get(contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '');
  if (fromMime) return fromMime;
  try {
    const ext = getMediaFileExtension(new URL(sourceUrl).pathname);
    if (ext === '.jpeg' || ext === '.jpe' || ext === '.jfif') return '.jpg';
    return isImageMediaFile(ext) || isVideoMediaFile(ext) ? ext : null;
  } catch {
    return null;
  }
}

function getImageReferer(sourceUrl: string): string {
  try {
    const hostname = new URL(sourceUrl).hostname.toLowerCase();
    if (hostname.includes('aiart.pics')) return 'https://aiart.pics/';
    if (hostname.includes('twimg.com') || hostname.includes('twitter.com') || hostname.includes('x.com')) return 'https://x.com/';
    if (hostname.includes('webtomind.com') || hostname.includes('supabase.co')) return 'https://webtomind.com/';
    if (hostname.includes('xmiaom.com')) return 'https://img.xmiaom.com/';
    if (hostname.includes('bmp.ovh') || hostname.includes('wjwj.top')) return 'https://aipromptfill.com/';
    // vlabvod.com 是即梦的视频地址，SuYan 原规则里没有，会退到默认 Referer 被拒（403）。
    if (hostname.includes('byteimg.com') || hostname.includes('jimeng.jianying.com') || hostname.includes('vlabvod.com')) {
      return 'https://jimeng.jianying.com/';
    }
  } catch {
    // 链接不合法时用默认 Referer。
  }
  return 'https://aipromptfill.com/';
}

// 不同图床对防盗链要求不同，按顺序换几组请求头重试。
function getRemoteImageHeaderVariants(sourceUrl: string): Array<Record<string, string>> {
  let pathExtension = '';
  try {
    pathExtension = getMediaFileExtension(new URL(sourceUrl).pathname);
  } catch {
    // 同上。
  }
  const isVideoUrl = isVideoMediaFile(pathExtension) || /[/?&=]video/i.test(sourceUrl);
  const accept = isVideoUrl
    ? 'video/mp4,video/webm,video/quicktime,video/x-matroska,video/*;q=0.9,*/*;q=0.5'
    : 'image/avif,image/webp,image/apng,image/heic,image/heif,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5';
  const referer = getImageReferer(sourceUrl);
  const browserUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  return [
    { accept, 'user-agent': browserUserAgent, 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8', referer },
    {
      accept,
      'user-agent': browserUserAgent,
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'cache-control': 'no-cache',
      pragma: 'no-cache',
      referer,
      origin: new URL(referer).origin,
    },
    { accept, 'user-agent': 'Suyan/0.1.0', referer },
  ];
}

async function fetchRemoteMedia(sourceUrl: string, deadline: ImportDeadline): Promise<{ buffer: Buffer; extension: string } | null> {
  for (const headers of getRemoteImageHeaderVariants(sourceUrl)) {
    const controller = new AbortController();
    const timeout = createImportAbortTimeout(controller, deadline, 45_000);
    try {
      const response = await net.fetch(sourceUrl, { headers, signal: controller.signal });
      if (!response.ok) continue;
      const extension = remoteMediaExtension(sourceUrl, response.headers.get('content-type')?.toLowerCase() ?? '');
      if (!extension) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      const maxSize = isVideoMediaFile(extension) ? MAX_REMOTE_VIDEO_BYTES : MAX_REMOTE_IMAGE_BYTES;
      if (buffer.length === 0 || buffer.length > maxSize) continue;
      return { buffer, extension };
    } catch {
      rethrowIfImportTimedOut(deadline);
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

const draftImageUrls = (draft: PromptImportDraft) => getImportableRemoteMediaUrls([...(draft.sourceImageUrls ?? []), draft.sourceImageUrl ?? '']);

// 文件名只用来带扩展名和在详情里显示，取链接最后一段，没有就用标题。
function remoteFileName(sourceUrl: string, draft: PromptImportDraft, extension: string) {
  let base = '';
  try {
    base = decodeURIComponent(new URL(sourceUrl).pathname.split('/').pop() ?? '');
  } catch {
    // 同上。
  }
  base = base.slice(0, base.length - getMediaFileExtension(base).length).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 60);
  return `${base || draft.title.slice(0, 40) || '分享素材'}${extension}`;
}

// 一个提示词的所有效果图：逐张下载，同一张图（内容相同）只收一次；一张都没有时生成占位图，提示词仍能入库。
async function itemsFromDraft(config: DavConfig, draft: PromptImportDraft, category: string, deadline: ImportDeadline, failures: Failure[]) {
  const items: MaterialItem[] = [];
  const urls = draftImageUrls(draft);
  for (const url of urls) {
    assertImportNotTimedOut(deadline);
    const media = await fetchRemoteMedia(url, deadline);
    if (!media) {
      failures.push({ name: url, message: '效果图下载失败' });
      continue;
    }
    const item = await uploadBuffer(config, media.buffer, remoteFileName(url, draft, media.extension), textFromDraft(draft), category);
    if (!items.some((existing) => existing.media.sha256 === item.media.sha256)) items.push(item);
  }
  if (items.length === 0 && draft.prompt.trim()) {
    const placeholder = createImportedPromptPlaceholderImage(buildImportedPromptPlaceholderSeed(draft.title, draft.prompt));
    items.push(await uploadBuffer(config, placeholder, `${draft.title.slice(0, 40) || '提示词'}.png`, textFromDraft(draft), category));
  }
  return items;
}

const normalizeSourceUrl = (input: string | null | undefined) => (typeof input === 'string' ? input.trim().toLowerCase() : '');

// 剪贴板里优先取原始 PNG 字节：里面可能带着 ComfyUI 等工具写入的提示词，nativeImage 转一次就丢了。
function readClipboardEncodedPng(): Buffer | null {
  const format = clipboard.availableFormats().find((entry) => entry.toLowerCase().includes('png'));
  if (!format) return null;
  const buffer = clipboard.readBuffer(format);
  return buffer.length > 0 ? buffer : null;
}

export async function importFromClipboard(config: DavConfig, category: string) {
  const image = clipboard.readImage();
  const text = clipboard.readText().trim();
  if (image.isEmpty() && !text) throw new Error('剪贴板里没有图片、文字或分享链接');

  const deadline = createImportDeadline(PROMPT_IMPORT_TOTAL_TIMEOUT_MS);
  const failures: Failure[] = [];
  const knownShareDrafts = text ? await resolveKnownShareDraftsFromText(text, deadline) : null;

  if (knownShareDrafts) {
    // 已经在库里的（提示词相同或来源链接相同）跳过，同一批里重复的也只收一次。
    const { library } = await readLibrary(config);
    const promptKeys = new Set(library.items.map((item) => createPromptImportDuplicateKey(item.prompt)).filter(Boolean));
    const sourceUrls = new Set(library.items.map((item) => normalizeSourceUrl(item.sourceUrl)).filter(Boolean));
    let duplicates = 0;
    const items: MaterialItem[] = [];
    for (const draft of knownShareDrafts) {
      const promptKey = createPromptImportDuplicateKey(draft.prompt);
      const sourceUrl = normalizeSourceUrl(draft.sourceUrl);
      if ((promptKey && promptKeys.has(promptKey)) || (sourceUrl && sourceUrls.has(sourceUrl))) {
        duplicates += 1;
        continue;
      }
      if (promptKey) promptKeys.add(promptKey);
      if (sourceUrl) sourceUrls.add(sourceUrl);
      items.push(...(await itemsFromDraft(config, draft, category, deadline, failures)));
    }
    if (items.length === 0 && duplicates === 0) {
      throw new Error(failures.length ? '已识别分享链接，但效果图下载失败，检查网络或代理设置后重试' : '分享链接已识别，但没能取到提示词，请重试');
    }
    return commitImport(config, items, failures, { skipped: duplicates });
  }

  if (!image.isEmpty()) {
    const encoded = readClipboardEncodedPng();
    const png = encoded ?? image.toPNG();
    const draft = mergePromptImportDrafts(
      encoded ? parsePromptDraftFromImageMetadata(encoded) : createEmptyPromptImportDraft(),
      text ? await resolvePromptDraftFromText(text, deadline) : createEmptyPromptImportDraft(),
    );
    const item = await uploadBuffer(config, png, '粘贴的图片.png', { ...textFromDraft(draft), title: draft.title || '粘贴的图片' }, category);
    return commitImport(config, [item], failures);
  }

  const draft = await resolvePromptDraftFromText(text, deadline);
  const items = await itemsFromDraft(config, draft, category, deadline, failures);
  if (items.length === 0) throw new Error('剪贴板里的文字不是提示词或可识别的分享链接');
  return commitImport(config, items, failures);
}
