// Word、分享包的导入导出：读写格式在 wordImport.ts / sharePackage.ts，这里负责上传到 NAS、写索引、汇报进度。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mediaPath, type MaterialItem } from '../../src/materials/library.ts';
import { readLibrary } from './libraryStore.ts';
import { readSharePackage, writeSharePackage } from './sharePackage.ts';
import { exclusive, reason, type Failure, type Report } from './tasks.ts';
import { commitImport, uploadBuffer } from './uploads.ts';
import { readWordDocument } from './wordImport.ts';
import * as webdav from './webdav.ts';
import type { DavConfig } from './webdav.ts';

export function importWordFiles(config: DavConfig, filePaths: string[], category: string, report: Report) {
  return exclusive(async (signal) => {
    const items: MaterialItem[] = [];
    const failures: Failure[] = [];
    for (const filePath of filePaths) {
      const documentName = path.basename(filePath);
      try {
        const { images, skipped } = await readWordDocument(filePath);
        if (skipped) failures.push({ name: documentName, message: `${skipped} 张图片认不出格式或找不到，已跳过` });
        if (images.length === 0) failures.push({ name: documentName, message: '没有找到可以导入的图片' });
        for (const [index, image] of images.entries()) {
          if (signal.aborted) break;
          report({ task: '导入 Word', done: index, total: images.length, current: `${documentName} · ${image.name}` });
          items.push(await uploadBuffer(config, image.buffer, image.name, image.text, category));
        }
      } catch (error) {
        failures.push({ name: documentName, message: reason(error) });
      }
    }
    return commitImport(config, items, failures);
  });
}

export function importSharePackageFile(config: DavConfig, zipPath: string, report: Report) {
  return exclusive(async (signal) => {
    report({ task: '导入分享包', done: 0, total: 0, current: '正在读取分享包' });
    const { entries, missing } = await readSharePackage(zipPath);
    const failures: Failure[] = missing.map((name) => ({ name, message: '分享包里缺少这个文件' }));
    const items: MaterialItem[] = [];
    for (const [index, entry] of entries.entries()) {
      if (signal.aborted) break;
      report({ task: '导入分享包', done: index, total: entries.length, current: entry.text.title || entry.name });
      try {
        const item = await uploadBuffer(config, entry.buffer, entry.name, entry.text, entry.category);
        // 保留原来的创建时间，同组效果图的先后顺序才不会乱。
        items.push({ ...item, favorite: entry.favorite, createdAt: entry.createdAt ?? item.createdAt });
      } catch (error) {
        failures.push({ name: entry.name, message: reason(error) });
      }
    }
    return commitImport(config, items, failures);
  });
}

// 先把所选素材下载到临时文件夹，再打包，结束后删掉临时文件。
export function exportSharePackageTo(config: DavConfig, ids: string[], outputPath: string, report: Report) {
  return exclusive(async (signal) => {
    const { library } = await readLibrary(config);
    const wanted = new Set(ids);
    const items = library.items.filter((item) => wanted.has(item.id));
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-assistant-share-'));
    const files = new Map<string, string>();
    const failures: Failure[] = [];
    try {
      for (const [index, item] of items.entries()) {
        if (signal.aborted) break;
        report({ task: '导出分享包', done: index, total: items.length, current: item.media.name });
        const target = path.join(workDir, `${index}${item.media.ext}`);
        try {
          await webdav.downloadToFile(config, mediaPath(item.media), target);
          files.set(item.id, target);
        } catch (error) {
          failures.push({ name: item.media.name, message: reason(error) });
        }
      }
      if (!signal.aborted && files.size) {
        report({ task: '导出分享包', done: items.length, total: items.length, current: '正在打包' });
        await writeSharePackage(items.filter((item) => files.has(item.id)), files, outputPath);
      }
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    return { exported: signal.aborted ? 0 : files.size, failures, canceled: signal.aborted, dir: outputPath };
  });
}
