import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { bezierPatch, makeWarp, warpGrid, withCoonsInterior, defaultMesh, isBorderPoint, warpedBounds } = await import('../src/custom/warp.ts');
const { cmToPx, stripLayout, productionFileName, setJpegDpi } = await import('../src/custom/production.ts');
const { fitLayer, facesFor, imageLayers, isTextLayer, normalizeLayout, printDpi } = await import('../src/custom/layout.ts');
const { normalizeProducts } = await import('../src/custom/product.ts');
const { parseMockupPsd } = await import('../electron/materials/customPsd.ts');
const { writePsdBuffer } = await import('ag-psd');

const near = (actual, expected, eps = 1e-6) => assert.ok(Math.abs(actual - expected) < eps, `${actual} ≈ ${expected}`);

// 均匀网格（控制点等分）的贝塞尔曲面就是恒等映射。
const evenMesh = (w, h) => Array.from({ length: 16 }, (_, i) => ({ x: ((i % 4) / 3) * w, y: (Math.floor(i / 4) / 3) * h }));

test('均匀网格的变形是恒等映射，角点落在四角', () => {
  const mesh = evenMesh(4724, 4724);
  for (const [u, v] of [[0, 0], [0.3, 0.7], [1, 1], [0.5, 0.5]]) {
    const p = bezierPatch(mesh, u, v);
    near(p.x, u * 4724, 1e-6);
    near(p.y, v * 4724, 1e-6);
  }
  const quad = [{ x: 400, y: 450 }, { x: 930, y: 450 }, { x: 930, y: 960 }, { x: 400, y: 960 }];
  const warp = makeWarp({ width: 4724, height: 4724, quad, mesh });
  near(warp(0, 0).x, 400, 1e-6);
  near(warp(1, 1).y, 960, 1e-6);
  near(warp(0.5, 0.5).x, 665, 1e-6);
});

test('自定义网格：变形后图形的外框对齐到智能对象四角（PS 的 Trnf 框的是外框）', () => {
  const mesh = evenMesh(100, 100);
  mesh[0] = { x: -10, y: -20 };
  mesh[15] = { x: 110, y: 120 };
  mesh[5] = { x: 40, y: 40 };
  const quad = [{ x: 200, y: 300 }, { x: 400, y: 300 }, { x: 400, y: 500 }, { x: 200, y: 500 }];
  const grid = warpGrid({ width: 100, height: 100, quad, mesh }, 32);
  assert.equal(grid.length, 33 * 33);
  near(Math.min(...grid.map((p) => p.x)), 200, 1e-6);
  near(Math.max(...grid.map((p) => p.x)), 400, 1e-6);
  near(Math.min(...grid.map((p) => p.y)), 300, 1e-6);
  near(Math.max(...grid.map((p) => p.y)), 500, 1e-6);
  // 左上角控制点是外框的极值，落在四角左上。
  near(grid[0].x, 200, 1e-6);
  near(grid[0].y, 300, 1e-6);
});

test('生产图规格和客户图库一致', () => {
  assert.deepEqual([40, 45, 50].map((cm) => cmToPx(cm)), [4724, 5315, 5906]);
  const strip = stripLayout(40);
  assert.equal(strip.width, 4724);
  assert.equal(strip.height, 9449);
  assert.deepEqual(strip.faces.map((face) => [face.face, face.y, face.rotation]), [['front', 0, 90], ['back', 4725, 90]]);
  assert.equal(productionFileName(45, 'FXBZ37号'), '(45cmx45cm)FXBZ37号.jpg');
  assert.equal(productionFileName(40, ' a/b:c '), '(40cmx40cm)a_b_c.jpg');
  assert.equal(productionFileName(40, ''), '(40cmx40cm)未命名.jpg');
});

test('产品配置归一：坏数据跳过并计数，尺寸去重排序，模板缺字段就当没有模板', () => {
  const { products, dropped } = normalizeProducts({
    products: [
      { id: 'p1', name: ' 方形抱枕 ', sizes: [50, 40, 45, 40, -1, 'x'], template: { width: 10, height: 10, smartObject: { width: 5, height: 5, quad: [] } } },
      { id: '', name: '坏的' },
      'oops',
    ],
  });
  assert.equal(dropped, 2);
  assert.equal(products.products.length, 1);
  const [product] = products.products;
  assert.equal(product.name, '方形抱枕');
  assert.deepEqual(product.sizes, [40, 45, 50]);
  assert.equal(product.bleedCm, 0.5);
  assert.equal(product.template, null);
});

test('没有智能对象的 PSD 直接报出原因', () => {
  const pixel = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255) };
  const buffer = writePsdBuffer({ width: 2, height: 2, children: [{ name: '背景', imageData: pixel }] });
  assert.throws(() => parseMockupPsd(buffer), /没有找到智能对象/);
});

// 客户的样机 PSD 不进仓库：设 CUSTOM_SAMPLE_PSD=<路径> 时才测。
test('客户样机 PSD：智能对象剪贴到抱枕、正片叠底、4×4 网格', { skip: !process.env.CUSTOM_SAMPLE_PSD }, () => {
  const parsed = parseMockupPsd(fs.readFileSync(process.env.CUSTOM_SAMPLE_PSD));
  const { template } = parsed;
  assert.equal(template.width, 1254);
  assert.equal(template.smartObject.width, 4724);
  assert.equal(template.blend, 'multiply');
  assert.equal(template.clipped, true);
  assert.equal(template.smartObject.mesh.length, 16);
  near(template.smartObject.quad[0].x, 398.793, 1e-3);
  assert.equal(parsed.under.data.length, 1254 * 1254 * 4);
  assert.ok(parsed.sample && parsed.sample.data.length > 0);
});

