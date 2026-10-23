import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inflateSync } from 'node:zlib';

const { encodePng, importMockupPsd, readProducts, readTemplateFile, saveOrderVersion, savePhotoTemplate, saveProduct } = await import('../electron/materials/customStore.ts');
const { defaultMesh } = await import('../src/custom/warp.ts');
const { startFakeNas } = await import('./helpers/fake-nas.mjs');

const ROOT = '/团队文件-素材/';
const sha = (c) => c.repeat(64);
const layer = (c) => ({ id: c, sha256: sha(c), ext: '.png', width: 10, height: 10, cx: 0.5, cy: 0.5, scale: 1, rotation: 0 });
const layout = (layers) => ({ productId: 'p', sizeCm: 40, facesMode: 'same', front: { background: '#ffffff', layers }, back: { background: '#ffffff', layers: [] } });

test('PNG 编码：头、尺寸、像素按原样（不预乘 alpha）', () => {
  const data = new Uint8ClampedArray([255, 0, 0, 128, 0, 255, 0, 255]);
  const png = encodePng({ width: 2, height: 1, data });
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 2);
  assert.equal(png.readUInt32BE(20), 1);
  const idatLength = png.readUInt32BE(33);
  const raw = inflateSync(png.subarray(41, 41 + idatLength));
  assert.deepEqual([...raw], [0, 255, 0, 0, 128, 0, 255, 0, 255]);
});

test('产品配置：新建、修改，名称和尺寸校验', async () => {
  const nas = await startFakeNas();
  try {
    const created = await saveProduct(nas.config, { name: '方形抱枕', sizes: [50, 40, 45, 40], bleedCm: 0.5, watermark: '' });
    assert.deepEqual(created.sizes, [40, 45, 50]);
    const updated = await saveProduct(nas.config, { id: created.id, name: '方形抱枕带枕芯', sizes: [40], bleedCm: 0.5, watermark: '样图' });
    assert.equal(updated.id, created.id);
    const { products } = await readProducts(nas.config);
    assert.deepEqual(products.map((p) => [p.name, p.watermark]), [['方形抱枕带枕芯', '样图']]);
    await assert.rejects(saveProduct(nas.config, { name: ' ', sizes: [40], bleedCm: 0.5, watermark: '' }), /名称不能为空/);
    await assert.rejects(saveProduct(nas.config, { name: 'x', sizes: [], bleedCm: 0.5, watermark: '' }), /至少要有一个尺寸/);
    await assert.rejects(saveProduct(nas.config, { id: 'gone', name: 'x', sizes: [40], bleedCm: 0.5, watermark: '' }), /被别人删掉/);
  } finally {
    nas.server.close();
  }
});

test('存一版：版本号递增，原图各版共用只传一次，缺原图时不占版本号', async () => {
  const nas = await startFakeNas();
  try {
    const source = { sha256: sha('a'), ext: '.png', bytes: new Uint8Array([1, 2, 3]) };
    const outputs = [{ name: '效果图.jpg', bytes: new Uint8Array([9]) }, { name: '(40cmx40cm)单1.jpg', bytes: new Uint8Array([8]) }];
    const first = await saveOrderVersion(nas.config, { name: '单1', layout: layout([layer('a')]), sources: [source], outputs });
    assert.equal(first.version, 1);
    assert.deepEqual([...nas.files.get(`${ROOT}orders/单1/sources/${sha('a')}.png`)], [1, 2, 3]);
    assert.ok(nas.files.has(`${ROOT}orders/单1/v1/layout.json`));
    assert.ok(nas.files.has(`${ROOT}orders/单1/v1/(40cmx40cm)单1.jpg`));
    // 第二版不再带原图：NAS 上已经有了，照样能存。
    const second = await saveOrderVersion(nas.config, { name: '单1', layout: layout([layer('a')]), sources: [], outputs });
    assert.equal(second.version, 2);
    // 用到一张从没传过的图：报错，版本号不动。
    await assert.rejects(saveOrderVersion(nas.config, { name: '单1', layout: layout([layer('b')]), sources: [], outputs }), /原图没有传上来/);
    assert.equal(JSON.parse(nas.files.get(`${ROOT}orders/单1/order.json`).toString()).versions, 2);
    await assert.rejects(saveOrderVersion(nas.config, { name: '单1', layout: layout([]), sources: [], outputs: [{ name: '../x.jpg', bytes: new Uint8Array() }] }), /文件名/);
    await assert.rejects(saveOrderVersion(nas.config, { name: '  ', layout: layout([]), sources: [], outputs: [] }), /单名不能为空/);
  } finally {
    nas.server.close();
  }
});

