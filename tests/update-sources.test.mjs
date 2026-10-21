import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { downloadSources, isStalled, downloadWithFallback, createMirrorProvider } = require('../electron/updateSources.cjs');

test('下载来源：清单里的 https 镜像按顺序在前（最多 6 个），最后是自己的服务器；坏地址、http 不要', () => {
  assert.deepEqual(downloadSources(null), [null]);
  assert.deepEqual(downloadSources({ version: '1.16.0' }), [null]);
  assert.deepEqual(
    downloadSources({ downloadMirrors: ['https://a.example/x.exe', 'http://b.example/x.exe', '不是地址', 'https://c.example/x.exe', 42] }),
    ['https://a.example/x.exe', 'https://c.example/x.exe', null],
  );
  const many = Array.from({ length: 9 }, (_, index) => `https://m${index}.example/x.exe`);
  assert.equal(downloadSources({ downloadMirrors: many }).length, 7);
});

test('太慢就换源：15 秒没进度，或者 20 秒还不到 2MB；国内实测好的镜像 1.7MB/s 不会被误判', () => {
  assert.equal(isStalled({ elapsedMs: 16_000, transferred: 10 * 1024 * 1024, idleMs: 15_000 }), true);
  assert.equal(isStalled({ elapsedMs: 21_000, transferred: 1024 * 1024, idleMs: 1000 }), true);
  assert.equal(isStalled({ elapsedMs: 19_000, transferred: 0, idleMs: 1000 }), false);
  assert.equal(isStalled({ elapsedMs: 21_000, transferred: 21 * 1.7 * 1024 * 1024, idleMs: 500 }), false);
  // 自己的服务器国内约 72KB/s：20 秒约 1.4MB，镜像比它还慢就没必要等
  assert.equal(isStalled({ elapsedMs: 20_000, transferred: 20 * 72 * 1024, idleMs: 500 }), true);
});

test('自定义来源：清单照常从更新服务器读，只把 .exe 的下载地址换成当前在试的镜像，校验值不变', () => {
  const { MirrorProvider, useSource } = createMirrorProvider();
  const provider = new MirrorProvider({ provider: 'custom', url: 'https://updates.example/win' }, { channel: null }, { isUseMultipleRangeRequest: false, platform: 'win32', executor: null });
  const info = { version: '1.16.0', path: '灵匣安装版1.16.0.exe', sha512: 'abc', files: [{ url: '灵匣安装版1.16.0.exe', sha512: 'abc', size: 1 }] };

  useSource(null);
  const own = provider.resolveFiles(info);
  assert.equal(decodeURIComponent(own[0].url.href), 'https://updates.example/win/灵匣安装版1.16.0.exe');

  useSource('https://ghfast.top/https://github.com/o/r/releases/download/v1.16.0/MuseBox-Setup-1.16.0.exe');
  const mirrored = provider.resolveFiles(info);
  assert.equal(mirrored[0].url.href, 'https://ghfast.top/https://github.com/o/r/releases/download/v1.16.0/MuseBox-Setup-1.16.0.exe');
  assert.equal(mirrored[0].info.sha512, 'abc');
});

// 假的 updater：每个来源的表现由 behaviors[来源] 决定；token 按 electron-updater 的 CancellationToken 用法（cancel / cancelled）。
class FakeToken {
  cancelled = false;
  cancel() {
    this.cancelled = true;
    this.onCancel?.();
  }
}
function fakeUpdater(behaviors) {
  const updater = new EventEmitter();
  let current = null;
  const tried = [];
  updater.useSource = (source) => (current = source);
  updater.downloadUpdate = (token) => {
    tried.push(current);
    return behaviors[current ?? 'own'](updater, token);
  };
  updater.tried = tried;
  return updater;
}
const fail = (message) => () => Promise.reject(new Error(message));
const ok = () => Promise.resolve(['file']);
// 一直不给进度，直到被取消
const hang = (_updater, token) => new Promise((_resolve, reject) => (token.onCancel = () => reject(new Error('cancelled'))));
// 每 10ms 报一次进度，300ms 后下完（比 warmupMs 长，验证不会被误判）
const steady = (updater) => new Promise((resolve) => {
  let transferred = 0;
  const timer = setInterval(() => updater.emit('download-progress', { transferred: (transferred += 500) }), 10);
  setTimeout(() => { clearInterval(timer); resolve(['file']); }, 300);
});
const limits = { warmupMs: 200, minBytes: 1000, idleMs: 120 };
const run = (updater, sources) => {
  const logs = [];
  const attempts = [];
  return downloadWithFallback({ updater, sources, useSource: updater.useSource, CancellationToken: FakeToken, log: (level, message) => logs.push(`${level} ${message}`), onAttempt: (a) => attempts.push(a && a.host), limits, checkMs: 10 })
    .then((attempt) => ({ attempt, logs, attempts }), (error) => ({ error, logs, attempts }));
};

test('换源下载：镜像报错换下一个，卡住没进度的取消后换下一个，成功就停；用户界面知道正在试哪个', async () => {
  const a = 'https://a.example/x.exe', b = 'https://b.example/x.exe';
  const updater = fakeUpdater({ [a]: fail('HTTP 404'), [b]: hang, own: ok });
  const { attempt, logs, attempts } = await run(updater, [a, b, null]);
  assert.deepEqual(updater.tried, [a, b, null]);
  assert.equal(attempt.host, '更新服务器');
  assert.deepEqual(attempts, ['a.example', null, 'b.example', null, '更新服务器', null]);
  assert.match(logs.join('\n'), /a\.example 下载失败：HTTP 404[\s\S]*b\.example 下载失败：太慢，换下一个/);
  assert.equal(updater.listenerCount('download-progress'), 0);
});

test('换源下载：有稳定进度的镜像不会被误判取消；全部失败时抛出最后一个错误，自己的服务器不限速', async () => {
  const a = 'https://a.example/x.exe';
  const good = await run(fakeUpdater({ [a]: steady, own: fail('不该轮到') }), [a, null]);
  assert.equal(good.attempt.host, 'a.example');

  // 自己的服务器慢到超过限速也不取消，等它自己结束（这里是报错）
  const slowOwn = (_updater, token) => new Promise((_resolve, reject) => setTimeout(() => reject(new Error(token.cancelled ? '被取消了' : '服务器 500')), 400));
  const bad = await run(fakeUpdater({ [a]: fail('连不上'), own: slowOwn }), [a, null]);
  assert.equal(bad.error.message, '服务器 500');
});
