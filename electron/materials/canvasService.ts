// 创作画布在主进程里的接线：任务队列、把生成的图存进 NAS 的生成历史、从历史存入素材库或另存为、参考图。
// 队列在主进程，切到别的库、页面刷新都不中断；关掉软件时还在排队的任务会丢（已生成的都在历史里）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import { clipboard, dialog, nativeImage, type BrowserWindow, type IpcMain } from 'electron';
import { mediaPath, thumbPath, type MaterialItem, type MaterialLibrary } from '../../src/materials/library.ts';
import { mimeTypeOf } from '../../src/materials/mediaFileTypes.ts';
import { loadAiRuntime, loadCanvasOptions } from './aiSettings.ts';
import { CANVAS_CATEGORY, decodeGeneratedMedia, generateMedia, savedItemText, sizeMismatchWarning, type CanvasOrigin } from './canvas.ts';
import {
  addPending,
  cacheDir,
  listPending,
  mergePending,
  pendingStats,
  pruneCache,
  readHistoryCopy,
  readPendingMedia,
  removePending,
  saveHistoryCopy,
  type PendingEntry,
} from './canvasCache.ts';
import {
  HISTORY_DIR,
  deleteHistoryTasks,
  findSlot,
  historyMediaPath,
  historyThumbPath,
  markSavedToLibrary,
  mutateHistory,
  normalizeHistory,
  readHistory,
  recordSlot,
  type HistoryMedia,
} from './canvasHistory.ts';
import { deleteTemplate, markTemplateUsed, mutateTemplates, readTemplates, saveTemplate, type TemplateInput } from './canvasTemplates.ts';
import { createCanvasQueue, type QueueSlot, type QueueTask } from './canvasQueue.ts';
import { getAccount, loadConfig } from './config.ts';
import type { AiImageGenerationPayload } from './suyan/aiTypes.ts';
import { commitImport, makeThumbnail, uploadBuffer } from './uploads.ts';
import * as webdav from './webdav.ts';
import type { DavConfig } from './webdav.ts';

type Options = {
  ipcMain: IpcMain;
  userDataDir: string;
  getWindow: () => BrowserWindow | null;
  findItem: (itemId: unknown) => Promise<{ config: DavConfig; library: MaterialLibrary; item: MaterialItem }>;
  // 本机待上传的记录变了（新存了、补传了），NAS 状态里带着待上传数，要重新推给界面。
  onPendingChange: () => void;
};

const taskRecord = (task: QueueTask, references: HistoryMedia[]) => ({
  id: task.id,
  createdAt: task.createdAt,
  model: task.model,
  prompt: task.prompt,
  negativePrompt: task.negativePrompt,
  params: task.params,
  origin: task.origin,
  referenceCount: task.referenceCount,
  references,
  total: task.total,
});

const stamp = () => new Date().toLocaleString('sv-SE').replace(/[: ]/g, '-');

// 生成的图的记录信息和缩略图（只有图片有）。存 NAS 和存本机待上传都用它。
function describeMedia(buffer: Buffer, ext: string) {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const kind = ext === '.mp4' ? 'video' : 'image';
  const media: HistoryMedia = { sha256, ext, kind, size: buffer.length, width: null, height: null, hasThumb: false };
  if (kind !== 'image') return { media, thumb: null };
  const image = nativeImage.createFromBuffer(buffer);
  const thumb = makeThumbnail(image);
  if (thumb) Object.assign(media, image.getSize(), { hasThumb: true });
  return { media, thumb };
}

// 按 sha256 存（同一张图只存一份），图片顺带存缩略图，和素材库的 uploadBuffer 一个思路。
async function putHistoryMedia(config: DavConfig, buffer: Buffer, ext: string): Promise<HistoryMedia> {
  await webdav.ensureFolder(config, HISTORY_DIR);
  await webdav.ensureFolder(config, `${HISTORY_DIR}media/`);
  await webdav.ensureFolder(config, `${HISTORY_DIR}thumbs/`);
  const { media, thumb } = describeMedia(buffer, ext);
  if (!(await webdav.exists(config, historyMediaPath(media)))) {
    await webdav.put(config, historyMediaPath(media), new Uint8Array(buffer), { 'Content-Type': mimeTypeOf(`x${ext}`) });
  }
  if (thumb) await webdav.put(config, historyThumbPath(media), new Uint8Array(thumb), { 'Content-Type': 'image/jpeg' });
  return media;
}

