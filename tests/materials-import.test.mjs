import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';

const { readSharePackage, writeSharePackage } = await import('../electron/materials/sharePackage.ts');
const { readWordDocument } = await import('../electron/materials/wordImport.ts');

const sha = (n) => String(n).padStart(64, '0');
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pa-import-test-'));
const writeZip = async (file, entries) => {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
};

test('分享包：导出再导入，提示词、分类、标签、精选、来源和创建时间都保留', async () => {
  const dir = tempDir();
  try {
    const items = [
      {
        id: 'a',
        title: '晨雾',
        prompt: 'fog',
        negativePrompt: 'blur',
        category: '场景',
        tags: ['写实'],
        favorite: true,
        sourceUrl: 'https://example.com/p/1',
        media: { sha256: sha(1), ext: '.png', kind: 'image', name: 'a.png', size: 3, width: 1, height: 1, hasThumb: true },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 'b',
        title: '短片',
        prompt: '',
        negativePrompt: '',
        category: '',
        tags: [],
        favorite: false,
        sourceUrl: '',
        media: { sha256: sha(2), ext: '.mp4', kind: 'video', name: 'b.mp4', size: 3, width: null, height: null, hasThumb: false },
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
      },
    ];
    fs.writeFileSync(path.join(dir, 'a.bin'), 'AAA');
    fs.writeFileSync(path.join(dir, 'b.bin'), 'BBB');
    const zipPath = path.join(dir, 'share.zip');
    await writeSharePackage(items, new Map([['a', path.join(dir, 'a.bin')], ['b', path.join(dir, 'b.bin')]]), zipPath);
    assert.deepEqual(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp')), []);

    const { entries, missing } = await readSharePackage(zipPath);
    assert.deepEqual(missing, []);
    assert.deepEqual(
      entries.map((entry) => [entry.name, entry.buffer.toString(), entry.text.title, entry.text.prompt, entry.text.negativePrompt, entry.category, entry.favorite, entry.text.sourceUrl, entry.createdAt]),
      [
        [`${sha(1)}.png`, 'AAA', '晨雾', 'fog', 'blur', '场景', true, 'https://example.com/p/1', '2026-01-01T00:00:00.000Z'],
        [`${sha(2)}.mp4`, 'BBB', '短片', '', '', '', false, '', '2026-01-03T00:00:00.000Z'],
      ],
    );
    assert.deepEqual(entries[0].text.tags, ['写实']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('分享包：能读素言（SuYan）导出的包，缺图的条目单独列出', async () => {
  const dir = tempDir();
  try {
    const zipPath = path.join(dir, 'suyan.zip');
    await writeZip(zipPath, {
      'data.json': JSON.stringify({
        schemaVersion: 2,
        updatedAt: '2026-09-10T12:30:45.000Z',
        author: { name: '某人' },
        items: [
          { id: 'x', title: '素言作品', imageFileName: 'x.webp', prompt: 'p', negativePrompt: '', tags: ['t'], categoryId: 'system:portrait', category: '人像', nsfwRating: 'safe', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
          { id: 'y', title: '缺图', imageFileName: 'y.png', prompt: 'q', negativePrompt: '', tags: [], createdAt: 'bad', updatedAt: 'bad' },
        ],
      }),
      'images/x.webp': 'WEBP',
      'knowledge-images/cover.png': 'ignored',
    });
    const { entries, missing } = await readSharePackage(zipPath);
    assert.deepEqual(entries.map((entry) => [entry.name, entry.text.title, entry.category]), [['x.webp', '素言作品', '人像']]);
    assert.deepEqual(missing, ['y.png']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('分享包：损坏的文件和不是分享包的 ZIP 都给出明确提示', async () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, 'broken.zip'), 'not a zip');
    await assert.rejects(readSharePackage(path.join(dir, 'broken.zip')), /无法解析/);
    await writeZip(path.join(dir, 'other.zip'), { 'readme.txt': 'hi' });
    await assert.rejects(readSharePackage(path.join(dir, 'other.zip')), /缺少 data\.json/);
    await writeZip(path.join(dir, 'v9.zip'), { 'data.json': JSON.stringify({ schemaVersion: 9, items: [] }) });
    await assert.rejects(readSharePackage(path.join(dir, 'v9.zip')), /schemaVersion/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Word：图片和紧跟的提示词配成一组，认不出的图片计入跳过数', async () => {
  const dir = tempDir();
  try {
    const docx = path.join(dir, '灵感集.docx');
    await writeZip(docx, {
      'word/document.xml': `<w:document><w:body>
        <w:p><w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:r></w:p>
        <w:p><w:r><w:drawing><a:blip r:embed="rId2"/></w:drawing></w:r></w:p>
        <w:p><w:r><w:t>一位少女在唱片店挑选黑胶唱片，暖色灯光。</w:t></w:r></w:p>
        <w:p><w:r><w:drawing><a:blip r:embed="rId3"/></w:drawing></w:r></w:p>
        <w:p><w:r><w:t>第二段提示词。</w:t></w:r></w:p>
      </w:body></w:document>`,
      'word/_rels/document.xml.rels': `<Relationships>
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image2.jpeg"/>
        <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/missing.png"/>
      </Relationships>`,
      'word/media/image1.png': 'IMG1',
      'word/media/image2.jpeg': 'IMG2',
    });
    const { images, skipped } = await readWordDocument(docx);
    assert.deepEqual(
      images.map((image) => [image.name, image.buffer.toString(), image.text.title, image.text.prompt]),
      [
        ['image1.png', 'IMG1', '灵感集 1 - 一位少女在唱片店挑选黑胶唱片', '一位少女在唱片店挑选黑胶唱片，暖色灯光。'],
        ['image2.jpeg', 'IMG2', '灵感集 1 - 一位少女在唱片店挑选黑胶唱片', '一位少女在唱片店挑选黑胶唱片，暖色灯光。'],
      ],
    );
    assert.equal(skipped, 1);

    fs.writeFileSync(path.join(dir, 'old.doc'), 'not a zip');
    await assert.rejects(readWordDocument(path.join(dir, 'old.doc')), /另存为 \.docx/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
