import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= globalThis;
const store = new Map();
window.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { loadDeletedRecords, loadExportSettings, loadLibraryMode, loadSidebarWidth, loadSyncRecords, saveDeletedRecords } = await import(
  '../src/localState.ts'
);
const { normalizeDesktopSettings } = await import('../src/desktopSettings.ts');

const ago = (days) => new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
const deleted = (id, deletedAt) => ({
  id,
  deletedAt,
  source: 'prompt',
  sourceName: id,
  prompt: { id, title: id, content: id },
});

test('删除记录：丢掉坏数据和超过 30 天的，保存时也不写过期的', () => {
  store.set('prompt-library.deletedRecords.v1', JSON.stringify([deleted('new', ago(1)), deleted('old', ago(31)), { id: 'bad' }]));
  assert.deepEqual(loadDeletedRecords().map((record) => record.id), ['new']);

  saveDeletedRecords([deleted('keep', ago(2)), deleted('expired', ago(40))]);
  assert.deepEqual(JSON.parse(store.get('prompt-library.deletedRecords.v1')).map((record) => record.id), ['keep']);
});

test('同步记录：只认合法的 action/status，按时间倒序', () => {
  store.set(
    'prompt-library.syncRecords.v1',
    JSON.stringify([
      { id: 'a', action: 'auto', status: 'success', message: '', createdAt: ago(3) },
      { id: 'b', action: 'manual', status: 'error', message: '', createdAt: ago(1) },
      { id: 'c', action: 'vps', status: 'success', message: '', createdAt: ago(1) },
    ]),
  );
  assert.deepEqual(loadSyncRecords().map((record) => record.id), ['b', 'a']);
});

test('本机设置读坏了或越界时退回默认值', () => {
  store.set('prompt-library.exportSettings.v1', '{坏的 JSON');
  assert.deepEqual(loadExportSettings(), { mode: 'download', pathHint: '' });

  store.set('prompt-library.sidebarWidth.v1', '9999');
  assert.equal(loadSidebarWidth(), 420);

  store.set('prompt-library.libraryMode.v1', 'other');
  assert.equal(loadLibraryMode(), 'prompts');
  store.set('prompt-library.libraryMode.v1', 'materials');
  assert.equal(loadLibraryMode(), 'materials');
});

test('桌面设置：透明度夹在 0.25–1，非法关闭行为沿用原值，坐标缺失时保留原坐标', () => {
  const fallback = { closeBehavior: 'tray', floatingIcon: { enabled: false, opacity: 0.5, x: 10, y: 20 } };
  const settings = normalizeDesktopSettings({ closeBehavior: 'explode', floatingIcon: { opacity: 0.01, y: 'x' } }, fallback);

  assert.deepEqual(settings, { closeBehavior: 'tray', floatingIcon: { enabled: false, opacity: 0.25, x: 10, y: null } });
});
