/// <reference types="vite/client" />
// 皮肤包的 IPC 和文件对话框；落盘和校验在 skinStore.ts。
import fs from 'node:fs';
import path from 'node:path';
import { dialog, net, type BrowserWindow, type IpcMain } from 'electron';
import JSZip from 'jszip';
import { loadAiRuntime } from './aiSettings.ts';
import { generateMedia } from './canvas.ts';
import { net as linkNet } from './linkSession.ts';
import { createWallhaven } from './wallhaven.ts';
import { checkSkinId, downloadMarketTheme, exportSkin, fetchMarketIndex, installSkin, listSkins, removeSkin, type MarketTheme } from './skinStore.ts';

// 内置皮肤的 id，装皮肤包时不许占用。
const builtinManifests = import.meta.glob<{ id: string }>('../../src/skins/builtin/*/manifest.json', { eager: true, import: 'default' });
const BUILTIN_SKIN_IDS = Object.values(builtinManifests).map((manifest) => manifest.id);

// 主题市场的备用来源：公开仓库里的 themes/。主来源是更新服务器上的镜像（国内直连 GitHub 常常不通）。
const GITHUB_THEMES_BASE = 'https://raw.githubusercontent.com/qq192000415-source/prompt-assistant/main/themes/';

type RegisterSkinsOptions = { ipcMain: IpcMain; userDataDir: string; updateBaseUrl: string; getWindow: () => BrowserWindow | null };

export function registerSkins({ ipcMain, userDataDir, updateBaseUrl, getWindow }: RegisterSkinsOptions) {
  // net.fetch 走系统代理，能翻墙的电脑读 GitHub 也通。
  const fetchImpl = (url: string, init?: { signal?: AbortSignal }) => net.fetch(url, init);
  const sources = [updateBaseUrl && `${updateBaseUrl.replace(/\/+$/, '')}/themes/`, GITHUB_THEMES_BASE].filter(Boolean) as string[];
  // 最近一次读到的市场：安装时按 id 在这里找，不信渲染进程传来的地址和校验值。
  let market: { base: string; themes: MarketTheme[] } | null = null;
  const wallhaven = createWallhaven((url) => linkNet.fetch(url));

  const installFiles = async (filePaths: string[]) => {
    const installed: Array<{ id: string; name: string; replaced: boolean }> = [];
    const errors: Array<{ name: string; message: string }> = [];
    for (const filePath of filePaths) {
      try {
        const { manifest, replaced } = await installSkin(userDataDir, fs.readFileSync(filePath), BUILTIN_SKIN_IDS);
        installed.push({ id: manifest.id, name: manifest.name, replaced });
      } catch (error) {
        errors.push({ name: path.basename(filePath), message: error instanceof Error ? error.message : String(error) });
      }
    }
    return { installed, errors };
  };

  ipcMain.handle('skins:list', () => listSkins(userDataDir));
  ipcMain.handle('skins:pick-install', async () => {
    const window = getWindow();
    const options: Electron.OpenDialogOptions = { title: '安装皮肤包', properties: ['openFile', 'multiSelections'], filters: [{ name: '皮肤包', extensions: ['zip'] }] };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : installFiles(result.filePaths);
  });
  ipcMain.handle('skins:install-paths', (_event, filePaths) =>
    installFiles(Array.isArray(filePaths) ? filePaths.filter((entry): entry is string => typeof entry === 'string') : []),
  );
  ipcMain.handle('skins:remove', (_event, id) => removeSkin(userDataDir, id));
  ipcMain.handle('skins:market', async () => {
    const result = await fetchMarketIndex(sources, fetchImpl);
    market = { base: result.base, themes: result.themes };
    return { ...result, source: result.base === GITHUB_THEMES_BASE ? 'github' : 'mirror' };
  });
  ipcMain.handle('skins:market-install', async (_event, id) => {
    const theme = market?.themes.find((entry) => entry.id === id);
    if (!market || !theme) throw new Error('市场里没有这个皮肤，刷新一下再试');
    const bytes = await downloadMarketTheme(market.base, theme, fetchImpl);
    const { manifest, replaced } = await installSkin(userDataDir, bytes, BUILTIN_SKIN_IDS);
    if (manifest.id !== theme.id) {
      removeSkin(userDataDir, manifest.id);
      throw new Error(`市场登记的是「${theme.id}」，下载到的包却是「${manifest.id}」，已撤销安装`);
    }
    return { id: manifest.id, name: manifest.name, replaced };
  });
  // 设置 › 皮肤 › 做一套皮肤（1.17.0）：界面算好 manifest、画好壁纸和预览图，这里打成 zip 走和皮肤包一样的校验再装。
  ipcMain.handle('skins:install-generated', async (_event, manifest, files) => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(manifest));
    for (const [name, content] of Object.entries((files ?? {}) as Record<string, unknown>)) {
      if (!(content instanceof Uint8Array)) throw new Error(`皮肤文件 ${name} 不是图片数据`);
      zip.file(name, content);
    }
    const { manifest: installed, replaced } = await installSkin(userDataDir, await zip.generateAsync({ type: 'uint8array' }), BUILTIN_SKIN_IDS);
    return { id: installed.id, name: installed.name, replaced };
  });
  // AI 生成壁纸：用「API 配置」里的生图模型一次出两张（各发一个请求），失败的那张带上原因。
  ipcMain.handle('skins:generate-wallpaper', async (_event, prompt, composition) => {
    const portrait = composition === 'character';
    const payload = { prompt: String(prompt ?? ''), size: portrait ? '1472x2624' : '2624x1472', ratio: portrait ? '9:16' : '16:9', n: 1 } as Parameters<typeof generateMedia>[1];
    const results = await Promise.allSettled([0, 1].map(() => generateMedia(loadAiRuntime(userDataDir), payload)));
    return {
      images: results.flatMap((result) => (result.status === 'fulfilled' ? result.value.images.map((image) => image.dataUrl) : [])),
      errors: results.flatMap((result) => (result.status === 'rejected' ? [result.reason instanceof Error ? result.reason.message : String(result.reason)] : [])),
    };
  });
  ipcMain.handle('skins:wallhaven-search', (_event, input) => wallhaven.search(input ?? {}));
  ipcMain.handle('skins:wallhaven-image', (_event, id) => wallhaven.image(id));
  ipcMain.handle('skins:export', async (_event, id) => {
    const bytes = await exportSkin(userDataDir, id);
    const window = getWindow();
    const options: Electron.SaveDialogOptions = { title: '导出皮肤包', defaultPath: `${checkSkinId(id)}.zip`, filters: [{ name: '皮肤包', extensions: ['zip'] }] };
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, bytes);
    return result.filePath;
  });
}
