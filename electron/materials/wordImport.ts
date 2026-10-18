// 导入 Word 图文（.docx）：把文档里的图片和紧挨着它的提示词配成对，同一段提示词下的多张图归为一组。
// 移植自 SuYan（MIT，guliacer）electron/main/library/wordDocumentImport.ts；解析和配对规则在 suyan/wordDocumentImport.ts，原样未改。
// 改动：图片传到 NAS（uploadBuffer）而不是写本机；不依赖 Electron，Node 测试可以直接加载。
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { isImageMediaFile } from '../../src/materials/mediaFileTypes.ts';
import {
  extractWordDocumentBlocks,
  extractWordImageRelationships,
  pairWordDocumentPrompts,
  type WordDocumentPromptPair,
} from './suyan/wordDocumentImport.ts';
import type { ItemText } from './uploads.ts';

const MAX_DOCX_BYTES = 512 * 1024 * 1024;

export type WordImage = { buffer: Buffer; name: string; text: ItemText };

// 只有连续出现、提示词相同的图片才算一组；用全局表会把文档前后两处巧合相同的提示词错并在一起。
function groupWordPromptPairs(promptPairs: readonly WordDocumentPromptPair[]): WordDocumentPromptPair[][] {
  const groups: WordDocumentPromptPair[][] = [];
  for (const promptPair of promptPairs) {
    const previous = groups[groups.length - 1];
    const previousPair = previous?.[previous.length - 1];
    if (previous && previousPair && previousPair.groupId === promptPair.groupId && previousPair.prompt === promptPair.prompt) {
      previous.push(promptPair);
      continue;
    }
    groups.push([promptPair]);
  }
  return groups;
}

function createWordImportTitle(filePath: string, index: number, prompt: string): string {
  const fileName = path.parse(filePath).name.trim() || 'Word 文档';
  const firstPromptLine = prompt.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
  const promptHint = firstPromptLine.replace(/[，。；;,.].*$/u, '').replace(/\s+/g, ' ').slice(0, 18).trim();
  return promptHint ? `${fileName} ${index} - ${promptHint}` : `${fileName} ${index}`;
}

// 读出文档里的「图片 + 提示词」；skipped 是认不出格式或找不到文件的图片数。
export async function readWordDocument(filePath: string): Promise<{ images: WordImage[]; skipped: number }> {
  if (fs.statSync(filePath).size > MAX_DOCX_BYTES) throw new Error('文档超过 512MB');
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  } catch {
    throw new Error('不是有效的 .docx 文件（旧版 .doc 需要先在 Word 里另存为 .docx）');
  }
  const documentFile = zip.file('word/document.xml');
  const relationshipFile = zip.file('word/_rels/document.xml.rels');
  if (!documentFile || !relationshipFile) throw new Error('Word 文档结构不完整，认不出正文里的图片');

  const relationships = new Map(
    extractWordImageRelationships(await relationshipFile.async('string')).map((relationship) => [relationship.id, relationship.target]),
  );
  const groups = groupWordPromptPairs(pairWordDocumentPrompts(extractWordDocumentBlocks(await documentFile.async('string'))));
  const images: WordImage[] = [];
  let skipped = 0;

  for (const [groupIndex, pairs] of groups.entries()) {
    const prompt = pairs.find((pair) => pair.prompt.trim())?.prompt ?? pairs[0]?.prompt ?? '';
    const title = createWordImportTitle(filePath, groupIndex + 1, prompt);
    for (const pair of pairs) {
      const target = relationships.get(pair.imageRelationshipId);
      const imageFile = target ? zip.file(target) : null;
      if (!target || !imageFile || !isImageMediaFile(target)) {
        skipped += 1;
        continue;
      }
      images.push({ buffer: await imageFile.async('nodebuffer'), name: path.posix.basename(target), text: { title, prompt } });
    }
  }
  return { images, skipped };
}