test('模板文件只能按白名单读', async () => {
  const nas = await startFakeNas();
  try {
    await assert.rejects(readTemplateFile(nas.config, '../etc', 'under.png'), /模板文件名不对/);
    await assert.rejects(readTemplateFile(nas.config, '00000000-0000-0000-0000-000000000000', 'products.json'), /模板文件名不对/);
  } finally {
    nas.server.close();
  }
});

// 客户的样机 PSD 不进仓库：设 CUSTOM_SAMPLE_PSD=<路径> 时才测导入全流程。
test('导入客户样机 PSD：图层和示例图传到 templates/<id>/，产品里记下几何', { skip: !process.env.CUSTOM_SAMPLE_PSD }, async () => {
  const nas = await startFakeNas();
  try {
    const product = await saveProduct(nas.config, { name: '方形抱枕', sizes: [40, 45, 50], bleedCm: 0.5, watermark: '' });
    const { product: imported, sampleExt } = await importMockupPsd(nas.config, product.id, fs.readFileSync(process.env.CUSTOM_SAMPLE_PSD));
    assert.equal(sampleExt, '.jpg');
    assert.equal(imported.template.width, 1254);
    assert.equal(imported.template.hasSample, true);
    for (const file of ['under.png', 'base.png', 'sample.jpg']) assert.ok(nas.files.has(`${ROOT}templates/${product.id}/${file}`), file);
    assert.equal(nas.files.has(`${ROOT}templates/${product.id}/over.png`), false);
    const under = await readTemplateFile(nas.config, product.id, 'under.png');
    assert.equal(under.readUInt32BE(16), 1254);
  } finally {
    nas.server.close();
  }
});

test('照片样机：照片原样存成 under.jpg，模板不剪贴、四角是网格外框；格式和网格校验', async () => {
  const nas = await startFakeNas();
  try {
    const product = await saveProduct(nas.config, { name: '方形抱枕', sizes: [40], bleedCm: 0.5, watermark: '' });
    const mesh = defaultMesh(1000, 800);
    const saved = await savePhotoTemplate(nas.config, product.id, { bytes: new Uint8Array([7, 7]), ext: '.JPEG', width: 1000, height: 800, mesh });
    assert.deepEqual([...nas.files.get(`${ROOT}templates/${product.id}/under.jpg`)], [7, 7]);
    assert.equal(saved.template.underFile, 'under.jpg');
    assert.equal(saved.template.clipped, false);
    assert.deepEqual(saved.template.smartObject.quad[0], { x: 300, y: 200 });
    assert.deepEqual((await readProducts(nas.config)).products[0].template.smartObject.mesh, mesh);
    assert.ok(await readTemplateFile(nas.config, product.id, 'under.jpg'));
    await assert.rejects(savePhotoTemplate(nas.config, product.id, { bytes: new Uint8Array(), ext: '.gif', width: 1, height: 1, mesh }), /JPG、PNG、WebP/);
    await assert.rejects(savePhotoTemplate(nas.config, product.id, { bytes: new Uint8Array(), ext: '.png', width: 1, height: 1, mesh: mesh.slice(1) }), /网格/);
  } finally {
    nas.server.close();
  }
});
