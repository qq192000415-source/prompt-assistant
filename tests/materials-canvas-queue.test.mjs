import test from 'node:test';
import assert from 'node:assert/strict';

const { createCanvasQueue, isRetryable } = await import('../electron/materials/canvasQueue.ts');
const { deleteHistoryTasks, markSavedToLibrary, mutateHistory, normalizeHistory, readHistory, recordSlot, HISTORY_FILE } = await import('../electron/materials/canvasHistory.ts');
const { startFakeNas } = await import('./helpers/fake-nas.mjs');

const meta = (prompt = '猫') => ({
  model: 'grok-imagine-image',
  prompt,
  negativePrompt: '',
  params: { size: '1024x1024', ratio: '1:1', quality: 'auto', outputFormat: 'png', background: 'opaque', mediaType: 'image' },
  origin: null,
  referenceCount: 0,
});
const sha = (n) => String(n).padStart(64, '0');
const flush = () => new Promise((resolve) => setImmediate(resolve));
const statuses = (queue) => queue.snapshot().map((task) => task.slots.map((slot) => slot.status).join(','));

// 可控的生图：每次调用登记一个待决的 Promise，测试里手动让它成功或失败。
function controlledQueue({ concurrency = 2, retries = 0 } = {}) {
  const calls = [];
  const persisted = [];
  const failures = [];
  const queue = createCanvasQueue({
    generate: (payload) =>
      new Promise((resolve, reject) => {
        calls.push({ payload, resolve, reject });
      }),
    persist: async (task, slot, generated) => {
      persisted.push([task.prompt, slot.index, generated.dataUrl]);
      return { sha256: sha(persisted.length), ext: '.png', kind: 'image', size: 1, width: 1, height: 1, hasThumb: true };
    },
    recordFailure: async (task, slot) => {
      failures.push([task.prompt, slot.index, slot.error]);
    },
    limits: () => ({ concurrency, retries }),
    onChange: () => {},
    wait: async () => {},
  });
  return { queue, calls, persisted, failures };
}

const done = (call, dataUrl = 'data:image/png;base64,AA==') => call.resolve({ dataUrl, revisedPrompt: null, mediaType: 'image' });

test('并发上限：同时只跑 2 个槽位，先提交的先跑，每张图单独请求', async () => {
  const { queue, calls, persisted } = controlledQueue({ concurrency: 2 });
  queue.submit(meta('第一批'), { prompt: '第一批', n: 3 }, 3);
  queue.submit(meta('第二批'), { prompt: '第二批', n: 1 }, 1);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.payload.n === 1 && call.payload.prompt === '第一批'));
  assert.deepEqual(statuses(queue), ['queued', 'running,running,queued']);

  done(calls[0]);
  await flush();
  assert.equal(calls.length, 3);
  assert.equal(calls[2].payload.prompt, '第一批');
  done(calls[1]);
  done(calls[2]);
  await flush();
  assert.equal(calls[3].payload.prompt, '第二批');
  done(calls[3]);
  await flush();
  assert.deepEqual(statuses(queue), ['done', 'done,done,done']);
  assert.equal(persisted.length, 4);
  assert.equal(queue.running(), 0);
});

test('一张失败不连累同批其它图；失败的单独重试，只重新生成那一张', async () => {
  const { queue, calls, failures } = controlledQueue({ concurrency: 4, retries: 0 });
  const id = queue.submit(meta(), { prompt: '猫' }, 2);
  done(calls[0]);
  calls[1].reject(new Error('远程 AI 请求失败，状态码 400。原因：bad size'));
  await flush();
  assert.deepEqual(statuses(queue), ['done,failed']);
  assert.match(failures[0][2], /状态码 400/);

  queue.retry(id, 1);
  assert.equal(calls.length, 3);
  // 重试前换了模型：任务记的是实际生成用的模型。
  calls[2].resolve({ dataUrl: 'data:image/png;base64,AA==', revisedPrompt: null, mediaType: 'image', model: 'grok-imagine-image-2.0' });
  await flush();
  assert.deepEqual(statuses(queue), ['done,done']);
  assert.equal(queue.snapshot()[0].model, 'grok-imagine-image-2.0');
  assert.throws(() => queue.retry(id, 0), /不需要重试/);
});

