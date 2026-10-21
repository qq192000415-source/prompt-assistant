/// <reference types="vite/client" />
// 皮肤包的 IPC 和文件对话框；落盘和校验在 skinStore.ts。
import fs from 'node:fs';
import path from 'node:path';
import { dialog, net, type BrowserWindow, type IpcMain } from 'electron';
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
