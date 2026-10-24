// 来图定制的 IPC。连接来自管理员授权（表 custom_teams），界面登录后交过来，只放在内存里；和素材库的 NAS 连接互不相干。
import fs from 'node:fs';
import path from 'node:path';
import { clipboard, dialog, nativeImage, type BrowserWindow, type IpcMain } from 'electron';
import { deleteProduct, importMockupPsd, readProducts, readTemplateFile, saveOrderVersion, savePhotoTemplate, saveProduct, type OrderFile, type OrderSource, type ProductInput } from './customStore.ts';
import { normalizeBaseUrl, type DavConfig } from './webdav.ts';
import { loadAiRuntime } from './aiSettings.ts';
import { decodeGeneratedMedia, generateMedia } from './canvas.ts';
import { UPSCALER_COMPONENT, installUpscaler, isUpscalerInstalled, upscaleImage, type UpscaleModel } from './upscaler.ts';
import type { OrderLayout } from '../../src/custom/layout.ts';

type Grant = { baseUrl: string; username: string; password: string };

const MAX_PSD_BYTES = 300 * 1024 * 1024;
const asBytes = (value: unknown) => (value instanceof Uint8Array ? value : new Uint8Array(0));

export function registerCustom({ ipcMain, userDataDir, updateBaseUrl, getWindow }: { ipcMain: IpcMain; userDataDir: string; updateBaseUrl: string; getWindow: () => BrowserWindow | null }) {
  let config: DavConfig | null = null;
  const current = () => {
    if (!config) throw new Error('这个账号还没有开通来图定制，请联系管理员');
    return config;
  };

  ipcMain.handle('custom:apply-grant', (_event, grant: Grant | null) => {
    config = grant?.baseUrl ? { baseUrl: normalizeBaseUrl(grant.baseUrl), username: String(grant.username ?? ''), password: String(grant.password ?? '') } : null;
    return { connected: config !== null };
  });
  ipcMain.handle('custom:list-products', () => readProducts(current()));
  ipcMain.handle('custom:save-product', (_event, input: ProductInput) => saveProduct(current(), input));
  ipcMain.handle('custom:delete-product', (_event, productId: string) => deleteProduct(current(), String(productId)));
  ipcMain.handle('custom:import-psd', async (_event, productId: string) => {
    const window = getWindow();
    const options = { title: '选择样机 PSD', properties: ['openFile' as const], filters: [{ name: 'Photoshop', extensions: ['psd'] }] };
    const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (picked.canceled || !picked.filePaths[0]) return null;
    const file = picked.filePaths[0];
    if (fs.statSync(file).size > MAX_PSD_BYTES) throw new Error('PSD 超过 300MB，请先在 PS 里合并不需要的图层再导入');
    return importMockupPsd(current(), String(productId), fs.readFileSync(file));
  });
  ipcMain.handle('custom:save-photo-template', (_event, productId: string, input: { bytes: Uint8Array; ext: string; width: number; height: number; mesh: Array<{ x: number; y: number }> }) =>
    savePhotoTemplate(current(), String(productId), {
      bytes: asBytes(input?.bytes),
      ext: String(input?.ext ?? ''),
      width: Number(input?.width),
      height: Number(input?.height),
      mesh: Array.isArray(input?.mesh) ? input.mesh.map((point) => ({ x: Number(point?.x), y: Number(point?.y) })) : [],
    }),
  );
  ipcMain.handle('custom:read-template-file', (_event, productId: string, file: string) => readTemplateFile(current(), String(productId), String(file)));
  ipcMain.handle('custom:save-order-version', (_event, input: { name: string; layout: OrderLayout; sources: OrderSource[]; outputs: OrderFile[] }) =>
    saveOrderVersion(current(), {
      name: String(input?.name ?? ''),
      layout: input?.layout,
      sources: (input?.sources ?? []).map((source) => ({ sha256: String(source.sha256), ext: String(source.ext), bytes: asBytes(source.bytes) })),
      outputs: (input?.outputs ?? []).map((output) => ({ name: String(output.name), bytes: asBytes(output.bytes) })),
    }),
  );
  // AI 修图：用「API 配置」里的生图模型出一张，不进画布队列、不记生成记录。贴回原图在界面里做（src/custom/retouch.ts）。
  ipcMain.handle('custom:ai-edit', async (_event, input: { prompt: string; imageDataUrl: string; maskDataUrl?: string; size: string; ratio: string }) => {
    const payload = {
      prompt: String(input?.prompt ?? ''),
      size: String(input?.size ?? ''),
      ratio: String(input?.ratio ?? ''),
      n: 1,
      referenceImageDataUrls: [String(input?.imageDataUrl ?? '')],
      ...(input?.maskDataUrl ? { maskDataUrl: String(input.maskDataUrl) } : {}),
    } as Parameters<typeof generateMedia>[1];
    const generated = await generateMedia(loadAiRuntime(userDataDir), payload);
    const image = generated.images[0];
    if (!image) throw new Error('模型没有返回图片');
    const { buffer, ext } = decodeGeneratedMedia(image.dataUrl);
    if (ext === '.mp4') throw new Error('模型返回的是视频，不是图片');
    return { bytes: new Uint8Array(buffer), ext };
  });
  // 高清放大：组件按需下载（进度走素材库的 materials:progress 事件），放大失败时返回原因，界面退回普通放大。
  ipcMain.handle('custom:upscaler-status', () => ({ installed: isUpscalerInstalled(userDataDir), downloadBytes: UPSCALER_COMPONENT.size }));
  ipcMain.handle('custom:install-upscaler', (event) =>
    installUpscaler(userDataDir, updateBaseUrl, (done, total) => {
      if (!event.sender.isDestroyed()) event.sender.send('materials:progress', { task: '下载高清放大组件', done, total, current: '' });
    }),
  );
  ipcMain.handle('custom:upscale', (_event, input: { bytes: Uint8Array; ext: string; model: UpscaleModel }) =>
    upscaleImage(userDataDir, asBytes(input?.bytes), String(input?.ext ?? ''), input?.model === 'anime' ? 'anime' : 'photo'),
  );
  // 效果图放进剪贴板，直接粘贴到千牛发给买家。
  ipcMain.handle('custom:copy-image', (_event, png: Uint8Array) => {
    const image = nativeImage.createFromBuffer(Buffer.from(asBytes(png)));
    if (image.isEmpty()) throw new Error('效果图读不出来，没有复制');
    clipboard.writeImage(image);
  });
  // 生产图另存到本机：选一个文件夹，同名文件直接覆盖（文件名里有尺寸和单名，重名就是同一张图的新版）。
  ipcMain.handle('custom:export-files', async (_event, files: OrderFile[]) => {
    const window = getWindow();
    const options = { title: '选择保存生产图的文件夹', properties: ['openDirectory' as const, 'createDirectory' as const] };
    const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (picked.canceled || !picked.filePaths[0]) return null;
    const folder = picked.filePaths[0];
    for (const file of files ?? []) {
      const name = path.basename(String(file.name));
      if (!name || name !== String(file.name)) throw new Error(`文件名「${file.name}」不对`);
      fs.writeFileSync(path.join(folder, name), asBytes(file.bytes));
    }
    return { folder, count: (files ?? []).length };
  });
}
