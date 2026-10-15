import test from 'node:test';
import assert from 'node:assert/strict';

// createId 读的是 window.crypto；Node 自带 crypto.randomUUID。
globalThis.window ??= globalThis;

const {
  appendPromptsToCategoryEnd,
  cleanCloudSnapshotRecords,
  cleanSyncRecords,
  dedupePrompts,
  deriveSubcategoryMap,
  isSampleOnlySnapshot,
  mergeCloudSnapshot,
  reconcileWithCloud,
  stampSnapshot,
} = await import('../src/librarySync.ts');
const { parseCsvPrompts, parseImportedByFormat, parseImportedPrompts, parseTextPrompts, serializePromptsAsCsv, serializePromptsAsText } =
  await import('../src/promptStorage.ts');
const { SAMPLE_PROMPTS } = await import('../src/data.ts');

const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

const prompt = (id, overrides = {}) => ({
  id,
  title: `标题${id}`,
  description: '',
  content: `正文${id}`,
  category: '写作',
  tags: [],
  favorite: false,
  createdAt: ago(60),
  updatedAt: ago(60),
  ...overrides,
});

const snapshot = (overrides = {}) => ({
  prompts: [],
  categories: ['写作'],
  subcategories: {},
  documentCategories: [],
  documentSubcategories: {},
  deletedRecords: [],
  syncRecords: [],
  exportSettings: {},
  ...overrides,
});

test('去重按主文件夹、子标题、标题和正文，忽略首尾空白、连续空白和大小写', () => {
  const items = [
    prompt('a', { title: 'Hello  World', content: 'Body' }),
    prompt('b', { title: ' hello world ', content: 'body' }),
    prompt('c', { title: 'Hello World', content: 'Body', subcategory: '子类' }),
  ];

  assert.deepEqual(dedupePrompts(items).map((item) => item.id), ['a', 'c']);
});

test('新增提示词插到所属主文件夹末尾，不是列表末尾', () => {
  const items = [prompt('a1'), prompt('b1', { category: '编程' }), prompt('a2'), prompt('b2', { category: '编程' })];
  const result = appendPromptsToCategoryEnd(items, [prompt('a3')]);

  assert.deepEqual(result.map((item) => item.id), ['a1', 'b1', 'a2', 'a3', 'b2']);
});

test('云端合并：另一台设备新增的提示词会被保留', () => {
  const local = snapshot({ prompts: [prompt('local')] });
  const cloud = snapshot({ prompts: [prompt('local'), prompt('remote', { updatedAt: ago(5) })] });

  const merged = mergeCloudSnapshot(local, cloud);
  assert.deepEqual(merged.prompts.map((item) => item.id).sort(), ['local', 'remote']);
});

test('云端合并：同一条提示词以较新的修改为准', () => {
  const local = snapshot({ prompts: [prompt('x', { content: '旧', updatedAt: ago(30) })] });
  const cloud = snapshot({ prompts: [prompt('x', { content: '新', updatedAt: ago(5) })] });

  assert.equal(mergeCloudSnapshot(local, cloud).prompts[0].content, '新');
  assert.equal(mergeCloudSnapshot(cloud, local).prompts[0].content, '新');
});

test('云端合并：本地删除过的提示词不会被云端旧数据拉回', () => {
  const deleted = prompt('gone');
  const local = snapshot({
    prompts: [prompt('keep')],
    deletedRecords: [{ id: 'r1', prompt: deleted, deletedAt: ago(10), source: 'prompt', sourceName: '写作' }],
  });
  const cloud = snapshot({ prompts: [prompt('keep'), deleted] });

  const merged = mergeCloudSnapshot(local, cloud);
  assert.deepEqual(merged.prompts.map((item) => item.id), ['keep']);
  assert.equal(merged.deletedRecords.length, 1);
});

test('云端合并：另一台设备已删除的提示词，不会被这台设备的旧副本复活', () => {
  const deleted = prompt('gone');
  const staleLocal = snapshot({ prompts: [prompt('keep'), deleted] });
  const cloud = snapshot({
    prompts: [prompt('keep')],
    deletedRecords: [{ id: 'r1', prompt: deleted, deletedAt: ago(10), source: 'prompt', sourceName: '写作' }],
  });

  assert.deepEqual(mergeCloudSnapshot(staleLocal, cloud).prompts.map((item) => item.id), ['keep']);
});

