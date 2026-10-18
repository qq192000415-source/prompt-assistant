// 素材库主进程入口：nas-media:// 媒体协议、导入、IPC。编译成 electron/materials.cjs，由 main.cjs 引用。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { clipboard, dialog, nativeImage, protocol, type BrowserWindow, type IpcMain } from 'electron';
import {
  addItems,
  deleteItems,
  mediaPath,
  patchItem,
  thumbPath,
  type MaterialItem,
  type MaterialMedia,
  type MaterialPatch,
} from '../../src/materials/library.ts';
import { getMediaFileExtension, isImageMediaFile, isVideoMediaFile, mimeTypeOf } from '../../src/materials/mediaFileTypes.ts';
import { compressImages, compressVideos, type ImageCompressOptions } from './batch.ts';
import { exportItems } from './export.ts';
import { cancelBatch, type BatchProgress } from './tasks.ts';
import { getPublicConfig, loadConfig, saveConfig } from './config.ts';
import { FFMPEG_COMPONENT, ffmpegPath, installFfmpeg, isFfmpegInstalled, type VideoCompressOptions } from './ffmpeg.ts';
import { mutateLibrary, readLibrary } from './libraryStore.ts';
import * as webdav from './webdav.ts';
import type { DavConfig } from './webdav.ts';

const SCHEME = 'nas-media';
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const THUMB_WIDTH = 480;
const MEDIA_PATH_PATTERN = /^(media\/[0-9a-f]{64}\.[a-z0-9]{1,5}|thumbs\/[0-9a-f]{64}\.jpg)$/;

type ImportError = { name: string; message: string };

// 必须在 app ready 之前调用。
export function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

