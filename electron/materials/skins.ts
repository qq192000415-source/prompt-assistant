/// <reference types="vite/client" />
// 皮肤包的 IPC 和文件对话框；落盘和校验在 skinStore.ts。
import fs from 'node:fs';
import path from 'node:path';
import { dialog, type BrowserWindow, type IpcMain } from 'electron';
import { checkSkinId, exportSkin, installSkin, listSkins, removeSkin } from './skinStore.ts';

// 内置皮肤的 id，装皮肤包时不许占用。
const builtinManifests = import.meta.glob<{ id: string }>('../../src/skins/builtin/*/manifest.json', { eager: true, import: 'default' });
const BUILTIN_SKIN_IDS = Object.values(builtinManifests).map((manifest) => manifest.id);

type RegisterSkinsOptions = { ipcMain: IpcMain; userDataDir: string; getWindow: () => BrowserWindow | null };

export function registerSkins({ ipcMain, userDataDir, getWindow }: RegisterSkinsOptions) {
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