test('云端合并：删除后又重新编辑过的提示词保留', () => {
  const edited = prompt('back', { updatedAt: ago(1) });
  const local = snapshot({ prompts: [edited] });
  const cloud = snapshot({
    deletedRecords: [{ id: 'r1', prompt: prompt('back'), deletedAt: ago(10), source: 'prompt', sourceName: '写作' }],
  });

  assert.deepEqual(mergeCloudSnapshot(local, cloud).prompts.map((item) => item.id), ['back']);
});

test('同步记录只保留 30 天内、按时间倒序、最多 80 条', () => {
  const records = Array.from({ length: 100 }, (_, index) => ({
    id: `s${index}`,
    action: 'auto',
    status: 'success',
    message: '',
    createdAt: ago(index),
  }));
  records.push({ id: 'old', action: 'auto', status: 'success', message: '', createdAt: ago(31 * 24 * 60) });

  const cleaned = cleanSyncRecords(records);
  assert.equal(cleaned.length, 80);
  assert.equal(cleaned[0].id, 's0');
  assert.ok(!cleaned.some((record) => record.id === 'old'));
});

test('CSV 导入：支持表头、引号内逗号、转义引号和换行', () => {
  const csv = '主文件夹,子文件名称,提示词内容\r\n写作,"标题,一","第一行\n他说""好"""\r\n,,\r\n编程,标题二,内容二';
  const prompts = parseCsvPrompts(csv);

  assert.deepEqual(
    prompts.map(({ category, title, content }) => ({ category, title, content })),
    [
      { category: '写作', title: '标题,一', content: '第一行\n他说"好"' },
      { category: '编程', title: '标题二', content: '内容二' },
    ],
  );
});

test('TXT 导入：能读回导出的“主文件名/子文件名/提示词内容”格式', () => {
  const text = [
    '主文件名：写作',
    '子文件名：润色',
    '提示词内容：',
    '请润色下面的文字',
    '',
    '主文件名：编程',
    '子文件名：审查',
    '提示词内容：',
    '请审查代码',
  ].join('\n');

  const prompts = parseTextPrompts(text);
  assert.deepEqual(
    prompts.map(({ category, title, content }) => ({ category, title, content })),
    [
      { category: '写作', title: '润色', content: '请润色下面的文字' },
      { category: '编程', title: '审查', content: '请审查代码' },
    ],
  );
});

test('导入没有内容时明确报错', () => {
  assert.throws(() => parseCsvPrompts('主文件夹,子文件名称,提示词内容\n'), /没有找到可导入的提示词/);
});

const documentItem = (id, overrides = {}) =>
  prompt(id, {
    kind: 'document',
    content: '',
    category: '项目资料',
    file: { name: `${id}.docx`, size: 10, sha256: 'a'.repeat(64), addedAt: ago(60) },
    ...overrides,
  });

test('文档条目缺少有效文件信息时被丢弃，不会变成空提示词', () => {
  const items = parseImportedPrompts(
    JSON.stringify([
      documentItem('ok'),
      documentItem('bad', { file: { name: 'x.docx', size: 1, sha256: '../evil', addedAt: ago(1) } }),
      { ...documentItem('nofile'), file: undefined },
      prompt('p'),
    ]),
  );

  assert.deepEqual(items.map((item) => item.id), ['ok', 'p']);
  assert.equal(items[0].kind, 'document');
});

test('云端合并：另一台设备新建的文档文件夹保留，且不会混进提示词分类', () => {
  const local = snapshot({ prompts: [prompt('p')] });
  const cloud = snapshot({
    prompts: [prompt('p'), documentItem('d', { updatedAt: ago(5) })],
    documentCategories: ['项目资料', '空文件夹'],
  });

  const merged = mergeCloudSnapshot(local, cloud);
  assert.deepEqual(merged.documentCategories, ['项目资料', '空文件夹']);
  assert.ok(!merged.categories.includes('项目资料'));
  assert.deepEqual(merged.prompts.map((item) => item.id).sort(), ['d', 'p']);
});

