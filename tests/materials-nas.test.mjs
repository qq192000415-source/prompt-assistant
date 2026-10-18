import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { mutateLibrary, readLibrary } = await import('../electron/materials/libraryStore.ts');
const { davUrl, normalizeBaseUrl } = await import('../electron/materials/webdav.ts');
const { exportItems } = await import('../electron/materials/export.ts');
const { exclusive } = await import('../electron/materials/tasks.ts');
const { startFakeNas } = await import('./helpers/fake-nas.mjs');

const sha = (n) => String(n).padStart(64, '0');
const item = (id) => ({
  id,
  title: id,
  prompt: '',
  negativePrompt: '',
  category: '',
  tags: [],
  favorite: false,
  media: { sha256: sha(id), ext: '.png', kind: 'image', name: `${id}.png`, size: 1, width: 1, height: 1, hasThumb: false },
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
});
const addOne = (id) => (library) => ({ library: { ...library, items: [...library.items, item(id)] }, result: id });

test('地址统一成以 / 结尾，中文目录名正确编码', () => {
  assert.equal(normalizeBaseUrl('https://nas.example:5016/团队文件-素材'), 'https://nas.example:5016/%E5%9B%A2%E9%98%9F%E6%96%87%E4%BB%B6-%E7%B4%A0%E6%9D%90/');
  assert.equal(davUrl({ baseUrl: 'https://nas.example/a' }, 'media/x.png'), 'https://nas.example/a/media/x.png');
  assert.throws(() => normalizeBaseUrl('ftp://nas'), /https/);
});

test('NAS 上还没有 library.json 时读到空库', async () => {
  const nas = await startFakeNas();
  try {
    const { library, dropped } = await readLibrary(nas.config);
    assert.deepEqual([library.items, dropped], [[], 0]);
  } finally {
    nas.server.close();
  }
});

test('两台电脑同时写入，两边的改动都保留，锁最后都释放', async () => {
  const nas = await startFakeNas();
  try {
    const results = await Promise.all([mutateLibrary(nas.config, addOne('1')), mutateLibrary(nas.config, addOne('2'))]);
    assert.deepEqual(results.map((entry) => entry.result).sort(), ['1', '2']);
    const { library } = await readLibrary(nas.config);
    assert.deepEqual(library.items.map((entry) => entry.id).sort(), ['1', '2']);
    assert.equal(nas.locks.size, 0);
  } finally {
    nas.server.close();
  }
});

test('library.json 损坏时停止写入，不覆盖原文件，并解锁', async () => {
  const nas = await startFakeNas();
  try {
    nas.files.set('/团队文件-素材/library.json', Buffer.from('{ broken'));
    await assert.rejects(mutateLibrary(nas.config, addOne('1')), /不是有效的 JSON/);
    assert.equal(nas.files.get('/团队文件-素材/library.json').toString(), '{ broken');
    assert.equal(nas.locks.size, 0);
  } finally {
    nas.server.close();
  }
});

test('改动函数出错时不写入，并解锁', async () => {
  const nas = await startFakeNas();
  try {
    await mutateLibrary(nas.config, addOne('1'));
    await assert.rejects(
      mutateLibrary(nas.config, () => {
        throw new Error('这条素材已经不存在');
      }),
      /不存在/,
    );
    assert.deepEqual((await readLibrary(nas.config)).library.items.map((entry) => entry.id), ['1']);
    assert.equal(nas.locks.size, 0);
  } finally {
    nas.server.close();
  }
});

test('导出：文件按标题命名，已有同名文件不覆盖，坏文件逐条报告，附带素材清单', async () => {
  const nas = await startFakeNas();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-export-test-'));
  try {
    const items = [
      { ...item('1'), title: '晨雾', prompt: 'fog' },
      { ...item('2'), title: '晨雾', prompt: 'fog 2' },
      { ...item('3'), title: '丢失的文件' },
    ];
    nas.files.set('/团队文件-素材/library.json', Buffer.from(JSON.stringify({ items })));
    nas.files.set(`/团队文件-素材/media/${sha('1')}.png`, Buffer.from('one'));
    nas.files.set(`/团队文件-素材/media/${sha('2')}.png`, Buffer.from('two'));
    fs.writeFileSync(path.join(dir, '晨雾.png'), 'existing');

    const progress = [];
    const result = await exportItems(nas.config, ['1', '2', '3'], dir, (entry) => progress.push(entry.done));
    assert.equal(result.exported, 2);
    assert.deepEqual(result.failures.map((failure) => failure.name), ['3.png']);
    assert.equal(fs.readFileSync(path.join(dir, '晨雾.png'), 'utf8'), 'existing');
    assert.equal(fs.readFileSync(path.join(dir, '晨雾 (2).png'), 'utf8'), 'one');
    assert.equal(fs.readFileSync(path.join(dir, '晨雾 (3).png'), 'utf8'), 'two');
    assert.equal(fs.existsSync(path.join(dir, '丢失的文件.png')), false);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, '素材清单.json'), 'utf8'));
    assert.deepEqual(manifest.map((entry) => [entry.file, entry.prompt]), [['晨雾 (2).png', 'fog'], ['晨雾 (3).png', 'fog 2']]);
    assert.deepEqual(progress, [0, 1, 2, 3]);
  } finally {
    nas.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('同一时间只能跑一个批量任务', async () => {
  let release;
  const first = exclusive(() => new Promise((resolve) => (release = resolve)));
  await assert.rejects(exclusive(async () => 'second'), /已有一个批量任务/);
  release('done');
  assert.equal(await first, 'done');
  assert.equal(await exclusive(async () => 'after'), 'after');
});

test('密码不对时给出明确提示', async () => {
  const nas = await startFakeNas();
  try {
    await assert.rejects(readLibrary({ ...nas.config, password: 'wrong' }), /用户名或密码不对/);
  } finally {
    nas.server.close();
  }
});