test('JPEG 写成 300dpi：只改 JFIF 头的密度字段', () => {
  const jfif = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);
  const out = setJpegDpi(jfif);
  assert.deepEqual([...out.slice(13, 18)], [1, 0x01, 0x2c, 0x01, 0x2c]);
  assert.deepEqual([...out.slice(18)], [...jfif.slice(18)]);
  assert.equal(jfif[13], 0, '不改原数组');
  const notJfif = Uint8Array.from([1, 2, 3]);
  assert.equal(setJpegDpi(notJfif), notJfif);
});

test('排版：铺满 / 完整显示的比例，两面相同时背面照抄正面，坏图层丢掉', () => {
  assert.deepEqual(fitLayer(2000, 1000, 'cover'), { cx: 0.5, cy: 0.5, scale: 2, rotation: 0 });
  assert.equal(fitLayer(1000, 2000, 'cover').scale, 1);
  assert.equal(fitLayer(1000, 2000, 'contain').scale, 0.5);
  const layer = { id: 'a', sha256: 'a'.repeat(64), ext: '.JPG', width: 10, height: 20, cx: 0.4, cy: 0.6, scale: 1, rotation: 15 };
  const layout = normalizeLayout({ productId: 'p1', sizeCm: 45, front: { layers: [layer, { sha256: 'bad' }] }, back: { background: '#000000', layers: [] } });
  assert.equal(layout.front.layers.length, 1);
  assert.equal(layout.front.layers[0].ext, '.jpg');
  assert.equal(layout.facesMode, 'same');
  assert.equal(facesFor(layout).back, layout.front);
  assert.equal(facesFor({ ...layout, facesMode: 'different' }).back.background, '#000000');
  assert.equal(normalizeLayout({}), null);
});

test('排版：文字图层归一（空文字丢掉、颜色和字号兜底），修过的图记下原图，imageLayers 不含文字', () => {
  const image = { id: 'a', sha256: 'a'.repeat(64), ext: '.png', width: 10, height: 10, cx: 0.5, cy: 0.5, scale: 1, rotation: 0, originalSha256: 'b'.repeat(64), originalExt: '.JPG' };
  const text = { kind: 'text', id: 't', text: '生日快乐', font: 'KaiTi', fontSize: 0.1, color: 'red', strokeColor: '#00ff00', strokeWidth: 0.1, bold: true, cx: 0.5, cy: 0.8, rotation: 0 };
  const layout = normalizeLayout({ productId: 'p', front: { layers: [image, text, { ...text, id: 'empty', text: '  ' }, { ...image, id: 'c', originalSha256: 'bad' }] } });
  const [a, t, c] = layout.front.layers;
  assert.equal(layout.front.layers.length, 3);
  assert.deepEqual([a.originalSha256, a.originalExt], ['b'.repeat(64), '.jpg']);
  assert.ok(isTextLayer(t) && !isTextLayer(a));
  assert.deepEqual([t.text, t.font, t.color, t.strokeColor, t.bold], ['生日快乐', 'KaiTi', '#000000', '#00ff00', true]);
  assert.equal('originalSha256' in c, false);
  assert.deepEqual(imageLayers(layout).map((layer) => layer.id), ['a', 'c']);
});

test('照片样机网格：默认在中间，中间 4 点按 Coons 从四条边插值，均匀网格保持不变', () => {
  const mesh = defaultMesh(1000, 800);
  assert.deepEqual([mesh[0], mesh[15]], [{ x: 300, y: 200 }, { x: 700, y: 600 }]);
  assert.equal([...Array(16).keys()].filter(isBorderPoint).length, 12);
  // 均匀网格的内点本来就是 Coons 插值的结果。
  withCoonsInterior(mesh).forEach((p, i) => { near(p.x, mesh[i].x); near(p.y, mesh[i].y); });
  // 上边中间两个点往上拱 30：内点也往上跟（上面一行跟得多，下面一行跟得少）。
  const bent = mesh.map((p, i) => (i === 1 || i === 2 ? { x: p.x, y: p.y - 30 } : p));
  const inner = withCoonsInterior(bent);
  near(inner[5].y, mesh[5].y - 20);
  near(inner[9].y, mesh[9].y - 10);
  near(inner[5].x, mesh[5].x);
});

test('照片样机：四角取网格外框时，网格控制点原样就是贴图位置', () => {
  const mesh = withCoonsInterior(defaultMesh(1000, 800).map((p, i) => (i === 1 ? { x: p.x, y: p.y - 40 } : p)));
  const { minX, minY, maxX, maxY } = warpedBounds(mesh);
  const quad = [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }];
  const warp = makeWarp({ width: 1000, height: 800, quad, mesh });
  for (const [u, v] of [[0, 0], [0.4, 0.2], [1, 1]]) {
    const a = warp(u, v);
    const b = bezierPatch(mesh, u, v);
    near(a.x, b.x, 1e-6);
    near(a.y, b.y, 1e-6);
  }
});

test('印刷 dpi：原图 2362 像素铺满 40cm 是 150dpi', () => {
  const layer = { id: 'a', sha256: 'a'.repeat(64), ext: '.png', width: 2362, height: 2362, cx: 0.5, cy: 0.5, scale: 1, rotation: 0 };
  assert.equal(printDpi(layer, cmToPx(40)), 150);
  assert.equal(printDpi({ ...layer, scale: 0.5 }, cmToPx(40)), 300);
});
