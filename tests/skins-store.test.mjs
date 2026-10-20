import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';

const { exportSkin, handleSkinRequest, installSkin, listSkins, readSkinZip, removeSkin } = await import('../electron/materials/skinStore.ts');

const templateDir = new URL('../themes/_template/', import.meta.url);
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'skins-'));

// 把模板目录打成 zip；patch 改 manifest，extra 往包里加文件，drop 去掉文件。
const templateZip = async ({ patch = {}, extra = {}, drop = [], folder = '' } = {}) => {
  const zip = new JSZip();
  const manifest = { ...JSON.parse(fs.readFileSync(new URL('manifest.json', templateDir), 'utf8')), ...patch };
  zip.file(`${folder}manifest.json`, JSON.stringify(manifest));
  for (const name of ['preview.webp', 'wallpaper.webp', 'icons/star.svg']) {
    if (!drop.includes(name)) zip.file(`${folder}${name}`, fs.readFileSync(new URL(name, templateDir)));
  }
  for (const [name, content] of Object.entries(extra)) zip.file(name, content);
  return zip.generateAsync({ type: 'uint8array' });
};

test('皮肤包：模板能装上，列得出来，同 id 再装是更新，能导出再装回去，能删', async () => {
  const dir = tempDir();
  try {
    const first = await installSkin(dir, await templateZip(), ['anime']);
    assert.deepEqual([first.manifest.id, first.replaced], ['my-skin', false]);
    const second = await installSkin(dir, await templateZip({ patch: { version: '1.0.1' } }), ['anime']);
    assert.equal(second.replaced, true);

    const listed = listSkins(dir);
    assert.deepEqual(listed.errors, []);
    assert.deepEqual(listed.skins.map((skin) => [skin.manifest.id, skin.manifest.version, skin.icons]), [['my-skin', '1.0.1', ['icons/star.svg']]]);
    // 没有残留的临时目录
    assert.deepEqual(fs.readdirSync(path.join(dir, 'skins')), ['my-skin']);

    const exported = await exportSkin(dir, 'my-skin');
    removeSkin(dir, 'my-skin');
    assert.deepEqual(listSkins(dir).skins, []);
    await installSkin(dir, exported, []);
    assert.equal(listSkins(dir).skins[0].manifest.version, '1.0.1');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('皮肤包：manifest 套在一层文件夹里也认', async () => {
  const { manifest, files } = await readSkinZip(await templateZip({ folder: 'my-skin/' }));
  assert.equal(manifest.id, 'my-skin');
  assert.deepEqual([...files.keys()].sort(), ['icons/star.svg', 'manifest.json', 'preview.webp', 'wallpaper.webp']);
});

test('皮肤包：不合法的一律拒掉并说明原因，不落盘', async () => {
  const dir = tempDir();
  const cases = [
    [Buffer.from('not a zip'), /不是有效的 zip/],
    [await templateZip({ extra: { 'evil.js': 'alert(1)' } }), /evil\.js 不合法/],
    [await templateZip({ extra: { 'sub/escape.webp': 'x' } }), /sub\/escape\.webp 不合法/],
    [await templateZip({ extra: { 'icons/sub/x.svg': '<svg/>' } }), /不合法/],
    [await templateZip({ extra: { 'icons/big.svg': Buffer.alloc(201 * 1024) } }), /太大/],
    [await templateZip({ patch: { tokens: { '--accent': 'url(https://evil.example/x)' } } }), /值不合法/],
    [await templateZip({ patch: { tokens: { color: 'red' } } }), /不能改 color/],
    [await templateZip({ drop: ['preview.webp'] }), /缺少 manifest 里写的文件 preview\.webp/],
    [await templateZip({ patch: { id: 'anime' } }), /和内置皮肤重名/],
  ];
  try {
    for (const [bytes, pattern] of cases) await assert.rejects(installSkin(dir, bytes, ['anime']), pattern);
    const noManifest = new JSZip();
    noManifest.file('preview.webp', 'x');
    await assert.rejects(installSkin(dir, await noManifest.generateAsync({ type: 'uint8array' }), []), /找不到 manifest\.json/);
    assert.deepEqual(listSkins(dir).skins, []);
    assert.equal(fs.existsSync(path.join(dir, 'skins')) ? fs.readdirSync(path.join(dir, 'skins')).length : 0, 0);
    // 带 ../ 的条目：JSZip 读包时已规范成包内路径，装上后也只在皮肤目录里
    await installSkin(dir, await templateZip({ extra: { '../escape.webp': 'x' } }), []);
    assert.equal(fs.existsSync(path.join(dir, 'escape.webp')), false);
    assert.equal(fs.existsSync(path.join(dir, 'skins', 'escape.webp')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('皮肤包：手动改坏的皮肤列在 errors 里，不悄悄跳过', async () => {
  const dir = tempDir();
  try {
    await installSkin(dir, await templateZip(), []);
    fs.writeFileSync(path.join(dir, 'skins', 'my-skin', 'manifest.json'), '{"id":"my-skin"');
    assert.deepEqual(listSkins(dir).skins, []);
    assert.equal(listSkins(dir).errors[0].id, 'my-skin');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('skin:// 只给已安装皮肤里合法的文件名', async () => {
  const dir = tempDir();
  try {
    await installSkin(dir, await templateZip(), []);
    const handle = handleSkinRequest(dir);
    const ok = await handle(new Request('skin://my-skin/icons/star.svg'));
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('Content-Type'), 'image/svg+xml');
    assert.equal((await handle(new Request('skin://my-skin/preview.webp'))).headers.get('Content-Type'), 'image/webp');
    for (const url of ['skin://my-skin/manifest.json', 'skin://my-skin/%2e%2e%2f%2e%2e%2fsecret.png', 'skin://my-skin/..%5c..%5csecret.png', 'skin://nope/preview.webp']) {
      assert.equal((await handle(new Request(url))).status, 404, url);
    }
    assert.throws(() => removeSkin(dir, '../x'), /id 不合法/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