test('自动重试：临时失败（超时、断网、5xx、限流）按次数重试，400 类直接失败', async () => {
  assert.equal(isRetryable(Object.assign(new Error('图像生成请求超时，服务商可能仍在处理并扣费。'), { code: 'AI_REMOTE_TIMEOUT' })), true);
  assert.equal(isRetryable(new Error('远程 AI 请求失败，状态码 503。')), true);
  assert.equal(isRetryable(new Error('远程 AI 请求失败，状态码 429。')), true);
  assert.equal(isRetryable(new Error('fetch failed')), true);
  assert.equal(isRetryable(new Error('远程 AI 请求失败，状态码 401。原因：invalid key')), false);
  assert.equal(isRetryable(Object.assign(new Error('x'), { code: 'AI_REFERENCE_IMAGE_TOO_LARGE' })), false);

  const { queue, calls, failures } = controlledQueue({ concurrency: 1, retries: 2 });
  queue.submit(meta(), { prompt: '猫' }, 1);
  calls[0].reject(new Error('fetch failed'));
  await flush();
  assert.equal(calls.length, 2);
  assert.match(queue.snapshot()[0].slots[0].error, /第 1 次失败.*正在重试/);
  calls[1].reject(new Error('远程 AI 请求失败，状态码 502。'));
  await flush();
  calls[2].reject(new Error('远程 AI 请求失败，状态码 502。'));
  await flush();
  assert.equal(calls.length, 3);
  const [slot] = queue.snapshot()[0].slots;
  assert.deepEqual([slot.status, slot.attempts], ['failed', 3]);
  assert.equal(failures.length, 1);
});

test('取消：排队中的直接取消，运行中的立刻释放位置，迟到的结果丢掉；之后还能单独重试', async () => {
  const { queue, calls, persisted } = controlledQueue({ concurrency: 1 });
  const first = queue.submit(meta('一'), { prompt: '一' }, 1);
  const second = queue.submit(meta('二'), { prompt: '二' }, 2);
  assert.equal(calls.length, 1);

  queue.cancel(first);
  // 运行中的被取消后位置让给下一个任务。
  assert.equal(calls.length, 2);
  assert.equal(calls[1].payload.prompt, '二');
  done(calls[0]);
  await flush();
  assert.deepEqual(persisted, []);
  assert.equal(queue.snapshot().find((task) => task.id === first).slots[0].status, 'canceled');

  queue.cancel(second);
  assert.deepEqual(statuses(queue), ['canceled,canceled', 'canceled']);
  assert.equal(queue.running(), 0);

  queue.retry(first, 0);
  done(calls[2]);
  await flush();
  assert.equal(queue.snapshot().find((task) => task.id === first).slots[0].status, 'done');
  assert.throws(() => queue.dismiss('missing') ?? queue.cancel('missing'), /不在队列里/);
});

test('存进历史失败时图留在内存里，界面还能存入素材库或另存为', async () => {
  const calls = [];
  const queue = createCanvasQueue({
    generate: () => new Promise((resolve) => calls.push(resolve)),
    persist: async () => {
      throw new Error('NAS 连不上');
    },
    recordFailure: async () => {},
    limits: () => ({ concurrency: 1, retries: 0 }),
    onChange: () => {},
  });
  const id = queue.submit(meta(), { prompt: '猫' }, 1);
  calls[0]({ dataUrl: 'data:image/png;base64,AA==', revisedPrompt: '改写', mediaType: 'image' });
  await flush();
  await flush();
  const [slot] = queue.snapshot()[0].slots;
  assert.deepEqual([slot.status, slot.media, slot.dataUrl, slot.revisedPrompt], ['done', null, 'data:image/png;base64,AA==', '改写']);
  assert.match(slot.error, /没存进 NAS 的生成历史：NAS 连不上/);
  queue.dismiss(id);
  assert.equal(queue.snapshot().length, 0);
});

