// 分享包：一个 ZIP，里面是 data.json（素材条目）和 images/<文件名>（原文件）。
// 格式和 SuYan（MIT，guliacer）的分享包一致（electron/main/library/archiveStore.ts，schemaVersion 1/2），
// 所以素言导出的包能导进来，这里导出的包素言也能导入。分类体系、作者信息等 SuYan 专有字段不读也不写。
// 不依赖 Electron，Node 测试可以直接加载；上传和写索引在 importers.ts。
import fs from 'node:fs';
import JSZip from 'jszip';
import type { MaterialItem } from '../../src/materials/library.ts';
import { isImageMediaFile, isVideoMediaFile } from '../../src/materials/mediaFileTypes.ts';
import type { ItemText } from './uploads.ts';

const MAX_PACKAGE_BYTES = 1024 * 1024 * 1024;
const MAX_ENTRY_COUNT = 20000;
const MAX_EXTRACTED_BYTES = 4 * 1024 * 1024 * 1024;

export type ShareEntry = { buffer: Buffer; name: string; text: ItemText; category: string; favorite: boolean; createdAt: string | null };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const optionalText = (value: unknown) => (typeof value === 'string' ? value : '');

// ZIP 里写的解压后大小，用来在真正解压前挡住「压缩炸弹」。
const declaredSize = (file: JSZip.JSZipObject) => (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;

export async function readSharePackage(zipPath: string): Promise<{ entries: ShareEntry[]; missing: string[] }> {
  if (fs.statSync(zipPath).size > MAX_PACKAGE_BYTES) throw new Error('分享包超过 1GB，请让对方分成几个包导出');
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  } catch {
    throw new Error('分享包文件无法解析，可能已损坏，请让对方重新导出');
  }
  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  if (files.length > MAX_ENTRY_COUNT) throw new Error('分享包里的文件太多，不像正常的分享包');
  if (files.reduce((sum, file) => sum + declaredSize(file), 0) > MAX_EXTRACTED_BYTES) throw new Error('分享包解压后超过 4GB，不像正常的分享包');

  const dataFile = zip.file('data.json');
  if (!dataFile) throw new Error('这不是分享包：缺少 data.json');
  let data: unknown;
  try {
    data = JSON.parse(await dataFile.async('string'));
  } catch {
    throw new Error('分享包的 data.json 不是有效的 JSON');
  }
  if (!isRecord(data) || (data.schemaVersion !== 1 && data.schemaVersion !== 2) || !Array.isArray(data.items)) {
    throw new Error('分享包的数据结构不认识（只支持 schemaVersion 1 或 2）');
  }

  const entries: ShareEntry[] = [];
  const missing: string[] = [];
  for (const raw of data.items) {
    if (!isRecord(raw) || typeof raw.imageFileName !== 'string' || !raw.imageFileName) {
      missing.push('（缺少文件名的条目）');
      continue;
    }
    const name = raw.imageFileName;
    const file = zip.file(`images/${name}`);
    if (!file || (!isImageMediaFile(name) && !isVideoMediaFile(name))) {
      missing.push(name);
      continue;
    }
    entries.push({
      buffer: await file.async('nodebuffer'),
      name,
      text: {
        title: optionalText(raw.title),
        prompt: optionalText(raw.prompt),
        negativePrompt: optionalText(raw.negativePrompt),
        tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : [],
        sourceUrl: optionalText(raw.sourceUrl),
      },
      category: optionalText(raw.category),
      favorite: raw.favorite === true,
      createdAt: typeof raw.createdAt === 'string' && !Number.isNaN(Date.parse(raw.createdAt)) ? raw.createdAt : null,
    });
  }
  return { entries, missing };
}

// files 把条目 id 对应到已经下载好的本机临时文件。先写到临时文件，写完再改名，失败不会留下半个包。
export async function writeSharePackage(items: readonly MaterialItem[], files: ReadonlyMap<string, string>, outputPath: string) {
  const zip = new JSZip();
  const manifestItems = items.map((item) => {
    const imageFileName = `${item.media.sha256}${item.media.ext}`;
    zip.file(`images/${imageFileName}`, fs.createReadStream(files.get(item.id)!));
    return {
      id: item.id,
      title: item.title,
      imageFileName,
      prompt: item.prompt,
      negativePrompt: item.negativePrompt,
      category: item.category || null,
      tags: item.tags,
      promptType: item.media.kind,
      sourceUrl: item.sourceUrl || null,
      favorite: item.favorite,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  });
  zip.file('data.json', JSON.stringify({ schemaVersion: 2, updatedAt: new Date().toISOString(), items: manifestItems }, null, 2));
  const temporary = `${outputPath}.${process.pid}.tmp`;
  try {
    await new Promise<void>((resolve, reject) => {
      zip
        .generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 6 } })
        .pipe(fs.createWriteStream(temporary))
        .on('finish', resolve)
        .on('error', reject);
    });
    fs.renameSync(temporary, outputPath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
