// 素材库主进程入口：nas-media:// 媒体协议、导入、IPC。编译成 electron/materials.cjs，由 main.cjs 引用。
import fs from 'node:fs';
import path from 'node:path';
import { clipboard, dialog, nativeImage, protocol, type BrowserWindow, type IpcMain } from 'electron';
import {
  deleteItems,
  mediaPath,
  patchItem,
  thumbPath,
  type MaterialItem,
  type MaterialMedia,
  type MaterialPatch,
} from '../../src/materials/library.ts';
import { mimeTypeOf } from '../../src/materials/mediaFileTypes.ts';
import { batchClassify, batchReverse, classifyItem, knownCategoriesOf, optimizePrompt, reversePrompt, translatePrompt } from './ai.ts';
import { getPublicAiSettings, listModels, loadAiRuntime, saveAiSettings, setBaseUrl, setImageModel, setRuleOverrides, testModel } from './aiSettings.ts';
import { compressImages, compressVideos, type ImageCompressOptions } from './batch.ts';
import { exportItems } from './export.ts';
import { cancelBatch, reason, type BatchProgress, type Failure } from './tasks.ts';
import { importFromClipboard } from './linkImport.ts';
import { exportSharePackageTo, importSharePackageFile, importWordFiles } from './importers.ts';
import { applyProxySettings, readProxySettings, saveProxySettings, testProxy } from './proxy.ts';
import { registerCanvas } from './canvasService.ts';
import { commitImport, uploadFile } from './uploads.ts';
import { prepareAccountFolder } from './accountFolder.ts';
import { applyGrant, getAccount, getPublicConfig, loadConfig, loadRootConfig, revealConfig, saveConfig, setAccount } from './config.ts';
import { cacheDir, localCanvasFile, storeThumb, thumbInsteadOf, thumbShaOf } from './canvasCache.ts';
import { createNasMonitor } from './nasMonitor.ts';
import { FFMPEG_COMPONENT, ffmpegPath, installFfmpeg, isFfmpegInstalled, type VideoCompressOptions } from './ffmpeg.ts';
import { mutateLibrary, readLibrary } from './libraryStore.ts';
import { setRouteLogger } from './proxyBypass.ts';
import { handleSkinRequest, SKIN_SCHEME } from './skinStore.ts';
import { registerSkins } from './skins.ts';
import { registerCustom } from './customIpc.ts';
import * as webdav from './webdav.ts';

const SCHEME = 'nas-media';
// 素材库的原文件、缩略图，以及画布生成历史（canvas-history/）里的原文件、缩略图。
const MEDIA_PATH_PATTERN = /^((canvas-history\/)?media\/[0-9a-f]{64}\.[a-z0-9]{1,5}|(canvas-history\/)?thumbs\/[0-9a-f]{64}\.jpg)$/;

// 必须在 app ready 之前调用，而且只能调一次（后一次会覆盖前一次），所以皮肤的 skin:// 也登记在这里。
export function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
    { scheme: SKIN_SCHEME, privileges: { standard: true, secure: true } },
  ]);
}

const fileResponse = (file: string, type: string) => new Response(fs.readFileSync(file), { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });

