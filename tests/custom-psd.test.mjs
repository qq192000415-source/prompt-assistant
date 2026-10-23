import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { BLENDS, blackAndWhite, compositeLayers, curveLut, rasterizeLayer } = await import('../electron/materials/psdComposite.ts');
const { parseMockupPsd } = await import('../electron/materials/customPsd.ts');

const near = (actual, expected, eps = 1) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≈ ${expected}`);
// 1×1 的整幅图层，颜色 [r,g,b,a]（0–255）。
const pixel = (rgba, extra = {}) => ({ name: 'L', left: 0, top: 0, imageData: { width: 1, height: 1, data: new Uint8ClampedArray(rgba) }, ...extra });
const first = (layers) => [...compositeLayers(1, 1, layers).data];

test('混合模式公式（0–1）：正片叠底、滤色、叠加、柔光', () => {
  near(BLENDS.multiply(0.5, 0.5), 0.25, 1e-9);
  near(BLENDS.screen(0.5, 0.5), 0.75, 1e-9);
  near(BLENDS.overlay(0.25, 0.8), 2 * 0.25 * 0.8, 1e-9);
  near(BLENDS.overlay(0.75, 0.2), 1 - 2 * 0.25 * 0.8, 1e-9);
  near(BLENDS['soft light'](0.5, 0.5), 0.5, 1e-9);
  near(BLENDS['linear dodge'](0.7, 0.6), 1, 1e-9);
});

test('图层合成：不透明度、混合模式叠在下面那层上', () => {
  assert.deepEqual(first([pixel([200, 100, 50, 255])]), [200, 100, 50, 255]);
  // 白底上正片叠底 50% 灰 = 50% 灰；不透明度 50% 时一半。
  near(first([pixel([255, 255, 255, 255]), pixel([128, 128, 128, 255], { blendMode: 'multiply' })])[0], 128);
  near(first([pixel([255, 255, 255, 255]), pixel([0, 0, 0, 255], { opacity: 0.5 })])[0], 128);
  // 填充也乘进去。
  near(first([pixel([255, 255, 255, 255]), pixel([0, 0, 0, 255], { fillOpacity: 0.25 })])[0], 191);
});

test('剪贴图层只作用在下面那个普通层的范围里；蒙版按灰度生效', () => {
  const base = { name: 'base', left: 0, top: 0, imageData: { width: 2, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 0]) } };
  const red = { name: 'red', left: 0, top: 0, clipping: true, imageData: { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255]) } };
  const out = [...compositeLayers(2, 1, [base, red]).data];
  assert.deepEqual(out.slice(0, 4), [255, 0, 0, 255]);
  assert.equal(out[7], 0, '剪贴底透明的地方，剪贴层不出现');
  const masked = { ...pixel([0, 0, 0, 255]), mask: { left: 0, top: 0, defaultColor: 255, imageData: { width: 1, height: 1, data: new Uint8ClampedArray([64, 64, 64, 255]) } } };
  near(first([pixel([255, 255, 255, 255]), masked])[0], 255 - 64);
  // 蒙版范围外用默认颜色（0 = 全遮住）。
  const outside = { ...pixel([0, 0, 0, 255]), mask: { left: 5, top: 5, defaultColor: 0, imageData: { width: 1, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255]) } } };
  assert.equal(first([pixel([255, 255, 255, 255]), outside])[0], 255);
});

test('调整图层：色阶（输入 20–252、中间调 0.89）、曲线、黑白，不透明度按比例混合', () => {
  const levels = (opacity = 1) => ({ name: '色阶', opacity, adjustment: { type: 'levels', rgb: { shadowInput: 20, highlightInput: 252, shadowOutput: 0, highlightOutput: 254, midtoneInput: 0.89 } } });
  assert.equal(first([pixel([20, 20, 20, 255]), levels()])[0], 0);
  assert.equal(first([pixel([252, 252, 252, 255]), levels()])[0], 254);
  near(first([pixel([136, 136, 136, 255]), levels()])[0], 254 * Math.pow((136 - 20) / 232, 1 / 0.89));
  near(first([pixel([20, 20, 20, 255]), levels(0.5)])[0], 10);
  const lut = curveLut([{ input: 0, output: 0 }, { input: 128, output: 160 }, { input: 255, output: 255 }]);
  assert.equal(Math.round(lut[128]), 160);
  assert.equal(lut[0], 0);
  assert.equal(Math.round(curveLut([{ input: 0, output: 0 }, { input: 255, output: 255 }])[77]), 77);
  const bw = blackAndWhite({ reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 });
  const out = new Float64Array(3);
  bw(255, 0, 0, out);
  near(out[0], 102);
  bw(255, 255, 0, out);
  near(out[0], 153);
  bw(255, 0, 255, out);
  near(out[0], 204);
  bw(200, 200, 200, out);
  assert.equal(out[0], 200, '灰色不变');
});

test('认不出来的直接报出是哪一层：色相混合、开着的图层样式、不认识的调整；关着的样式不算', () => {
  assert.throws(() => compositeLayers(1, 1, [pixel([0, 0, 0, 255], { name: '色相层', blendMode: 'hue' })]), /「色相层」.*hue/);
  assert.throws(() => compositeLayers(1, 1, [pixel([0, 0, 0, 255], { name: '投影层', effects: { dropShadow: [{ enabled: true }] } })]), /「投影层」.*图层样式/);
  assert.doesNotThrow(() => compositeLayers(1, 1, [pixel([0, 0, 0, 255], { effects: { scale: 1, dropShadow: [{ enabled: false }] } })]));
  assert.throws(() => compositeLayers(1, 1, [pixel([0, 0, 0, 255]), { name: '曝光', adjustment: { type: 'exposure' } }]), /「曝光」.*exposure/);
  assert.throws(() => compositeLayers(1, 1, [pixel([0, 0, 0, 255], { name: '孤儿', clipping: true })]), /「孤儿」.*剪贴/);
});

test('智能对象上面的层：蒙版乘进 alpha，混合模式留给出图', () => {
  const layer = { ...pixel([10, 20, 30, 200]), mask: { left: 0, top: 0, imageData: { width: 1, height: 1, data: new Uint8ClampedArray([128, 128, 128, 255]) } } };
  near(rasterizeLayer(1, 1, layer).data[3], 100);
});

// 客户的第二个样机（叠加、黑白、色阶都剪贴在产品层上，智能对象带透视）不进仓库：设 CUSTOM_SAMPLE_PSD2=<路径> 时才测。
test('客户第二个样机 PSD：调整图层和叠加层合进底图，透视四角读到', { skip: !process.env.CUSTOM_SAMPLE_PSD2 }, () => {
  const parsed = parseMockupPsd(fs.readFileSync(process.env.CUSTOM_SAMPLE_PSD2));
  assert.equal(parsed.template.clipped, true);
  assert.equal(parsed.template.underIncludesBase, true);
  assert.equal(parsed.template.over.length, 0);
  assert.ok(parsed.base);
  assert.notEqual(Math.round(parsed.template.smartObject.quad[0].x), Math.round(parsed.template.smartObject.quad[3].x), '带透视，左边两个角不在一条竖线上');
});