// 渲染进程用 nas-media://media/<sha>.<ext> 显示图片和视频：主进程带上账户去 NAS 取，
// 透传 Range 让视频能拖进度条，并要求不缓存，素材不落在本机磁盘上。
function handleMediaRequest(userDataDir: string) {
  return async (request: Request) => {
    const url = new URL(request.url);
    const relativePath = `${url.hostname}${decodeURIComponent(url.pathname)}`;
    if (!MEDIA_PATH_PATTERN.test(relativePath)) {
      return new Response('not found', { status: 404 });
    }
    try {
      const config = loadConfig(userDataDir);
      const range = request.headers.get('range');
      const upstream = await webdav.dav(config, 'GET', relativePath, {
        headers: range ? { Range: range } : {},
        allow: [404, 416],
      });
      const headers = new Headers({ 'Content-Type': mimeTypeOf(relativePath), 'Cache-Control': 'no-store' });
      for (const name of ['content-length', 'content-range', 'accept-ranges']) {
        const value = upstream.headers.get(name);
        if (value) headers.set(name, value);
      }
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch (error) {
      return new Response(error instanceof Error ? error.message : String(error), { status: 502 });
    }
  };
}

async function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

// ponytail: 缩略图一律存 JPEG，透明 PNG 的透明处会变黑；需要时改成按原格式保存缩略图。
function makeThumbnail(image: Electron.NativeImage): Buffer | null {
  if (image.isEmpty()) return null;
  const { width } = image.getSize();
  return (width > THUMB_WIDTH ? image.resize({ width: THUMB_WIDTH, quality: 'good' }) : image).toJPEG(82);
}

function newItem(media: MaterialMedia, title: string, category: string, now: string): MaterialItem {
  return {
    id: crypto.randomUUID(),
    title,
    prompt: '',
    negativePrompt: '',
    category,
    tags: [],
    favorite: false,
    media,
    createdAt: now,
    updatedAt: now,
  };
}

// 原图和缩略图先传到 NAS（同一文件已存在就跳过），再加锁把记录写进 library.json。
async function uploadFile(config: DavConfig, filePath: string, category: string): Promise<MaterialItem> {
  const name = path.basename(filePath);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('不是文件');
  if (!isImageMediaFile(name) && !isVideoMediaFile(name)) throw new Error('不是图片或视频');
  if (stat.size > MAX_FILE_BYTES) throw new Error('超过 2GB');

  const sha256 = await hashFile(filePath);
  const ext = getMediaFileExtension(name);
  const kind = isVideoMediaFile(name) ? 'video' : 'image';
  const target = mediaPath({ sha256, ext });
  if (!(await webdav.exists(config, target))) {
    const stream = Readable.toWeb(fs.createReadStream(filePath)) as unknown as webdav.DavBody;
    await webdav.put(config, target, stream, { 'Content-Type': mimeTypeOf(name), 'Content-Length': String(stat.size) });
  }

  let width: number | null = null;
  let height: number | null = null;
  let hasThumb = false;
  if (kind === 'image') {
    const image = nativeImage.createFromPath(filePath);
    const thumb = makeThumbnail(image);
    if (thumb) {
      ({ width, height } = image.getSize());
      await webdav.put(config, thumbPath({ sha256 }), new Uint8Array(thumb), { 'Content-Type': 'image/jpeg' });
      hasThumb = true;
    }
  }

  const media: MaterialMedia = { sha256, ext, kind, name, size: stat.size, width, height, hasThumb };
  return newItem(media, name.slice(0, name.length - ext.length), category, new Date().toISOString());
}

async function uploadPng(config: DavConfig, image: Electron.NativeImage, category: string): Promise<MaterialItem> {
  const png = image.toPNG();
  const sha256 = crypto.createHash('sha256').update(png).digest('hex');
  const ext = '.png';
  if (!(await webdav.exists(config, mediaPath({ sha256, ext })))) {
    await webdav.put(config, mediaPath({ sha256, ext }), new Uint8Array(png), { 'Content-Type': 'image/png' });
  }
  const thumb = makeThumbnail(image);
  if (thumb) await webdav.put(config, thumbPath({ sha256 }), new Uint8Array(thumb), { 'Content-Type': 'image/jpeg' });
  const { width, height } = image.getSize();
  const now = new Date().toISOString();
  const media: MaterialMedia = { sha256, ext, kind: 'image', name: `粘贴的图片${ext}`, size: png.length, width, height, hasThumb: Boolean(thumb) };
  return newItem(media, '粘贴的图片', category, now);
}

async function commitImport(config: DavConfig, items: MaterialItem[], errors: ImportError[]) {
  if (items.length === 0) {
    return { ...(await readLibrary(config)), added: 0, skipped: 0, errors };
  }
  const { library, dropped, result } = await mutateLibrary(config, (current) => {
    const outcome = addItems(current, items, new Date().toISOString());
    return { library: outcome.library, result: outcome };
  });
  return { library, dropped, added: result.added.length, skipped: result.skipped.length, errors };
}

async function importPaths(userDataDir: string, filePaths: string[], category: string) {
  const config = loadConfig(userDataDir);
  const items: MaterialItem[] = [];
  const errors: ImportError[] = [];
  for (const filePath of filePaths) {
    try {
      items.push(await uploadFile(config, filePath, category));
    } catch (error) {
      errors.push({ name: path.basename(filePath), message: error instanceof Error ? error.message : String(error) });
    }
  }
  return commitImport(config, items, errors);
}

const asStringArray = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);
const asCategory = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

type RegisterOptions = {
  ipcMain: IpcMain;
  userDataDir: string;
  // 更新源地址，FFmpeg 组件从它的 components/ 目录下载；没配置时为空串。
  updateBaseUrl: string;
  getWindow: () => BrowserWindow | null;
};

