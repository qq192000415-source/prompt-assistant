import test from 'node:test';
import assert from 'node:assert/strict';

const {
  ALL_CATEGORIES,
  UNCATEGORIZED,
  addItems,
  categoryCounts,
  deleteItems,
  emptyLibrary,
  filterGroups,
  groupMaterials,
  normalizeLibrary,
  patchItem,
} = await import('../src/materials/library.ts');
const { isVideoMediaFile, mimeTypeOf } = await import('../src/materials/mediaFileTypes.ts');

const sha = (n) => String(n).padStart(64, '0');
const at = (minutes) => new Date(Date.UTC(2026, 9, 17, 0, minutes)).toISOString();
const item = (id, overrides = {}) => ({
  id,
  title: '',
  prompt: '',
  negativePrompt: '',
  category: '',
  tags: [],
  favorite: false,
  media: { sha256: sha(id), ext: '.png', kind: 'image', name: `${id}.png`, size: 1, width: 10, height: 10, hasThumb: true },
  createdAt: at(Number(id)),
  updatedAt: at(Number(id)),
  ...overrides,
});
const libraryOf = (...items) => ({ ...emptyLibrary(at(0)), items });

test('归一：丢掉坏记录和重复 id，并报告丢了几条', () => {
  const { library, dropped } = normalizeLibrary({
    items: [
      item('1', { prompt: '\r\n  a cat  \r\n\r\n' }),
      item('1'),
      { id: '2', media: { sha256: 'not-a-sha', ext: '.png' } },
      { id: '', media: item('3').media },
      'garbage',
    ],
  });
  assert.equal(library.items.length, 1);
  assert.equal(library.items[0].prompt, 'a cat');
  assert.equal(dropped, 4);
  assert.deepEqual(normalizeLibrary(null), { library: { schemaVersion: 1, updatedAt: new Date(0).toISOString(), items: [] }, dropped: 0 });
});

test('归一：按扩展名纠正视频类型', () => {
  const raw = item('1', { media: { ...item('1').media, ext: '.MP4', kind: 'image' } });
  assert.equal(normalizeLibrary({ items: [raw] }).library.items[0].media.kind, 'video');
});

test('导入：同一个文件只收一次，包括同一批里重复的', () => {
  const library = libraryOf(item('1'));
  const result = addItems(library, [item('2'), item('9', { media: item('1').media }), item('3', { media: item('2').media })], at(5));
  assert.deepEqual(result.added.map((entry) => entry.id), ['2']);
  assert.deepEqual(result.skipped.map((entry) => entry.id), ['9', '3']);
  assert.equal(result.library.items.length, 2);
  assert.equal(result.library.updatedAt, at(5));
});

test('分组：提示词相同的是一组，原图在前，最新的组排最前', () => {
  const groups = groupMaterials([
    item('1', { prompt: 'a cat' }),
    item('2', { prompt: 'a dog' }),
    item('3', { prompt: ' A   CAT ' }),
    item('4'),
    item('5'),
  ]);
  assert.deepEqual(groups.map((group) => group.items.map((entry) => entry.id)), [['5'], ['4'], ['1', '3'], ['2']]);
  assert.equal(groups[2].primary.id, '1');
});

test('修改文字时整组一起改，收藏只改一张', () => {
  const library = libraryOf(item('1', { prompt: 'a cat' }), item('2', { prompt: 'a cat' }), item('3', { prompt: 'a dog' }));
  const retitled = patchItem(library, '1', { title: '  猫  ', category: UNCATEGORIZED, tags: ['猫', ' 猫 ', ''] }, at(9));
  assert.deepEqual(retitled.items.map((entry) => entry.title), ['猫', '猫', '']);
  assert.deepEqual(retitled.items[1].tags, ['猫']);
  assert.equal(retitled.items[1].category, '');
  assert.equal(groupMaterials(retitled.items).length, 2);

  const starred = patchItem(library, '2', { favorite: true }, at(9));
  assert.deepEqual(starred.items.map((entry) => entry.favorite), [false, true, false]);
  assert.throws(() => patchItem(library, 'missing', { title: 'x' }, at(9)), /不存在/);
});

test('删除：只把没人再用的文件报告为可删', () => {
  const shared = item('1').media;
  const library = libraryOf(item('1'), item('2', { media: shared }), item('3'));
  const { library: next, orphaned } = deleteItems(library, ['1', '3'], at(9));
  assert.deepEqual(next.items.map((entry) => entry.id), ['2']);
  assert.deepEqual(orphaned.map((media) => media.sha256), [sha('3')]);
});

test('筛选和分类计数按组算', () => {
  const groups = groupMaterials([
    item('1', { prompt: 'neon street', category: '场景' }),
    item('2', { prompt: 'neon street', category: '场景' }),
    item('3', { prompt: 'portrait', category: '人像', tags: ['暖色'] }),
    item('4', { prompt: 'misc' }),
  ]);
  assert.deepEqual(categoryCounts(groups), [
    { name: ALL_CATEGORIES, count: 3 },
    { name: '场景', count: 1 },
    { name: '人像', count: 1 },
    { name: UNCATEGORIZED, count: 1 },
  ]);
  assert.deepEqual(filterGroups(groups, { query: '暖色', category: ALL_CATEGORIES }).map((group) => group.primary.id), ['3']);
  assert.deepEqual(filterGroups(groups, { query: '', category: UNCATEGORIZED }).map((group) => group.primary.id), ['4']);
  assert.deepEqual(filterGroups(groups, { query: '2.PNG', category: '场景' }).map((group) => group.primary.id), ['1']);
});

test('媒体类型按扩展名判断', () => {
  assert.equal(isVideoMediaFile('clip.MOV'), true);
  assert.equal(isVideoMediaFile('photo.jpg'), false);
  assert.equal(mimeTypeOf('a.JPG'), 'image/jpeg');
  assert.equal(mimeTypeOf('a.xyz'), 'application/octet-stream');
});
