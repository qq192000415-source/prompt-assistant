import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';

const { downloadMarketTheme, fetchMarketIndex, installSkin, listSkins, parseMarketIndex } = await import('../electron/materials/skinStore.ts');

const themesDir = new URL('../themes/', import.meta.url);
const index = JSON.parse(fs.readFileSync(new URL('index.json', themesDir), 'utf8'));

// 起一个本机静态服务：status 为 0 时按 themes/ 目录原样给文件，否则一律返回这个状态码。
const serve = async (status = 0, override = {}) => {
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\/themes\//, '');
    if (status) return res.writeHead(status).end();
    if (override[name]) return res.end(override[name]);
    const file = new URL(name, themesDir);
    if (!fs.existsSync(file)) return res.writeHead(404).end();
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${server.address().port}/themes/`, close: () => server.close() };
};

test('仓库里的主题市场和源文件一致（改了 themes/<id>/ 要重跑 npm run themes:build）', async () => {
  const sourceIds = fs.readdirSync(themesDir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'dist' && !/^[_.]/.test(e.name)).map((e) => e.name).sort();
  assert.deepEqual(index.themes.map((theme) => theme.id), sourceIds);
  assert.deepEqual(parseMarketIndex(index).errors, []);
  for (const theme of index.themes) {
    const bytes = fs.readFileSync(new URL(`dist/${theme.id}.zip`, themesDir));
    assert.equal(bytes.byteLength, theme.size, theme.id);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), theme.sha256, theme.id);
    assert.ok(fs.existsSync(new URL(theme.preview, themesDir)), `${theme.id} 缺预览图`);
    const zip = await JSZip.loadAsync(bytes);
    const sourceFiles = fs.readdirSync(new URL(`${theme.id}/`, themesDir), { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;
    assert.equal(Object.values(zip.files).filter((entry) => !entry.dir).length, sourceFiles, `${theme.id} 的 zip 和源文件数量不一致`);
    assert.equal(await zip.file('manifest.json').async('string'), fs.readFileSync(new URL(`${theme.id}/manifest.json`, themesDir), 'utf8'), `${theme.id} 的 zip 是旧的`);
  }
});

test('市场索引：信息不全的那条单独列进 errors，别的照常', () => {
  const good = index.themes[0];
  const { themes, errors } = parseMarketIndex({
    themes: [good, { ...good, id: 'Bad Id' }, { ...good, id: 'x', sha256: 'nope' }, { ...good, id: 'y', preview: '../../evil.webp' }, { ...good, id: 'z', size: 999999999 }],
  });
  assert.deepEqual(themes.map((theme) => theme.id), [good.id]);
  assert.equal(errors.length, 4);
  assert.throws(() => parseMarketIndex({ nope: [] }), /格式不对/);
});

test('市场来源：镜像不通就读第二个；都不通时写明每个为什么', async () => {
  const down = await serve(503);
  const up = await serve();
  try {
    const result = await fetchMarketIndex([down.base, up.base], fetch);
    assert.equal(result.base, up.base);
    assert.equal(result.themes.length, index.themes.length);
    await assert.rejects(fetchMarketIndex([down.base, 'http://127.0.0.1:1/themes/'], fetch), /主题市场连不上（127\.0\.0\.1:\d+：HTTP 503；127\.0\.0\.1:1：/);
  } finally {
    down.close();
    up.close();
  }
});

test('市场下载：大小和 SHA256 对得上才装，被改过的包拒装', async () => {
  const theme = index.themes.find((entry) => entry.id === 'ocean');
  const tampered = Buffer.from(fs.readFileSync(new URL('dist/ocean.zip', themesDir)));
  tampered[tampered.length - 30] ^= 0xff;
  const good = await serve();
  const evil = await serve(0, { 'dist/ocean.zip': tampered });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'market-'));
  try {
    await assert.rejects(downloadMarketTheme(evil.base, theme, fetch), /对不上/);
    const bytes = await downloadMarketTheme(good.base, theme, fetch);
    await installSkin(dir, bytes, []);
    assert.deepEqual(listSkins(dir).skins.map((skin) => skin.manifest.id), ['ocean']);
  } finally {
    good.close();
    evil.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