test('删除文档文件夹不影响同名的提示词文件夹', () => {
  const cleaned = cleanCloudSnapshotRecords(
    snapshot({
      categories: ['工作'],
      documentCategories: ['工作'],
      deletedRecords: [
        { id: 'r', prompt: documentItem('d', { category: '工作' }), deletedAt: ago(5), source: 'category', sourceName: '工作' },
      ],
    }),
  );

  assert.deepEqual(cleaned.categories, ['工作']);
  assert.deepEqual(cleaned.documentCategories, []);
});

test('导出成 TXT、CSV 再导入，主文件夹、标题、正文不变', () => {
  const items = [
    prompt('a', { category: '写作', title: '带引号', content: '他说"你好"，然后,逗号\n\n空行之后的第二段' }),
    prompt('b', { category: '编程', title: '第二条', content: '多行\n正文' }),
  ];
  const pick = (list) => list.map(({ category, title, content }) => ({ category, title, content }));

  assert.deepEqual(pick(parseImportedByFormat(`﻿${serializePromptsAsCsv(items)}`, 'csv')), pick(items));
  assert.deepEqual(pick(parseImportedByFormat(`﻿${serializePromptsAsText(items)}`, 'txt')), pick(items));
});

test('子分类表合并已存的和条目里出现的，去掉空白和重复', () => {
  const map = deriveSubcategoryMap({ 写作: [' 润色 ', '润色', ''] }, [
    prompt('a', { category: '写作', subcategory: '扩写' }),
    prompt('b', { category: '编程', subcategory: '审查' }),
    prompt('c', { category: '编程' }),
  ]);

  assert.deepEqual(map, { 写作: ['润色', '扩写'], 编程: ['审查'] });
});

test('只有示例数据才算示例快照；删过东西或有自己的条目都不算', () => {
  assert.equal(isSampleOnlySnapshot(snapshot({ prompts: SAMPLE_PROMPTS })), true);
  assert.equal(isSampleOnlySnapshot(snapshot({ prompts: [...SAMPLE_PROMPTS, prompt('mine')] })), false);
  assert.equal(
    isSampleOnlySnapshot(
      snapshot({
        prompts: SAMPLE_PROMPTS,
        deletedRecords: [{ id: 'r', prompt: prompt('x'), deletedAt: ago(1), source: 'prompt', sourceName: 'x' }],
      }),
    ),
    false,
  );
  assert.equal(isSampleOnlySnapshot(snapshot({ prompts: [] })), false);
});

test('登录同步：本机只有示例数据时直接用云端，不把示例合并上去', () => {
  const cloud = snapshot({ prompts: [prompt('cloud')] });
  const { snapshot: result, pullCloudOnly } = reconcileWithCloud(snapshot({ prompts: SAMPLE_PROMPTS }), cloud);

  assert.equal(pullCloudOnly, true);
  assert.deepEqual(result.prompts.map((item) => item.id), ['cloud']);
});

test('登录同步：本机有自己的条目时和云端合并；云端还没有数据时用本机', () => {
  const local = snapshot({ prompts: [prompt('mine')] });
  const merged = reconcileWithCloud(local, snapshot({ prompts: [prompt('cloud')] }));
  assert.equal(merged.pullCloudOnly, false);
  assert.deepEqual(merged.snapshot.prompts.map((item) => item.id).sort(), ['cloud', 'mine']);

  const firstUpload = reconcileWithCloud(local, null);
  assert.equal(firstUpload.pullCloudOnly, false);
  assert.equal(firstUpload.snapshot, local);
});

test('写回云端前记一条同步记录放最前，并清掉过期记录和已删除的条目', () => {
  const record = { id: 'now', action: 'auto', status: 'success', message: '', createdAt: ago(0) };
  const stamped = stampSnapshot(
    snapshot({
      prompts: [prompt('keep'), prompt('gone')],
      deletedRecords: [{ id: 'r', prompt: prompt('gone'), deletedAt: ago(1), source: 'prompt', sourceName: 'gone' }],
      syncRecords: [{ id: 'old', action: 'auto', status: 'success', message: '', createdAt: ago(31 * 24 * 60) }],
    }),
    record,
  );

  assert.deepEqual(stamped.syncRecords.map((item) => item.id), ['now']);
  assert.deepEqual(stamped.prompts.map((item) => item.id), ['keep']);
  assert.ok(Date.parse(stamped.updatedAt) >= Date.now() - 1000);
});
