import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { parseLatestYml, isNewerVersion } = createRequire(import.meta.url)('../electron/portableUpdate.cjs');

test('便携版检查更新：从 latest.yml 读版本和安装包路径，按数字比较版本', () => {
  const yml = "version: 1.9.7\nfiles:\n  - url: 提示词助手安装版1.9.7.exe\n    sha512: abc\npath: 提示词助手安装版1.9.7.exe\nsha512: abc\nreleaseDate: '2026-10-20T12:00:00.000Z'\n";
  assert.deepEqual(parseLatestYml(yml), { version: '1.9.7', path: '提示词助手安装版1.9.7.exe' });
  assert.equal(parseLatestYml('<html>404</html>'), null);
  assert.equal(isNewerVersion('1.9.7', '1.9.6'), true);
  assert.equal(isNewerVersion('1.10.0', '1.9.6'), true);
  assert.equal(isNewerVersion('1.9.6', '1.9.6'), false);
  assert.equal(isNewerVersion('1.9.5', '1.9.6'), false);
});
