// 创作画布在主进程里的接线：任务队列、把生成的图存进 NAS 的生成历史、从历史存入素材库或另存为、参考图。
// 队列在主进程，切到别的库、页面刷新都不中断；关掉软件时还在排队的任务会丢（已生成的都在历史里）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import { clipboard, dialog, nativeImage, type BrowserWindow, type IpcMain } from 'electron';
import { mediaPath, thumbPath, type MaterialItem, type MaterialLibrary } from '../../src/materials/library.ts';
import { mimeTypeOf } from '../../src/materials/mediaFileTypes.ts';
import { loadAiRuntime, loadCanvasOptions } from './aiSettings.ts';
import { CANVAS_CATEGORY, decodeGeneratedMedia, generateMedia, savedItemText, type CanvasOrigin } from './canvas.ts';
import {
  HISTORY_DIR,
  deleteHistoryTasks,
  findSlot,
  historyMediaPath,
  historyThumbPath,
  markSavedToLibrary,
  mutateHistory,
  readHistory,
  recordSlot,
  type HistoryMedia,
} from './canvasHistory.ts';
import { createCanvasQueue, type QueueSlot, type QueueTask } from './canvasQueue.ts';
import { loadConfig } from './config.ts';
import type { AiImageGenerationPayload } from './suyan/aiTypes.ts';
import { commitImport, makeThumbnail, uploadBuffer } from './uploads.ts';
import * as webdav from './webdav.ts';
import type { DavConfig } from './webdav.ts';

type Options = {
  ipcMain: IpcMain;
  userDataDir: string;
  getWindow: () => BrowserWindow | null;
  findItem: (itemId: unknown) => Promise<{ config: DavConfig; library: MaterialLibrary; item: MaterialItem }>;
};

const taskRecord = (task: QueueTask) => ({
  id: task.id,
  createdAt: task.createdAt,
  model: task.model,
  prompt: task.prompt,
  negativePrompt: task.negativePrompt,
  params: task.params,
  origin: task.origin,
  referenceCount: task.referenceCount,
  total: task.total,
});

const stamp = () => new Date().toLocaleString('sv-SE').replace(/[: ]/g, '-');

// 按 sha256 存（同一张图只存一份），图片顺带存缩略图，和素材库的 uploadBuffer 一个思路。
async function putHistoryMedia(config: DavConfig, buffer: Buffer, ext: string): Promise<HistoryMedia> {
  await webdav.ensureFolder(config, HISTORY_DIR);
  await webdav.ensureFolder(config, `${HISTORY_DIR}media/`);
  await webdav.ensureFolder(config, `${HISTORY_DIR}thumbs/`);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const kind = ext === '.mp4' ? 'video' : 'image';
  const media: HistoryMedia = { sha256, ext, kind, size: buffer.length, width: null, height: null, hasThumb: false };
  if (!(await webdav.exists(config, historyMediaPath(media)))) {
    await webdav.put(config, historyMediaPath(media), new Uint8Array(buffer), { 'Content-Type': mimeTypeOf(`x${ext}`) });
  }
  if (kind === 'image') {
    const image = nativeImage.createFromBuffer(buffer);
    const thumb = makeThumbnail(image);
    if (thumb) {
      await webdav.put(config, historyThumbPath(media), new Uint8Array(thumb), { 'Content-Type': 'image/jpeg' });
      Object.assign(media, image.getSize(), { hasThumb: true });
    }
  }
  return media;
}

