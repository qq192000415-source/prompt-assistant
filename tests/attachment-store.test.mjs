import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { accessSync, constants, mkdtempSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const require = createRequire(import.meta.url);
const store = require('../electron/attachmentStore.cjs');

const withTempDir = (run) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-store-'));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const sha = (text) => createHash('sha256').update(text).digest('hex');

test('同内容只存一份，返回原文件名、大小和 sha256', () =>
  withTempDir((root) => {
    const dir = join(root, 'store');
    writeFileSync(join(root, 'a.md'), '# 标题');
    writeFileSync(join(root, 'b.md'), '# 标题');

    const first = store.addFile(dir, join(root, 'a.md'));
    const second = store.addFile(dir, join(root, 'b.md'));

    assert.equal(first.name, 'a.md');
    assert.equal(first.sha256, sha('# 标题'));
    assert.equal(first.size, Buffer.byteLength('# 标题'));
    assert.equal(second.sha256, first.sha256);
    assert.equal(store.readText(dir, first.sha256), '# 标题');
  }));

test('超过 50MB 的文件被拒绝', () =>
  withTempDir((root) => {
    const big = join(root, 'big.bin');
    writeFileSync(big, '');
    truncateSync(big, store.MAX_FILE_BYTES + 1);
    assert.throws(() => store.addFile(join(root, 'store'), big), /超过 50MB/);
  }));

test('非法文件标识被拒绝，不能读写库外路径', () =>
  withTempDir((root) => {
    assert.throws(() => store.readBytes(root, '../secret'), /文件标识无效/);
    assert.throws(() => store.has(root, 'A'.repeat(64)), /文件标识无效/);
  }));

test('写入内容和 sha256 不符时拒绝', () =>
  withTempDir((root) => {
    assert.throws(() => store.writeBytes(root, sha('真的'), Buffer.from('假的')), /不一致/);
    store.writeBytes(root, sha('真的'), Buffer.from('真的'));
    assert.ok(store.has(root, sha('真的')));
  }));

test('生成原文件名的副本：打开用只读，发送用可写', () =>
  withTempDir((root) => {
    const dir = join(root, 'store');
    writeFileSync(join(root, '需求.docx'), 'docx-bytes');
    const meta = store.addFile(dir, join(root, '需求.docx'));

    const openCopy = store.materialize(dir, meta.sha256, meta.name, { readOnly: true, tempRoot: root });
    const shareCopy = store.materialize(dir, meta.sha256, meta.name, { tempRoot: root });

    assert.equal(basename(openCopy), '需求.docx');
    assert.equal(readFileSync(shareCopy, 'utf8'), 'docx-bytes');
    assert.throws(() => accessSync(openCopy, constants.W_OK));
    accessSync(shareCopy, constants.W_OK);
    // 只读副本再次打开时能被覆盖刷新。
    store.materialize(dir, meta.sha256, meta.name, { readOnly: true, tempRoot: root });
    assert.ok(statSync(openCopy).isFile());
  }));

test('副本文件名里的路径分隔符和非法字符被替换', () => {
  assert.equal(store.safeFileName('..\\..\\evil.txt'), '.._.._evil.txt');
  assert.equal(store.safeFileName('a:b?.md'), 'a_b_.md');
  assert.equal(store.safeFileName('..'), 'file');
});
