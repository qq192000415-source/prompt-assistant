import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { updaterCacheDir, installedUpdateLeftovers } = require('../electron/updateCache.cjs');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'update-cache-'));
// 照 electron-updater 实际留下的布局建：pending/安装包 + update-info.json，根目录 installer.exe、current.blockmap。
function fakeCache(dir, pendingVersion) {
  fs.mkdirSync(path.join(dir, 'pending'), { recursive: true });
  const fileName = `提示词助手安装版${pendingVersion}.exe`;
  fs.writeFileSync(path.join(dir, 'pending', fileName), 'x');
  fs.writeFileSync(path.join(dir, 'pending', 'update-info.json'), JSON.stringify({ fileName, sha512: 'x', isAdminRightsRequired: false }));
  fs.writeFileSync(path.join(dir, 'installer.exe'), 'x');
  fs.writeFileSync(path.join(dir, 'current.blockmap'), 'x');
}

test('下载目录：按打包写进 app-update.yml 的 updaterCacheDirName 找', () => {
  const resources = temp();
  try {
    fs.writeFileSync(path.join(resources, 'app-update.yml'), 'owner: x\nrepo: y\nprovider: github\nupdaterCacheDirName: prompt-library-updater\n');
    assert.equal(updaterCacheDir(resources, 'C:\\Local'), path.join('C:\\Local', 'prompt-library-updater'));
    assert.equal(updaterCacheDir(path.join(resources, 'missing'), 'C:\\Local'), '');
    assert.equal(updaterCacheDir(resources, ''), '');
  } finally {
    fs.rmSync(resources, { recursive: true, force: true });
  }
});

test('清理：装上的（不比当前新）连根目录两份一起删，下好还没装的不动', () => {
  const dir = temp();
  try {
    fakeCache(dir, '1.10.1');
    // 当前还是 1.10.0：1.10.1 下好了没装，留给「重启安装」
    assert.deepEqual(installedUpdateLeftovers(dir, '1.10.0'), []);
    // 装上 1.10.1 之后启动：全删
    assert.deepEqual(installedUpdateLeftovers(dir, '1.10.1').sort(), [path.join(dir, 'pending'), path.join(dir, 'installer.exe'), path.join(dir, 'current.blockmap')].sort());
    // 已经是更新的版本（比如手动装了 1.10.2）：旧安装包也删
    assert.equal(installedUpdateLeftovers(dir, '1.10.2').length, 3);

    // 新版本刚启动时安装包被占着，上次只删掉了 update-info.json：pending 也要删
    fakeCache(dir, '1.10.1');
    fs.rmSync(path.join(dir, 'pending', 'update-info.json'));
    assert.equal(installedUpdateLeftovers(dir, '1.10.1').length, 3);

    // 没有 pending 时只清根目录那两份；什么都没有返回空
    fs.rmSync(path.join(dir, 'pending'), { recursive: true });
    assert.deepEqual(installedUpdateLeftovers(dir, '1.10.1').sort(), [path.join(dir, 'installer.exe'), path.join(dir, 'current.blockmap')].sort());
    assert.deepEqual(installedUpdateLeftovers(path.join(dir, 'missing'), '1.10.1'), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