export function registerCanvas({ ipcMain, userDataDir, getWindow, findItem, onPendingChange }: Options) {
  // 状态变化很密（每个槽位开始、结束、重试都会变），合并成每 150 毫秒最多推一次给界面。
  let pending: NodeJS.Timeout | null = null;
  const broadcast = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      const window = getWindow();
      if (window && !window.isDestroyed()) window.webContents.send('materials:canvas-queue', ownTasks());
    }, 150);
  };

  // 只是提醒：读不出尺寸时不提醒，不能因为检查失败把生成好的图当成失败（存图时会再按格式校验）。
  const mismatchOf = (payload: Parameters<typeof sizeMismatchWarning>[0], dataUrl: string) => {
    try {
      return sizeMismatchWarning(payload, decodeGeneratedMedia(dataUrl).buffer);
    } catch {
      return '';
    }
  };

  // 提交时就开始把参考图存进生成历史（按 sha256 只存一份），槽位写记录前等它，「全量恢复」时放回画布。
  // 只是附带：存不进去就记空的，不影响生成。
  const referencesByTask = new Map<string, Promise<HistoryMedia[]>>();
  const referencesOf = (task: QueueTask) => referencesByTask.get(task.id) ?? Promise.resolve([]);
  const storeReferences = async (dataUrls: string[], account: string) => {
    try {
      const config = loadConfig(userDataDir, account);
      const stored: HistoryMedia[] = [];
      for (const dataUrl of dataUrls) {
        const { buffer, ext } = decodeGeneratedMedia(dataUrl);
        stored.push(await putHistoryMedia(config, buffer, ext));
      }
      return stored;
    } catch (error) {
      console.warn('参考图没存进生成历史，这个任务以后不能带参考图全量恢复', error);
      return [];
    }
  };

  // 队列在主进程内存里，几个账号共用；界面只看得到当前账号提交的任务。
  const accountByTask = new Map<string, string>();
  const ownTasks = () => queue.snapshot().filter((task) => accountByTask.get(task.id) === getAccount());

  const queue = createCanvasQueue({
    generate: async (payload) => {
      const generated = await generateMedia(loadAiRuntime(userDataDir), payload);
      const [image] = generated.images;
      if (!image) throw new Error('模型没有返回图片');
      const mediaType = image.mediaType ?? generated.mediaType ?? 'image';
      return {
        dataUrl: image.dataUrl,
        revisedPrompt: image.revisedPrompt ?? null,
        mediaType,
        model: generated.model,
        warning: mediaType === 'image' ? mismatchOf(payload, image.dataUrl) : '',
      };
    },
    persist: async (task, slot, generated) => {
      const account = accountByTask.get(task.id) ?? getAccount();
      const references = await referencesOf(task);
      const { buffer, ext } = decodeGeneratedMedia(generated.dataUrl);
      const record = { index: slot.index, status: 'done' as const, revisedPrompt: generated.revisedPrompt, error: generated.warning ?? '', attempts: slot.attempts, savedToLibrary: false };
      try {
        const config = loadConfig(userDataDir, account);
        const media = await putHistoryMedia(config, buffer, ext);
        await mutateHistory(config, (history) => ({ history: recordSlot(history, taskRecord(task, references), { ...record, media }, new Date().toISOString()), result: null }));
        return media;
      } catch (error) {
        if (!webdav.isUnreachable(error)) throw error;
        // NAS 断开：先存本机，界面照常显示（nas-media 先读本机），连上后 syncPending 补传。
        const { media, thumb } = describeMedia(buffer, ext);
        addPending(cacheDir(userDataDir, account), taskRecord(task, references), { ...record, media }, { media: buffer, thumb });
        onPendingChange();
        return media;
      }
    },
    recordFailure: async (task, slot) => {
      const account = accountByTask.get(task.id) ?? getAccount();
      const references = await referencesOf(task);
      const record = { index: slot.index, status: 'failed' as const, media: null, revisedPrompt: null, error: slot.error, attempts: slot.attempts, savedToLibrary: false };
      try {
        await mutateHistory(loadConfig(userDataDir, account), (history) => ({ history: recordSlot(history, taskRecord(task, references), record, new Date().toISOString()), result: null }));
      } catch (error) {
        if (!webdav.isUnreachable(error)) throw error;
        addPending(cacheDir(userDataDir, account), taskRecord(task, references), record);
        onPendingChange();
      }
    },
    limits: () => loadCanvasOptions(userDataDir),
    onChange: broadcast,
  });

  // 内存里还有的图（存进历史失败的）优先用；否则从 NAS 的生成历史取。
  const memorySlot = (taskId: string, index: number): { task: QueueTask; slot: QueueSlot } | null => {
    const task = ownTasks().find((entry) => entry.id === taskId);
    const slot = task?.slots.find((entry) => entry.index === index);
    return task && slot?.dataUrl ? { task, slot } : null;
  };

  async function resultBytes(taskId: string, index: number) {
    const inMemory = memorySlot(taskId, index);
    if (inMemory) {
      const { buffer, ext } = decodeGeneratedMedia(inMemory.slot.dataUrl!);
      return { buffer, ext, task: inMemory.task, fromHistory: false };
    }
    // 断线时生成、还没传上 NAS 的图在本机。
    const dir = cacheDir(userDataDir, getAccount());
    const pending = listPending(dir).find((entry) => entry.task.id === taskId && entry.slot.index === index);
    const pendingBuffer = pending && readPendingMedia(dir, pending);
    if (pending?.slot.media && pendingBuffer) return { buffer: pendingBuffer, ext: pending.slot.media.ext, task: pending.task, fromHistory: false };
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
    // 任务记下提交时的账号：生成要一会儿，中途切换账号，图也存回提交时那个账号的生成记录。
    const account = getAccount();
    loadConfig(userDataDir, account);
    // 任务信息由主进程按实际提交的参数记录，不信界面另传的。
    const taskId = queue.submit(
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
    const dataUrls = payload.referenceImageDataUrls ?? [];
    accountByTask.set(taskId, account);
    if (dataUrls.length) referencesByTask.set(taskId, storeReferences(dataUrls, account));
    return taskId;
  });
  ipcMain.handle('materials:canvas-queue', () => ownTasks());
  ipcMain.handle('materials:canvas-cancel', (_event, taskId) => queue.cancel(String(taskId)));
  ipcMain.handle('materials:canvas-retry', (_event, taskId, index) => queue.retry(String(taskId), Number(index)));
  ipcMain.handle('materials:canvas-dismiss', (_event, taskId) => queue.dismiss(String(taskId)));

  // 本机待上传的补传到 NAS：连上 NAS、读到生成历史时触发，同一时间只跑一个。传一条删一条，中途断了下次接着传。
  let syncing: Promise<void> | null = null;
  const syncPending = () =>
    (syncing ??= (async () => {
      const account = getAccount();
      if (!account) return;
      const dir = cacheDir(userDataDir, account);
      if (!listPending(dir).length) return;
      const config = loadConfig(userDataDir, account);
      const same = (entry: PendingEntry) => (other: PendingEntry) => other.task.id === entry.task.id && other.slot.index === entry.slot.index;
      for (const entry of listPending(dir)) {
        let media = entry.slot.media;
        if (media) {
          const buffer = readPendingMedia(dir, entry);
          if (!buffer) {
            console.warn(`本机暂存的图不见了，这条生成记录没法补传：${entry.task.id}:${entry.slot.index}`);
            removePending(dir, same(entry));
            continue;
          }
          media = await putHistoryMedia(config, buffer, media.ext);
        }
        await mutateHistory(config, (history) => ({ history: recordSlot(history, entry.task, { ...entry.slot, media }, entry.at), result: null }));
        removePending(dir, same(entry));
      }
    })()
      .catch((error) => console.warn('本机暂存的生成记录没补传完，下次连上再试', error))
      .finally(() => {
        syncing = null;
        onPendingChange();
      }));

  // NAS 连不上时用本机那份（最近一次读到的）加上待上传的，界面照常显示，offline 告诉界面这是缓存。
  ipcMain.handle('materials:canvas-history', async () => {
    const config = loadConfig(userDataDir);
    const dir = cacheDir(userDataDir, getAccount());
    try {
      const { history, dropped } = await readHistory(config);
      saveHistoryCopy(dir, history);
      pruneCache(dir);
      void syncPending();
      return { history: mergePending(history, listPending(dir)), dropped, offline: false, error: '' };
    } catch (error) {
      if (!webdav.isUnreachable(error)) throw error;
      const cached = readHistoryCopy(dir) ?? normalizeHistory(null).history;
      return { history: mergePending(cached, listPending(dir)), dropped: 0, offline: true, error: error instanceof Error ? error.message : String(error) };
    }
  });
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
    const removing = new Set(wanted);
    // 还没传上 NAS 的也一起删（NAS 连得上才走到这里）。
    if (removePending(cacheDir(userDataDir, getAccount()), (entry) => removing.has(entry.task.id) || removing.has(`${entry.task.id}:${entry.slot.index}`))) onPendingChange();
    for (const task of ownTasks()) {
      if (!wanted.some((id) => id === task.id || id.startsWith(`${task.id}:`))) continue;
      // 只删了几张时，留下的图里还有只在内存里（没存进历史）的，任务就不从队列拿掉，免得那几张跟着没了。
      if (!removing.has(task.id) && task.slots.some((slot) => slot.dataUrl && !removing.has(`${task.id}:${slot.index}`))) continue;
      try {
        queue.dismiss(task.id);
      } catch {
        // 还在进行的任务不从队列里拿掉，界面上照常显示。
      }
    }
    return { history, dropped, warnings };
  });

  ipcMain.handle('materials:canvas-copy-image', async (_event, taskId, index) => {
    const { buffer } = await resultBytes(String(taskId), Number(index));
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) throw new Error('这种图片格式不能放进剪贴板');
    clipboard.writeImage(image);
  });

  // 画布模板：和提示词库分开，存在 NAS 的 canvas-templates.json。
  ipcMain.handle('materials:canvas-templates', () => readTemplates(loadConfig(userDataDir)));
  ipcMain.handle('materials:canvas-template-save', (_event, input: TemplateInput) =>
    mutateTemplates(loadConfig(userDataDir), (current) => saveTemplate(current, input ?? { title: '', content: '', category: '' }, new Date().toISOString())),
  );
  ipcMain.handle('materials:canvas-template-delete', (_event, id) =>
    mutateTemplates(loadConfig(userDataDir), (current) => ({ templates: deleteTemplate(current, String(id), new Date().toISOString()), result: null })),
  );
  ipcMain.handle('materials:canvas-template-use', (_event, id) =>
    mutateTemplates(loadConfig(userDataDir), (current) => ({ templates: markTemplateUsed(current, String(id), new Date().toISOString()), result: null })),
  );

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
  // 生成历史里的图转成 data URL：「全量恢复」放回当时的参考图，「仅回填参考图」把生成的图当参考图。
  ipcMain.handle('materials:canvas-history-image', async (_event, sha256, ext) => {
    const media = { sha256: String(sha256), ext: String(ext) };
    if (!/^[0-9a-f]{64}$/.test(media.sha256) || !/^\.(png|jpe?g|webp|gif|bmp)$/i.test(media.ext)) throw new Error('这不是生成历史里的图片');
    const bytes = await webdav.readBytes(loadConfig(userDataDir), historyMediaPath(media));
    return `data:${mimeTypeOf(`x${media.ext}`)};base64,${Buffer.from(bytes).toString('base64')}`;
  });
  ipcMain.handle('materials:canvas-clipboard-image', () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) throw new Error('剪贴板里没有图片');
    return image.toDataURL();
  });

  return {
    syncPending,
    pendingStats: () => (getAccount() ? pendingStats(cacheDir(userDataDir, getAccount())) : { count: 0, bytes: 0, overLimit: false }),
    // 所有账号的：装更新要关软件，哪个账号的任务都会被中断。
    activeTasks: () => queue.snapshot().filter((task) => task.slots.some((slot) => slot.status === 'queued' || slot.status === 'running')).length,
  };
}