// 渲染进程用 nas-media://media/<sha>.<ext> 显示图片和视频：主进程带上账户去 NAS 取，
// 透传 Range 让视频能拖进度条，并要求浏览器不缓存。素材库的不落本机；画布生成记录先看本机缓存（canvasCache.ts）：
// 没传上 NAS 的原图、看过的缩略图直接读本机，从 NAS 读到的缩略图存一份，NAS 断开时原图用缩略图代替。
function handleMediaRequest(userDataDir: string) {
  return async (request: Request) => {
    const url = new URL(request.url);
    const relativePath = `${url.hostname}${decodeURIComponent(url.pathname)}`;
    if (!MEDIA_PATH_PATTERN.test(relativePath)) {
      return new Response('not found', { status: 404 });
    }
    const dir = relativePath.startsWith('canvas-history/') && getAccount() ? cacheDir(userDataDir, getAccount()) : null;
    const local = dir && localCanvasFile(dir, relativePath);
    if (local) return fileResponse(local, mimeTypeOf(relativePath));
    try {
      const config = loadConfig(userDataDir);
      const range = request.headers.get('range');
      const upstream = await webdav.dav(config, 'GET', relativePath, {
        headers: range ? { Range: range } : {},
        allow: [404, 416],
      });
      const headers = new Headers({ 'Content-Type': mimeTypeOf(relativePath), 'Cache-Control': 'no-store' });
      const sha256 = dir && upstream.status === 200 ? thumbShaOf(relativePath) : null;
      if (dir && sha256) {
        const buffer = Buffer.from(await upstream.arrayBuffer());
        storeThumb(dir, sha256, buffer);
        return new Response(buffer, { headers });
      }
      for (const name of ['content-length', 'content-range', 'accept-ranges']) {
        const value = upstream.headers.get(name);
        if (value) headers.set(name, value);
      }
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch (error) {
      const thumb = dir && webdav.isUnreachable(error) ? thumbInsteadOf(dir, relativePath) : null;
      if (thumb) return fileResponse(thumb, 'image/jpeg');
      return new Response(error instanceof Error ? error.message : String(error), { status: 502 });
    }
  };
}

async function importPaths(userDataDir: string, filePaths: string[], category: string) {
  const config = loadConfig(userDataDir);
  const items: MaterialItem[] = [];
  const errors: Failure[] = [];
  for (const filePath of filePaths) {
    try {
      items.push(await uploadFile(config, filePath, category));
    } catch (error) {
      errors.push({ name: path.basename(filePath), message: reason(error) });
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
  // 皮肤包（src/skins/）和素材库无关，只是借这里的主进程打包和协议登记。
  protocol.handle(SKIN_SCHEME, handleSkinRequest(userDataDir));
  registerSkins({ ipcMain, userDataDir, updateBaseUrl, getWindow });
  // 来图定制（1.18.0）也只是借这里的主进程打包，连接和数据都和素材库分开。
  registerCustom({ ipcMain, userDataDir, updateBaseUrl, getWindow });

  // NAS 连接状态推给界面，带上当前账号本机待上传的数量；从断开变成连上时补传。
  const nasStatus = () => ({ ...monitor.status(), pending: canvasService.pendingStats() });
  const pushNasStatus = () => {
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send('materials:nas-status', nasStatus());
  };
  const monitor = createNasMonitor({
    probe: () => webdav.exists(loadRootConfig(userDataDir), ''),
    onChange: (status, previous) => {
      pushNasStatus();
      if (status.state === 'connected' && previous !== 'connected') void canvasService.syncPending();
    },
  });
  webdav.setReachabilityListener(monitor.report);
  // 绕开代理找线路的过程写 <userData>/logs/nas.log（超过 1MB 从头写），客户连不上 NAS 时看这里。
  setRouteLogger((line) => {
    try {
      const file = path.join(userDataDir, 'logs', 'nas.log');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.rmSync(file);
      fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
    } catch {
      // 日志写不进去不影响连接。
    }
  });
  ipcMain.handle('materials:nas-status', () => nasStatus());
  ipcMain.handle('materials:nas-reconnect', async () => {
    await monitor.reconnect();
    return nasStatus();
  });

  ipcMain.handle('materials:get-config', () => getPublicConfig(userDataDir));
  ipcMain.handle('materials:save-config', (_event, input) =>
    saveConfig(userDataDir, {
      baseUrl: String(input?.baseUrl ?? ''),
      username: String(input?.username ?? ''),
      password: typeof input?.password === 'string' ? input.password : undefined,
    }),
  );
  ipcMain.handle('materials:reveal-config', () => revealConfig(userDataDir));
  ipcMain.handle('materials:apply-grant', (_event, grant, own) =>
    applyGrant(
      userDataDir,
      grant ? { baseUrl: String(grant.baseUrl ?? ''), username: String(grant.username ?? ''), password: String(grant.password ?? '') } : null,
      own === true,
    ),
  );
  // 界面登录、切换、退出云同步账号时调用；管理员账号第一次打开时把根下的旧数据搬进自己的子文件夹。
  ipcMain.handle('materials:set-account', async (_event, email, adoptLegacy) => {
    setAccount(typeof email === 'string' ? email : '');
    if (!email) return { moved: [] };
    return { moved: await prepareAccountFolder(loadRootConfig(userDataDir), String(email), adoptLegacy === true) };
  });
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
  ipcMain.handle('materials:import-clipboard', (_event, category) => importFromClipboard(loadConfig(userDataDir), asCategory(category)));

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

  const pickFiles = async (options: Electron.OpenDialogOptions) => {
    const window = getWindow();
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  };

  ipcMain.handle('materials:import-word', async (event, category) => {
    const files = await pickFiles({ title: '导入 Word 图文', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Word 文档', extensions: ['docx'] }] });
    if (!files.length) return null;
    return importWordFiles(loadConfig(userDataDir), files, asCategory(category), progressTo(event));
  });
  ipcMain.handle('materials:import-share', async (event) => {
    const [file] = await pickFiles({ title: '导入分享包', properties: ['openFile'], filters: [{ name: '分享包', extensions: ['zip'] }] });
    if (!file) return null;
    return importSharePackageFile(loadConfig(userDataDir), file, progressTo(event));
  });
  ipcMain.handle('materials:export-share', async (event, ids, defaultDir) => {
    const window = getWindow();
    const stamp = new Date().toLocaleString('sv-SE').replace(/[: ]/g, '-');
    const options: Electron.SaveDialogOptions = {
      title: '导出分享包',
      defaultPath: path.join(typeof defaultDir === 'string' ? defaultDir : '', `灵匣-素材-${stamp}.zip`),
      filters: [{ name: '分享包', extensions: ['zip'] }],
    };
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    return exportSharePackageTo(loadConfig(userDataDir), asStringArray(ids), result.filePath, progressTo(event));
  });

  void applyProxySettings(readProxySettings(userDataDir)).catch((error) => console.warn('应用抓取代理设置失败', error));
  ipcMain.handle('materials:get-proxy', () => readProxySettings(userDataDir));
  ipcMain.handle('materials:save-proxy', async (_event, input) => ({ settings: await saveProxySettings(userDataDir, input), results: await testProxy() }));

  const slotName = (value: unknown) => (value === 'vision' || value === 'image' ? value : 'text');
  const findItem = async (itemId: unknown) => {
    const config = loadConfig(userDataDir);
    const { library } = await readLibrary(config);
    const item = library.items.find((entry) => entry.id === itemId);
    if (!item) throw new Error('这条素材已经不存在，可能在另一台电脑上被删除了');
    return { config, library, item };
  };
  ipcMain.handle('materials:ai-get-settings', () => getPublicAiSettings(userDataDir));
  ipcMain.handle('materials:ai-save-settings', (_event, input) => saveAiSettings(userDataDir, input ?? {}));
  ipcMain.handle('materials:ai-list-models', (_event, name, input) => listModels(userDataDir, slotName(name), input ?? {}));
  ipcMain.handle('materials:ai-set-image-model', (_event, model) => setImageModel(userDataDir, model));
  ipcMain.handle('materials:ai-set-base-url', (_event, slots, url) => setBaseUrl(userDataDir, slots, url));
  ipcMain.handle('materials:ai-set-rule-overrides', (_event, overrides) => setRuleOverrides(userDataDir, overrides));
  ipcMain.handle('materials:ai-test', (_event, name, input) => testModel(userDataDir, slotName(name), input ?? {}));
  ipcMain.handle('materials:ai-reverse', async (_event, itemId) => {
    const { config, item } = await findItem(itemId);
    return reversePrompt(loadAiRuntime(userDataDir), config, item);
  });
  ipcMain.handle('materials:ai-optimize', (_event, prompt, kind) =>
    optimizePrompt(loadAiRuntime(userDataDir), String(prompt ?? ''), kind === 'negative' ? 'negative' : 'positive'),
  );
  ipcMain.handle('materials:ai-translate', (_event, prompt, negativePrompt) =>
    translatePrompt(loadAiRuntime(userDataDir), String(prompt ?? ''), String(negativePrompt ?? '')),
  );
  // prompt 是详情页里还没保存的提示词，没有视觉模型时按它分类。
  ipcMain.handle('materials:ai-classify', async (_event, itemId, prompt) => {
    const { config, library, item } = await findItem(itemId);
    return classifyItem(loadAiRuntime(userDataDir), config, item, String(prompt ?? ''), knownCategoriesOf(library));
  });
  ipcMain.handle('materials:ai-batch-reverse', (event, ids) =>
    batchReverse(loadAiRuntime(userDataDir), loadConfig(userDataDir), asStringArray(ids), progressTo(event)),
  );
  ipcMain.handle('materials:ai-batch-classify', (event, ids) =>
    batchClassify(loadAiRuntime(userDataDir), loadConfig(userDataDir), asStringArray(ids), progressTo(event)),
  );

  const canvasService = registerCanvas({ ipcMain, userDataDir, getWindow, findItem, onPendingChange: pushNasStatus });
  return { activeCanvasTasks: canvasService.activeTasks };
}
