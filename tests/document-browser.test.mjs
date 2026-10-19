import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= globalThis;
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { documentKind, documentKindCounts, filterDocumentsByKind, sortDocuments } = await import('../src/documentBrowser.ts');
const { loadDocumentSort, saveDocumentSort } = await import('../src/localState.ts');

const doc = (title, name, size, addedAt) => ({
  id: title,
  kind: 'document',
  title,
  content: '',
  category: '工作资料',
  tags: [],
  favorite: false,
  createdAt: addedAt,
  updatedAt: addedAt,
  file: { name, size, sha256: title.padEnd(64, '0'), addedAt },
});

test('文档类型：按扩展名分成 Word、PDF、Markdown、表格、演示、文本、其他，色块写大写扩展名', () => {
  const cases = [
    ['季度汇报.docx', 'word', 'Word', 'DOCX'],
    ['旧版.DOC', 'word', 'Word', 'DOC'],
    ['合同.pdf', 'pdf', 'PDF', 'PDF'],
    ['说明.md', 'markdown', 'Markdown', 'MD'],
    ['笔记.markdown', 'markdown', 'Markdown', 'MARK'],
    ['数据.xlsx', 'sheet', '表格', 'XLSX'],
    ['名单.csv', 'sheet', '表格', 'CSV'],
    ['路演.pptx', 'slide', '演示', 'PPTX'],
    ['话术.txt', 'text', '文本', 'TXT'],
    ['压缩包.zip', 'other', '其他', 'ZIP'],
    ['没有扩展名', 'other', '其他', 'FILE'],
  ];
  for (const [name, kind, label, ext] of cases) assert.deepEqual(documentKind(name), { kind, label, ext }, name);
});

test('文档排序：最近添加、名称、大小，相同时保持原顺序', () => {
  const items = [
    doc('乙方案', 'b.pdf', 300, '2026-10-02T00:00:00Z'),
    doc('甲方案', 'a.docx', 900, '2026-10-09T00:00:00Z'),
    doc('丙方案', 'c.md', 300, '2026-10-05T00:00:00Z'),
    doc('丁方案', 'd.txt', 300, '2026-10-05T00:00:00Z'),
  ];
  assert.deepEqual(sortDocuments(items, 'recent').map((item) => item.title), ['甲方案', '丙方案', '丁方案', '乙方案']);
  assert.deepEqual(sortDocuments(items, 'size').map((item) => item.title), ['甲方案', '乙方案', '丙方案', '丁方案']);
  assert.deepEqual(sortDocuments(items, 'name').map((item) => item.title), [...items].map((item) => item.title).sort((a, b) => a.localeCompare(b, 'zh-CN')));
  assert.deepEqual(items.map((item) => item.title), ['乙方案', '甲方案', '丙方案', '丁方案'], '不改原数组');
});

test('按类型筛选，类型列表只列出现过的并带数量', () => {
  const items = [doc('一', 'a.docx', 1, '2026-10-01T00:00:00Z'), doc('二', 'b.pdf', 1, '2026-10-01T00:00:00Z'), doc('三', 'c.doc', 1, '2026-10-01T00:00:00Z'), doc('四', 'd', 1, '2026-10-01T00:00:00Z')];
  assert.deepEqual(filterDocumentsByKind(items, 'word').map((item) => item.title), ['一', '三']);
  assert.equal(filterDocumentsByKind(items, 'all').length, 4);
  assert.deepEqual(documentKindCounts(items), [
    { kind: 'word', label: 'Word', count: 2 },
    { kind: 'pdf', label: 'PDF', count: 1 },
    { kind: 'other', label: '其他', count: 1 },
  ]);
});

test('文档排序方式记在本机，乱写的值退回最近添加', () => {
  store.delete('prompt-library.documentSort.v1');
  assert.equal(loadDocumentSort(), 'recent');
  saveDocumentSort('size');
  assert.equal(loadDocumentSort(), 'size');
  store.set('prompt-library.documentSort.v1', 'color');
  assert.equal(loadDocumentSort(), 'recent');
});
