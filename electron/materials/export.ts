// 导出到本机文件夹：原文件按标题命名，另写一份「素材清单.json」记下提示词和分类。
// 目标文件夹里已有同名文件时不覆盖，改名加序号。不依赖 Electron，Node 测试可直接加载。
import fs from 'node:fs';
import path from 'node:path';
import { exportFileNames, mediaPath, type MaterialItem } from '../../src/materials/library.ts';
import { readLibrary } from './libraryStore.ts';
import { exclusive, reason, type Failure, type Report } from './tasks.ts';
import * as webdav from './webdav.ts';
import type { DavConfig } from './webdav.ts';

export function exportItems(config: DavConfig, ids: string[], dir: string, report: Report) {
  return exclusive(async (signal) => {
    const { library } = await readLibrary(config);
    const wanted = new Set(ids);
    const items = library.items.filter((item) => wanted.has(item.id));
    const taken = (name: string) => fs.existsSync(path.join(dir, name));
    const names = exportFileNames(items, taken);
    const failures: Failure[] = [];
    const manifest: Array<Pick<MaterialItem, 'title' | 'prompt' | 'negativePrompt' | 'category' | 'tags'> & { file: string }> = [];

    for (const [index, item] of items.entries()) {
      if (signal.aborted) break;
      report({ task: '导出', done: index, total: items.length, current: item.media.name });
      const name = names[index];
      try {
        await webdav.downloadToFile(config, mediaPath(item.media), path.join(dir, name));
        manifest.push({ file: name, title: item.title, prompt: item.prompt, negativePrompt: item.negativePrompt, category: item.category, tags: item.tags });
      } catch (error) {
        fs.rmSync(path.join(dir, name), { force: true });
        failures.push({ name: item.media.name, message: reason(error) });
      }
    }

    if (manifest.length) {
      let manifestName = '素材清单.json';
      for (let suffix = 2; taken(manifestName); suffix += 1) manifestName = `素材清单 (${suffix}).json`;
      fs.writeFileSync(path.join(dir, manifestName), JSON.stringify(manifest, null, 2));
    }
    report({ task: '导出', done: items.length, total: items.length, current: '' });
    return { exported: manifest.length, failures, canceled: signal.aborted, dir };
  });
}