export function register({ ipcMain, userDataDir, updateBaseUrl, getWindow }: RegisterOptions) {
  protocol.handle(SCHEME, handleMediaRequest(userDataDir));

  ipcMain.handle('materials:get-config', () => getPublicConfig(userDataDir));
  ipcMain.handle('materials:save-config', (_event, input) =>
    saveConfig(userDataDir, {
      baseUrl: String(input?.baseUrl ?? ''),
      username: String(input?.username ?? ''),
      password: typeof input?.password === 'string' ? input.password : undefined,
    }),
  );
  ipcMain.handle('materials:load', () => readLibrary(loadConfig(userDataDir)));

  ipcMain.handle('materials:pick-and-import', async (_event, category) => {
    const window = getWindow();
    const options: Electron.OpenDialogOptions = {
      title: '导入素材',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片和视频', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'jfif', 'mp4', 'webm', 'mov', 'm4v', 'mkv'] }],
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (result.canceled) return null;
    return importPaths(userDataDir, result.filePaths, asCategory(category));
  });
  ipcMain.handle('materials:import-paths', (_event, filePaths, category) =>
    importPaths(userDataDir, asStringArray(filePaths), asCategory(category)),
  );
  ipcMain.handle('materials:import-clipboard', async (_event, category) => {
    const image = clipboard.readImage();
    if (image.isEmpty()) throw new Error('剪贴板里没有图片');
    const config = loadConfig(userDataDir);
    return commitImport(config, [await uploadPng(config, image, asCategory(category))], []);
  });

  ipcMain.handle('materials:update', async (_event, itemId, patch: MaterialPatch) => {
    const config = loadConfig(userDataDir);
    const { library, dropped } = await mutateLibrary(config, (current) => ({
      library: patchItem(current, String(itemId), patch ?? {}, new Date().toISOString()),
      result: null,
    }));
    return { library, dropped };
  });

  ipcMain.handle('materials:delete', async (_event, ids) => {
    const config = loadConfig(userDataDir);
    const { library, dropped, result: orphaned } = await mutateLibrary(config, (current) => {
      const outcome = deleteItems(current, asStringArray(ids), new Date().toISOString());
      return { library: outcome.library, result: outcome.orphaned };
    });
    // 记录已经删掉；文件删不掉只多占空间，告诉用户但不算失败。
    const warnings: string[] = [];
    for (const media of orphaned) {
      for (const target of [mediaPath(media), ...(media.hasThumb ? [thumbPath(media)] : [])]) {
        await webdav.remove(config, target).catch((error) => warnings.push(`${target}：${error instanceof Error ? error.message : error}`));
      }
    }
    return { library, dropped, warnings };
  });

  ipcMain.handle('materials:copy-image', async (_event, media: Pick<MaterialMedia, 'sha256' | 'ext'>) => {
    const target = mediaPath(media);
    if (!MEDIA_PATH_PATTERN.test(target)) throw new Error('图片标识无效');
    const image = nativeImage.createFromBuffer(await webdav.readBytes(loadConfig(userDataDir), target));
    if (image.isEmpty()) throw new Error('这种图片格式不能放进剪贴板');
    clipboard.writeImage(image);
  });

  // 批量任务的进度推给发起请求的窗口。
  const progressTo = (event: Electron.IpcMainInvokeEvent) => (progress: BatchProgress) => {
    if (!event.sender.isDestroyed()) event.sender.send('materials:progress', progress);
  };

  ipcMain.handle('materials:ffmpeg-status', () => ({ installed: isFfmpegInstalled(userDataDir), downloadBytes: FFMPEG_COMPONENT.size }));
  ipcMain.handle('materials:install-ffmpeg', async (event) => {
    const report = progressTo(event);
    await installFfmpeg(userDataDir, updateBaseUrl, (done, total) => report({ task: '下载 FFmpeg', done, total, current: '' }));
  });
  ipcMain.handle('materials:compress-images', (event, ids, options: ImageCompressOptions) =>
    compressImages(loadConfig(userDataDir), asStringArray(ids), options, progressTo(event)),
  );
  ipcMain.handle('materials:compress-videos', (event, ids, options: VideoCompressOptions) => {
    if (!isFfmpegInstalled(userDataDir)) throw new Error('还没有下载 FFmpeg');
    return compressVideos(loadConfig(userDataDir), asStringArray(ids), options, ffmpegPath(userDataDir), progressTo(event));
  });
  ipcMain.handle('materials:export', async (event, ids, defaultDir) => {
    const window = getWindow();
    const options: Electron.OpenDialogOptions = {
      title: '导出到文件夹',
      properties: ['openDirectory', 'createDirectory'],
      ...(typeof defaultDir === 'string' && defaultDir ? { defaultPath: defaultDir } : {}),
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    return exportItems(loadConfig(userDataDir), asStringArray(ids), result.filePaths[0], progressTo(event));
  });
  ipcMain.handle('materials:cancel-batch', () => cancelBatch());
}