export function registerCanvas({ ipcMain, userDataDir, getWindow, findItem }: Options) {
  // 状态变化很密（每个槽位开始、结束、重试都会变），合并成每 150 毫秒最多推一次给界面。
  let pending: NodeJS.Timeout | null = null;
  const broadcast = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      const window = getWindow();
      if (window && !window.isDestroyed()) window.webContents.send('materials:canvas-queue', queue.snapshot());
    }, 150);
  };

  const queue = createCanvasQueue({
    generate: async (payload) => {
      const generated = await generateMedia(loadAiRuntime(userDataDir), payload);
      const [image] = generated.images;
      if (!image) throw new Error('模型没有返回图片');
      return { dataUrl: image.dataUrl, revisedPrompt: image.revisedPrompt ?? null, mediaType: image.mediaType ?? generated.mediaType ?? 'image', model: generated.model };
    },
    persist: async (task, slot, generated) => {
      const config = loadConfig(userDataDir);
      const { buffer, ext } = decodeGeneratedMedia(generated.dataUrl);
      const media = await putHistoryMedia(config, buffer, ext);
      await mutateHistory(config, (history) => ({
        history: recordSlot(history, taskRecord(task), { index: slot.index, status: 'done', media, revisedPrompt: generated.revisedPrompt, error: '', attempts: slot.attempts, savedToLibrary: false }, new Date().toISOString()),
        result: null,
      }));
      return media;
    },
    recordFailure: async (task, slot) => {
      await mutateHistory(loadConfig(userDataDir), (history) => ({
        history: recordSlot(history, taskRecord(task), { index: slot.index, status: 'failed', media: null, revisedPrompt: null, error: slot.error, attempts: slot.attempts, savedToLibrary: false }, new Date().toISOString()),
        result: null,
      }));
    },
    limits: () => loadCanvasOptions(userDataDir),
    onChange: broadcast,
  });

  // 内存里还有的图（存进历史失败的）优先用；否则从 NAS 的生成历史取。
  const memorySlot = (taskId: string, index: number): { task: QueueTask; slot: QueueSlot } | null => {
    const task = queue.snapshot().find((entry) => entry.id === taskId);
    const slot = task?.slots.find((entry) => entry.index === index);
    return task && slot?.dataUrl ? { task, slot } : null;
  };

  async function resultBytes(taskId: string, index: number) {
    const inMemory = memorySlot(taskId, index);
    if (inMemory) {
      const { buffer, ext } = decodeGeneratedMedia(inMemory.slot.dataUrl!);
      return { buffer, ext, task: inMemory.task, fromHistory: false };
    }
    const config = loadConfig(userDataDir);
    const { history } = await readHistory(config);
    const { task, media } = findSlot(history, taskId, index);
    return { buffer: await webdav.readBytes(config, historyMediaPath(media)), ext: media.ext, task, fromHistory: true };
  }

  ipcMain.handle('materials:canvas-submit', (_event, input: { payload?: AiImageGenerationPayload; count?: unknown; origin?: CanvasOrigin | null }) => {
    const runtime = loadAiRuntime(userDataDir);
    if (!runtime.image) throw new Error('还没有设置生图模型，请在素材库设置的 AI 助手里填写');
    const payload = input?.payload;
    if (!payload?.prompt?.trim()) throw new Error('先写正向提示词');
    // 任务信息由主进程按实际提交的参数记录，不信界面另传的。
    return queue.submit(
      {
        model: runtime.image.model,
        prompt: payload.prompt,
        negativePrompt: payload.negativePrompt ?? '',
        params: {
          size: String(payload.size ?? 'auto'),
          ratio: String(payload.ratio ?? ''),
          quality: String(payload.quality ?? 'auto'),
          outputFormat: String(payload.outputFormat ?? 'png'),
          background: String(payload.background ?? 'auto'),
          mediaType: payload.mediaType === 'video' ? 'video' : 'image',
        },
        origin: input.origin ?? null,
        referenceCount: payload.referenceImageDataUrls?.length ?? 0,
      },
      payload,
      Number(input.count ?? payload.n ?? 1),
    );
  });
  ipcMain.handle('materials:canvas-queue', () => queue.snapshot());
  ipcMain.handle('materials:canvas-cancel', (_event, taskId) => queue.cancel(String(taskId)));
  ipcMain.handle('materials:canvas-retry', (_event, taskId, index) => queue.retry(String(taskId), Number(index)));
  ipcMain.handle('materials:canvas-dismiss', (_event, taskId) => queue.dismiss(String(taskId)));

  ipcMain.handle('materials:canvas-history', () => readHistory(loadConfig(userDataDir)));
  ipcMain.handle('materials:canvas-history-delete', async (_event, ids) => {
    const config = loadConfig(userDataDir);
    const wanted = Array.isArray(ids) ? ids.map(String) : [];
    const { history, dropped, result: orphaned } = await mutateHistory(config, (current) => {
      const outcome = deleteHistoryTasks(current, wanted, new Date().toISOString());
      return { history: outcome.history, result: outcome.orphaned };
    });
    // 记录已经删掉；文件删不掉只多占空间，告诉用户但不算失败。
    const warnings: string[] = [];
    for (const media of orphaned) {
      for (const target of [historyMediaPath(media), ...(media.hasThumb ? [historyThumbPath(media)] : [])]) {
        await webdav.remove(config, target).catch((error) => warnings.push(`${target}：${error instanceof Error ? error.message : error}`));
      }
    }
    for (const id of wanted) {
      try {
        queue.dismiss(id);
      } catch {
        // 还在进行的任务不从队列里拿掉，界面上照常显示。
      }
    }
    return { history, dropped, warnings };
  });

  // 存入素材库：提示词没改的「发到画布」任务归进来源组，否则归到「画布生成」。
  ipcMain.handle('materials:canvas-save', async (_event, taskId, index) => {
    const config = loadConfig(userDataDir);
    const { buffer, ext, task, fromHistory } = await resultBytes(String(taskId), Number(index));
    const { text, category } = savedItemText({ prompt: task.prompt, negativePrompt: task.negativePrompt, origin: task.origin });
    const item = await uploadBuffer(config, buffer, `画布-${stamp()}${ext}`, text, category || CANVAS_CATEGORY);
    const imported = await commitImport(config, [item], []);
    if (fromHistory) {
      await mutateHistory(config, (history) => ({ history: markSavedToLibrary(history, String(taskId), Number(index), new Date().toISOString()), result: null })).catch(
        (error) => console.warn('「已存入素材库」标记没写进生成历史', error),
      );
    }
    return imported;
  });
  ipcMain.handle('materials:canvas-save-as', async (_event, taskId, index) => {
    const { buffer, ext } = await resultBytes(String(taskId), Number(index));
    const window = getWindow();
    const options: Electron.SaveDialogOptions = {
      title: '另存为',
      defaultPath: `画布-${stamp()}${ext}`,
      filters: [{ name: ext === '.mp4' ? '视频' : '图片', extensions: [ext.slice(1)] }],
    };
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, buffer);
    return result.filePath;
  });

  // 参考图：素材库里的图（视频用封面），或剪贴板里的图，都转成 data URL 交给画布。
  ipcMain.handle('materials:canvas-reference', async (_event, itemId) => {
    const { config, item } = await findItem(itemId);
    const source = item.media.kind === 'image' ? mediaPath(item.media) : item.media.hasThumb ? thumbPath(item.media) : '';
    if (!source) throw new Error('这个视频还没有封面，不能当参考图');
    const bytes = await webdav.readBytes(config, source);
    return { dataUrl: `data:${mimeTypeOf(source)};base64,${Buffer.from(bytes).toString('base64')}`, title: item.title || item.media.name };
  });
  ipcMain.handle('materials:canvas-clipboard-image', () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) throw new Error('剪贴板里没有图片');
    return image.toDataURL();
  });
}
