import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { mutateLibrary, readLibrary } = await import('../electron/materials/libraryStore.ts');
const { dav, davUrl, normalizeBaseUrl, requestTimeoutMs } = await import('../electron/materials/webdav.ts');
const http = await import('node:http');
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

test('NAS 卡住时请求按时失败：等不到响应报超时；includeBody 时读内容卡住也失败，否则响应头到了就不再计时', async () => {
  // 收到请求后：/hang 一直不回；/stall 先回响应头，内容过 600ms 才发完
  const server = http.createServer((request, response) => {
    if (request.url.includes('hang')) return;
    response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    response.write('a');
    setTimeout(() => response.end('b'), 600);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const config = { baseUrl: `http://127.0.0.1:${server.address().port}/`, username: 'u', password: 'p' };
  try {
    const started = Date.now();
    await assert.rejects(dav(config, 'PROPFIND', 'hang', { timeoutMs: 200 }), /NAS 0 秒没有响应（PROPFIND hang）/);
    assert.ok(Date.now() - started < 2000);

    const bounded = await dav(config, 'GET', 'stall', { timeoutMs: 300, includeBody: true });
    await assert.rejects(bounded.text(), { name: 'AbortError' });

    // 不带 includeBody：内容慢慢来也能读完（大视频下载、nas-media 播放）
    const streaming = await dav(config, 'GET', 'stall', { timeoutMs: 300 });
    assert.equal(await streaming.text(), 'ab');
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('上传的超时按大小加时间（最慢 50KB/s），流式上传按 Content-Length 算', () => {
  assert.equal(requestTimeoutMs(undefined), 60_000);
  assert.equal(requestTimeoutMs(new Uint8Array(20 * 1024 * 1024)), 60_000 + 409_600);
  assert.equal(requestTimeoutMs('x'.repeat(51_200)), 61_000);
  assert.equal(requestTimeoutMs({}, { 'Content-Length': String(512_000) }), 70_000);
});

test('按账号分开：子文件夹用邮箱（小写）命名；管理员第一次打开把根下的旧数据整体搬进来，其他账号从空的开始', async () => {
  const { prepareAccountFolder, accountConfig } = await import('../electron/materials/accountFolder.ts');
  const nas = await startFakeNas();
  const root = '/团队文件-素材/';
  try {
    await mutateLibrary(nas.config, addOne('7'));
    nas.files.set(`${root}media/${sha(1)}.png`, Buffer.from('png'));
    nas.files.set(`${root}canvas-history/history.json`, Buffer.from('{"tasks":[]}'));
    nas.files.set(`${root}canvas-templates.json`, Buffer.from('{"templates":[]}'));

    // 其他账号：不搬，自己的库是空的，根下的旧数据原样留着。
    assert.deepEqual(await prepareAccountFolder(nas.config, 'Guest@Example.com', false), []);
    const guest = accountConfig(nas.config, 'Guest@Example.com');
    assert.match(guest.baseUrl, /\/guest%40example\.com\/$/);
    assert.deepEqual((await readLibrary(guest)).library.items, []);
    assert.ok(nas.files.has(`${root}library.json`));

    // 管理员：根下的旧数据搬进自己的文件夹，读到原来的素材；根下不再有。
    const moved = await prepareAccountFolder(nas.config, 'Owner@Example.com', true);
    assert.deepEqual(moved, ['library.json', 'media/', 'canvas-history/', 'canvas-templates.json']);
    const owner = accountConfig(nas.config, 'owner@example.com');
    assert.deepEqual((await readLibrary(owner)).library.items.map((entry) => entry.id), ['7']);
    assert.equal(nas.files.get(`${root}owner@example.com/media/${sha(1)}.png`).toString(), 'png');
    assert.ok(nas.files.has(`${root}owner@example.com/canvas-history/history.json`));
    assert.ok(!nas.files.has(`${root}library.json`) && !nas.files.has(`${root}media/${sha(1)}.png`));
    assert.ok(nas.folders.has(`${root}owner@example.com/thumbs/`));

    // 已有自己的库就不再搬：之后根下又出现的（比如旧版本写的）留在原处。
    await mutateLibrary(nas.config, addOne('8'));
    assert.deepEqual(await prepareAccountFolder(nas.config, 'owner@example.com', true), []);
    assert.deepEqual((await readLibrary(owner)).library.items.map((entry) => entry.id), ['7']);
  } finally {
    nas.server.close();
  }
});

test('搬旧数据时目标已存在就停下，说明搬了哪些、其余还在原处', async () => {
  const { prepareAccountFolder } = await import('../electron/materials/accountFolder.ts');
  const nas = await startFakeNas();
  const root = '/团队文件-素材/';
  try {
    await mutateLibrary(nas.config, addOne('7'));
    nas.files.set(`${root}media/${sha(1)}.png`, Buffer.from('png'));
    nas.files.set(`${root}a@b.com/media/${sha(2)}.png`, Buffer.from('mine'));
    await assert.rejects(prepareAccountFolder(nas.config, 'a@b.com', true), /media\/ 没搬成.*已搬过去的：library\.json；其余还在原处/);
    assert.ok(nas.files.has(`${root}media/${sha(1)}.png`));
    assert.equal(nas.files.get(`${root}a@b.com/media/${sha(2)}.png`).toString(), 'mine');
  } finally {
    nas.server.close();
  }
});

test('绕开代理：假地址网段判断；按指定线路连 NAS 时主机名照旧，地址和出口网卡换成指定的，上传下载、状态码都和 fetch 一样', async () => {
  const { isFakeIp, routedFetch } = await import('../electron/materials/proxyBypass.ts');
  assert.deepEqual(['198.18.0.12', '198.19.255.1', '198.20.0.1', '192.168.1.10'].map(isFakeIp), [true, true, false, false]);

  const nas = await startFakeNas();
  try {
    // 主机名解析不了，只有按线路里的地址才连得上。
    const base = nas.config.baseUrl.replace('127.0.0.1', 'nas.invalid');
    const route = { address: '127.0.0.1', localAddress: '127.0.0.1' };
    const auth = { Authorization: `Basic ${Buffer.from('user:pass').toString('base64')}` };
    const url = (file) => new URL(file, normalizeBaseUrl(base)).toString();

    const body = new Blob([Buffer.from('hello')]).stream();
    const put = await routedFetch(url('a.txt'), { method: 'PUT', headers: { ...auth, 'Content-Length': '5' }, body }, route);
    assert.ok(put.ok);
    const get = await routedFetch(url('a.txt'), { method: 'GET', headers: auth }, route);
    assert.equal(await get.text(), 'hello');
    const missing = await routedFetch(url('b.txt'), { method: 'PROPFIND', headers: { ...auth, Depth: '0' } }, route);
    assert.equal(missing.status, 404);
    const denied = await routedFetch(url('a.txt'), { method: 'GET' }, route);
    assert.equal(denied.status, 401);
  } finally {
    nas.server.close();
  }

  // IPv6 地址按 IPv6 连。
  const server = http.createServer((request, response) => response.end(request.headers.host)).listen(0, '::1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await routedFetch(`http://nas.invalid:${server.address().port}/`, { method: 'GET' }, { address: '::1', localAddress: '::1' });
    assert.equal(await response.text(), `nas.invalid:${server.address().port}`);
  } finally {
    server.close();
  }
});
