import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { migrateLegacyUserData } = require('../electron/userDataMigration.cjs');

const withAppData = (run) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-appdata-'));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const makeLegacy = (root, name, marker, ageMinutes) => {
  const storage = join(root, name, 'Local Storage', 'leveldb');
  mkdirSync(storage, { recursive: true });
  const file = join(storage, '000001.log');
  writeFileSync(file, marker);
  writeFileSync(join(root, name, 'desktop-settings.json'), `{"from":"${marker}"}`);
  mkdirSync(join(root, name, 'GPUCache'), { recursive: true });
  const time = new Date(Date.now() - ageMinutes * 60_000);
  utimesSync(file, time, time);
  utimesSync(join(storage), time, time);
  utimesSync(join(root, name, 'Local Storage'), time, time);
};

test('从最近使用过的旧版本目录搬数据，只搬数据不搬缓存，旧目录保留', () =>
  withAppData((root) => {
    makeLegacy(root, '提示词助手1.3.24', 'newest', 1);
    makeLegacy(root, '提示词助手1.3.20', 'older', 60);
    const target = join(root, 'prompt-assistant');

    const from = migrateLegacyUserData(root, target);

    assert.equal(from, join(root, '提示词助手1.3.24'));
    assert.equal(readFileSync(join(target, 'Local Storage', 'leveldb', '000001.log'), 'utf8'), 'newest');
    assert.equal(readFileSync(join(target, 'desktop-settings.json'), 'utf8'), '{"from":"newest"}');
    assert.ok(!existsSync(join(target, 'GPUCache')));
    assert.ok(existsSync(join(root, '提示词助手1.3.24', 'Local Storage')));
  }));

test('新目录已有数据时不再搬，避免覆盖', () =>
  withAppData((root) => {
    makeLegacy(root, '提示词助手1.3.24', 'old', 1);
    const target = join(root, 'prompt-assistant');
    mkdirSync(join(target, 'Local Storage'), { recursive: true });

    assert.equal(migrateLegacyUserData(root, target), null);
    assert.ok(!existsSync(join(target, 'desktop-settings.json')));
  }));

test('没有旧版本目录时什么都不做', () =>
  withAppData((root) => {
    mkdirSync(join(root, '别的软件'), { recursive: true });
    assert.equal(migrateLegacyUserData(root, join(root, 'prompt-assistant')), null);
  }));
