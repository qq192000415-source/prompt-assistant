import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cache = await import('../electron/materials/canvasCache.ts');
const { createNasMonitor } = await import('../electron/materials/nasMonitor.ts');
const webdav = await import('../electron/materials/webdav.ts');
const { normalizeHistory } = await import('../electron/materials/canvasHistory.ts');
const { startFakeNas } = await import('./helpers/fake-nas.mjs');

const sha = (n) => String(n).padStart(64, '0');
const media = (n) => ({ sha256: sha(n), ext: '.png', kind: 'image', size: 3, width: 1, height: 1, hasThumb: true });
const task = (id) => ({
  id,
  createdAt: '2026-10-20T00:00:00.000Z',
  model: 'm',
  prompt: 'p',
  negativePrompt: '',
  params: { size: '1024x1024', ratio: '1:1', quality: 'auto', outputFormat: 'png', background: 'auto', mediaType: 'image' },
  origin: null,
  referenceCount: 0,
  references: [],
  total: 2,
});
const done = (index, n) => ({ index, status: 'done', media: media(n), revisedPrompt: null, error: '', attempts: 1, savedToLibrary: false });
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-cache-'));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('本机缓存：待上传的存原图和缩略图，合进生成记录；补传后删原图、留缩略图', () => {
  const dir = tempDir();
  try {
    cache.addPending(dir, task('t1'), done(0, 1), { media: Buffer.from('img'), thumb: Buffer.from('jpg') });
    cache.addPending(dir, task('t1'), { index: 1, status: 'failed', media: null, revisedPrompt: null, error: '超时', attempts: 2, savedToLibrary: false });
    // 同一槽位重试后覆盖，不重复
    cache.addPending(dir, task('t1'), done(0, 1), { media: Buffer.from('img'), thumb: Buffer.from('jpg') });
    assert.equal(cache.listPending(dir).length, 2);

    // 画布看到的 = NAS 那份 + 待上传的
    const merged = cache.mergePending(normalizeHistory(null).history, cache.listPending(dir));
    assert.deepEqual(merged.tasks[0].slots.map((slot) => slot.status), ['done', 'failed']);

    // nas-media 先读本机：待上传的原图、缩略图都有；断线时原图用缩略图代替
    assert.ok(cache.localCanvasFile(dir, `canvas-history/media/${sha(1)}.png`));
    assert.ok(cache.localCanvasFile(dir, `canvas-history/thumbs/${sha(1)}.jpg`));
    assert.equal(cache.localCanvasFile(dir, `canvas-history/media/${sha(2)}.png`), null);
    assert.equal(cache.thumbInsteadOf(dir, `canvas-history/media/${sha(1)}.png`), cache.localCanvasFile(dir, `canvas-history/thumbs/${sha(1)}.jpg`));
    assert.equal(cache.readPendingMedia(dir, cache.listPending(dir).find((entry) => entry.slot.media)).toString(), 'img');
    assert.deepEqual(cache.pendingStats(dir), { count: 2, bytes: 3, overLimit: false });

    assert.equal(cache.removePending(dir, (entry) => entry.slot.index === 0), 1);
    assert.equal(cache.localCanvasFile(dir, `canvas-history/media/${sha(1)}.png`), null);
    assert.ok(cache.localCanvasFile(dir, `canvas-history/thumbs/${sha(1)}.jpg`));

    // 最近一次读到的生成历史
    assert.equal(cache.readHistoryCopy(dir), null);
    cache.saveHistoryCopy(dir, merged);
    assert.equal(cache.readHistoryCopy(dir).tasks[0].id, 't1');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('本机缓存清理：缩略图超过 7 天没用过就删，待上传的不删，超过上限只标出来', () => {
  const dir = tempDir();
  try {
    const now = Date.now();
    const old = new Date(now - cache.CACHE_MAX_AGE_MS - 60_000);
    cache.storeThumb(dir, sha(5), Buffer.from('old'));
    cache.storeThumb(dir, sha(6), Buffer.from('new'));
    cache.addPending(dir, task('t9'), done(0, 7), { media: Buffer.from('pending'), thumb: Buffer.from('t') }, old.toISOString());
    for (const n of [5, 7]) fs.utimesSync(path.join(dir, 'thumbs', `${sha(n)}.jpg`), old, old);

    assert.equal(cache.pruneCache(dir, now), 1);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'thumbs')).sort(), [`${sha(6)}.jpg`, `${sha(7)}.jpg`]);
    // 待上传的放了 7 天以上：留着，只标超限
    assert.equal(cache.pendingStats(dir, now).overLimit, true);
    assert.equal(cache.listPending(dir).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('NAS 连接状态：断开后按间隔自动试连，连上后停；重新连接立刻试', async () => {
  const changes = [];
  let reachable = false;
  const monitor = createNasMonitor({
    delays: [20, 40],
    probe: async () => monitor.report(reachable, reachable ? '' : '连不上 NAS'),
    onChange: (status) => changes.push(status.state),
  });
  assert.equal(monitor.status().state, 'unknown');
  monitor.report(false, '连不上 NAS：ECONNREFUSED');
  assert.equal(monitor.status().state, 'disconnected');
  assert.ok(monitor.status().nextRetryAt);

  let probes = 0;
  const counting = createNasMonitor({ delays: [20, 40], probe: async () => (probes += 1), onChange: () => undefined });
  counting.report(false, 'x');
  // 20ms 后试一次，再过 40ms 又一次（机器忙时会晚一点，最多等 2 秒）
  for (let waited = 0; probes < 2 && waited < 2000; waited += 10) await wait(10);
  assert.ok(probes >= 2, `试连了 ${probes} 次`);
  counting.report(true);
  const settled = probes;
  await wait(90);
  assert.equal(probes, settled, '连上后不再试连');

  // 「重新连接」：立刻试，这次通了
  reachable = true;
  const status = await monitor.reconnect();
  assert.equal(status.state, 'connected');
  assert.equal(status.nextRetryAt, null);
  // 断开期间每次排下一次试连也会推一次（界面倒计时要用），状态本身只变了两次
  assert.deepEqual(changes.filter((state, index) => state !== changes[index - 1]), ['disconnected', 'connected']);
});

test('dav() 把每次请求通没通报出去：连不上算断开，401/404 算连上', async () => {
  const reports = [];
  webdav.setReachabilityListener((ok, error) => reports.push([ok, error]));
  const nas = await startFakeNas();
  try {
    assert.equal(await webdav.exists(nas.config, ''), true);
    await assert.rejects(webdav.exists({ ...nas.config, password: 'wrong' }, ''), /用户名或密码不对/);
    const port = nas.server.address().port;
    await new Promise((resolve) => nas.server.close(resolve));
    await assert.rejects(webdav.exists({ ...nas.config, baseUrl: `http://127.0.0.1:${port}/x/` }, ''), (error) => webdav.isUnreachable(error));
    assert.deepEqual(reports.map(([ok]) => ok), [true, true, false]);
    assert.match(reports[2][1], /连不上 NAS/);
  } finally {
    webdav.setReachabilityListener(() => undefined);
    nas.server.close();
  }
});