test('生成历史：槽位逐个写进同一个任务（重试覆盖），存入素材库有标记，删任务时只清理没人用的文件', () => {
  const now = '2026-10-18T00:00:00.000Z';
  const base = { id: 't1', createdAt: now, ...meta('猫'), total: 2 };
  const media = (n) => ({ sha256: sha(n), ext: '.png', kind: 'image', size: 1, width: 1, height: 1, hasThumb: true });
  let history = normalizeHistory(null).history;
  history = recordSlot(history, base, { index: 1, status: 'failed', media: null, revisedPrompt: null, error: '超时', attempts: 3, savedToLibrary: false }, now);
  history = recordSlot(history, base, { index: 0, status: 'done', media: media(1), revisedPrompt: null, error: '', attempts: 1, savedToLibrary: false }, now);
  history = recordSlot(history, base, { index: 1, status: 'done', media: media(2), revisedPrompt: null, error: '', attempts: 1, savedToLibrary: false }, now);
  history = recordSlot(history, { ...base, id: 't2' }, { index: 0, status: 'done', media: media(2), revisedPrompt: null, error: '', attempts: 1, savedToLibrary: false }, now);
  history = recordSlot(history, { ...base, model: '换过的模型' }, { index: 1, status: 'done', media: media(2), revisedPrompt: null, error: '', attempts: 1, savedToLibrary: false }, now);
  assert.equal(history.tasks[0].model, '换过的模型');
  assert.deepEqual(history.tasks.map((task) => [task.id, task.slots.map((slot) => slot.status).join(',')]), [['t1', 'done,done'], ['t2', 'done']]);

  history = markSavedToLibrary(history, 't1', 0, now);
  assert.equal(history.tasks[0].slots[0].savedToLibrary, true);

  const { history: remaining, orphaned } = deleteHistoryTasks(history, ['t1'], now);
  assert.deepEqual(remaining.tasks.map((task) => task.id), ['t2']);
  // sha(2) 还被 t2 用着，不能删。
  assert.deepEqual(orphaned.map((entry) => entry.sha256), [sha(1)]);

  const { history: normalized, dropped } = normalizeHistory({ tasks: [{ id: 'ok', createdAt: now, slots: [{ index: 0, status: 'done' }] }, { nope: true }] });
  assert.equal(dropped, 1);
  // 声称生成好了却没有文件的槽位读不懂，丢掉。
  assert.deepEqual(normalized.tasks[0].slots, []);
});

test('生成历史存在 NAS：两台电脑同时写入两边都保留，锁最后都释放', async () => {
  const nas = await startFakeNas();
  try {
    const now = new Date().toISOString();
    const slot = (n) => ({ index: 0, status: 'done', media: { sha256: sha(n), ext: '.png', kind: 'image', size: 1, width: 1, height: 1, hasThumb: true }, revisedPrompt: null, error: '', attempts: 1, savedToLibrary: false });
    await Promise.all([1, 2, 3].map((n) => mutateHistory(nas.config, (history) => ({ history: recordSlot(history, { id: `t${n}`, createdAt: now, ...meta(`p${n}`), total: 1 }, slot(n), now), result: null }))));
    const { history } = await readHistory(nas.config);
    assert.deepEqual(history.tasks.map((task) => task.id).sort(), ['t1', 't2', 't3']);
    assert.equal(nas.locks.size, 0);
    assert.ok([...nas.files.keys()].some((key) => key.endsWith(HISTORY_FILE)));
  } finally {
    nas.server.close();
  }
});

test('生成好但有提醒（比如横竖不对）：槽位照常完成，提醒显示在图下面并写进历史', async () => {
  const { queue, calls, persisted } = controlledQueue();
  queue.submit(meta('横图'), { prompt: '横图', n: 1 }, 1);
  calls[0].resolve({ dataUrl: 'data:image/png;base64,AA==', revisedPrompt: null, mediaType: 'image', warning: '比例不对：选的是 16:9 横版' });
  await flush();
  const [slot] = queue.snapshot()[0].slots;
  assert.equal(slot.status, 'done');
  assert.equal(slot.error, '比例不对：选的是 16:9 横版');
  assert.equal(persisted.length, 1);
});
