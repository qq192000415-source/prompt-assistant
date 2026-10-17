const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const sha256Of = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const assertSha = (sha) => {
  if (typeof sha !== 'string' || !SHA256_PATTERN.test(sha)) {
    throw new Error('文件标识无效');
  }
};

const assertSize = (size, name) => {
  if (size > MAX_FILE_BYTES) {
    throw new Error(`“${name}”超过 50MB，不能存入文档库`);
  }
};

const storedPath = (dir, sha) => {
  assertSha(sha);
  return path.join(dir, sha);
};

// 把路径分隔符和 Windows 不允许的字符都换成 _，防止拼出库外路径。
const safeFileName = (name) => {
  const base = String(name || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
  return base && base !== '.' && base !== '..' ? base : 'file';
};

// 按内容存一份，返回 sha256；同内容已存在就不重复写。
const storeBytes = (dir, bytes) => {
  const sha256 = sha256Of(bytes);
  fs.mkdirSync(dir, { recursive: true });
  const target = storedPath(dir, sha256);
  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, bytes);
  }
  return sha256;
};

const addFile = (dir, srcPath) => {
  const name = path.basename(srcPath);
  assertSize(fs.statSync(srcPath).size, name);
  const bytes = fs.readFileSync(srcPath);
  return { name, size: bytes.length, sha256: storeBytes(dir, bytes), addedAt: new Date().toISOString() };
};

// 在软件里改了文本文档：新内容另存一份（旧版本文件不动），返回新的 sha256 和大小。
const addText = (dir, text) => {
  const bytes = Buffer.from(String(text), 'utf8');
  assertSize(bytes.length, '文档');
  return { size: bytes.length, sha256: storeBytes(dir, bytes) };
};

const has = (dir, sha) => fs.existsSync(storedPath(dir, sha));

const readBytes = (dir, sha) => fs.readFileSync(storedPath(dir, sha));

const writeBytes = (dir, sha, bytes) => {
  const buffer = Buffer.from(bytes);
  assertSize(buffer.length, sha);
  if (sha256Of(buffer) !== sha) {
    throw new Error('下载的文件内容和记录不一致，已丢弃');
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(storedPath(dir, sha), buffer);
};

const readText = (dir, sha) => readBytes(dir, sha).toString('utf8').replace(/^﻿/, '');

// 在临时目录生成一份原文件名的副本，用来打开、复制到剪贴板或拖出去。
// readOnly 用于“打开”：提醒用户在外部软件里的修改不会写回文档库。
const materialize = (dir, sha, name, { readOnly = false, tempRoot = os.tmpdir() } = {}) => {
  const source = storedPath(dir, sha);
  const folder = path.join(tempRoot, 'prompt-assistant', readOnly ? 'open' : 'share', sha);
  const target = path.join(folder, safeFileName(name));
  fs.mkdirSync(folder, { recursive: true });
  if (fs.existsSync(target)) {
    fs.chmodSync(target, 0o666);
  }
  fs.copyFileSync(source, target);
  if (readOnly) {
    fs.chmodSync(target, 0o444);
  }
  return target;
};

module.exports = {
  MAX_FILE_BYTES,
  addFile,
  addText,
  has,
  materialize,
  readBytes,
  readText,
  safeFileName,
  writeBytes,
};
