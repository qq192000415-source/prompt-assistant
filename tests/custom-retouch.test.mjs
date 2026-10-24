import test from 'node:test';
import assert from 'node:assert/strict';

const { colorStats, compositeMasked, coverCrop, estimateAlignment, matchSeam, transferColors, editWindow, maskBounds, nearestRatio, outpaintPlan, ratioMatches, retouchPrompt, sendSize } = await import('../src/custom/retouch.ts');

// 生成 RGBA：painted(x, y) 为真的像素 alpha=255。
const rgbaMask = (width, height, painted) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (painted(x, y)) data[(y * width + x) * 4 + 3] = 255;
  return data;
};
const filled = (width, height, value) => new Uint8ClampedArray(width * height * 4).fill(value);

test('涂抹外框', () => {
  assert.equal(maskBounds(rgbaMask(10, 10, () => false), 10, 10), null);
  assert.deepEqual(maskBounds(rgbaMask(10, 10, (x, y) => x >= 2 && x <= 4 && y === 7), 10, 10), { x: 2, y: 7, w: 3, h: 1 });
});

test('发给模型的那一块：只用 1:1、3:2、2:3，装得下涂抹、不出图', () => {
  for (const [bounds, width, height] of [
    [{ x: 100, y: 100, w: 50, h: 50 }, 1000, 800],
    [{ x: 0, y: 0, w: 300, h: 40 }, 1000, 800],
    [{ x: 900, y: 700, w: 100, h: 100 }, 1000, 800],
    [{ x: 10, y: 10, w: 40, h: 500 }, 600, 900],
  ]) {
    const win = editWindow(bounds, width, height);
    assert.ok(['1:1', '3:2', '2:3'].includes(win.ratio.label));
    assert.ok(Math.abs(win.w / win.h - win.ratio.value) / win.ratio.value < 0.01, `${win.w}x${win.h}`);
    assert.ok(win.x >= 0 && win.y >= 0 && win.x + win.w <= width && win.y + win.h <= height);
    assert.ok(win.x <= bounds.x && win.y <= bounds.y && win.x + win.w >= bounds.x + bounds.w && win.y + win.h >= bounds.y + bounds.h);
  }
  // 小块涂抹：留上下文至少 64px，取方形。
  assert.deepEqual(editWindow({ x: 500, y: 400, w: 20, h: 20 }, 1000, 800), { x: 436, y: 336, w: 148, h: 148, ratio: editWindow({ x: 500, y: 400, w: 20, h: 20 }, 1000, 800).ratio });
  assert.throws(() => editWindow({ x: 0, y: 0, w: 1000, h: 50 }, 1000, 100), /分两次涂/);
});

test('贴回：涂抹以外逐字节是原图，涂抹中间是结果，边缘渐变', () => {
  const width = 40;
  const height = 30;
  const original = new Uint8ClampedArray(width * height * 4).map((_, index) => (index * 7) % 256);
  const result = filled(width, height, 200);
  const mask = rgbaMask(width, height, (x, y) => x >= 10 && x < 30 && y >= 5 && y < 25);
  const out = compositeMasked(original, result, mask, width, height, 4);
  for (let index = 0; index < width * height; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    const inside = x >= 10 && x < 30 && y >= 5 && y < 25;
    if (!inside) for (let c = 0; c < 4; c += 1) assert.equal(out[index * 4 + c], original[index * 4 + c], `(${x},${y}) 被改了`);
  }
  assert.equal(out[(15 * width + 20) * 4], 200, '中间完全是结果');
  const edge = out[(15 * width + 10) * 4];
  assert.ok(edge !== 200 || original[(15 * width + 10) * 4] === 200, '边缘有过渡');
});

test('扩成方形、发送尺寸、比例检查、居中裁', () => {
  assert.deepEqual(outpaintPlan(800, 600, 0), { side: 800, x: 0, y: 100 });
  assert.deepEqual(outpaintPlan(600, 800, 0.25), { side: 1000, x: 200, y: 100 });
  assert.throws(() => outpaintPlan(500, 500, 0), /已经是方形/);
  assert.deepEqual(sendSize({ w: 3000, h: 2000 }, 1536), { width: 1536, height: 1024 });
  assert.deepEqual(sendSize({ w: 300, h: 200 }, 1536), { width: 300, height: 200 });
  assert.ok(ratioMatches(1.5, 1536, 1024));
  assert.ok(!ratioMatches(1.5, 1254, 1254));
  assert.equal(nearestRatio(1200, 900).label, '3:2');
  assert.equal(nearestRatio(1000, 1100).label, '1:1');
  assert.equal(nearestRatio(700, 1100).label, '2:3');
  assert.deepEqual(coverCrop(1536, 1024, 4 / 3), { x: 86, y: 0, w: 1365, h: 1024 });
});

test('提示词：写明标记颜色，自己写的不能为空', () => {
  assert.match(retouchPrompt('watermark', '#00FF00'), /绿色标记区域.*green marked/s);
  assert.match(retouchPrompt('custom', '#ff0000', '换成白底'), /红色标记区域：换成白底/);
  assert.throws(() => retouchPrompt('custom', '#00ff00', ' '), /先写要改成什么/);
});

test('调色对齐：结果的颜色分布拉到原图上', () => {
  const original = new Uint8ClampedArray([200, 180, 100, 255, 220, 200, 120, 255, 180, 160, 80, 255, 210, 190, 110, 255]);
  // 偏蓝、对比更大的「AI 结果」。
  const result = new Uint8ClampedArray([80, 120, 220, 255, 120, 160, 250, 255, 40, 80, 190, 255, 100, 140, 235, 255]);
  const out = transferColors(result, colorStats(result), colorStats(original));
  const [want, got] = [colorStats(original), colorStats(out)];
  for (let c = 0; c < 3; c += 1) {
    assert.ok(Math.abs(got.mean[c] - want.mean[c]) < 1, `均值 ${c}`);
    assert.ok(Math.abs(got.std[c] - want.std[c]) < 1, `标准差 ${c}`);
  }
  assert.equal(out[3], 255, 'alpha 不动');
  // 只统计没涂的像素：跳过第 0、1 个，均值只按后两个算。
  assert.deepEqual(colorStats(original, 1, (pixel) => pixel < 2).mean, [195, 175, 95]);
});

test('接缝对齐：原图外面紧挨着的 AI 像素拉到原图边缘的颜色，远处不动，原图位置不动', () => {
  const side = 40;
  const ai = new Uint8ClampedArray(side * side * 4).fill(100);
  const [w, h, x, y] = [20, 20, 10, 10];
  const original = new Uint8ClampedArray(w * h * 4).fill(160);
  const out = matchSeam(ai, side, original, w, h, x, y, 3, 8, 2);
  const at = (px, py) => out[(py * side + px) * 4];
  assert.ok(Math.abs(at(20, 9) - 160) < 10, `贴着上边：${at(20, 9)}`);
  assert.ok(Math.abs(at(9, 20) - 160) < 10, `贴着左边：${at(9, 20)}`);
  assert.equal(at(20, 0), 100, '超出影响范围的不动');
  assert.equal(at(20, 20), 100, '原图位置不在这里改（之后整张贴回原图）');
  assert.equal(out[(9 * side + 20) * 4 + 3], 100, 'alpha 不动');
});

test('对齐：模型把原图缩小、挪位、整体调亮后，仍能找回位置', () => {
  // 一张有起伏的「原图」：几个高斯亮斑。
  const pattern = (x, y) => [[30, 20, 12], [70, 55, 18], [45, 70, 9], [85, 15, 7]].reduce((sum, [cx, cy, r]) => sum + 200 * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * r * r)), 20);
  const [rw, rh] = [100, 80];
  const ref = { width: rw, height: rh, data: Float32Array.from({ length: rw * rh }, (_, i) => pattern(i % rw, Math.floor(i / rw))) };
  // 结果：原图按 0.8 缩放放在 (31, 27)，四周是别的内容，整体亮度 ×0.9 + 15。
  const [iw, ih, scale, dx, dy] = [140, 130, 0.8, 31, 27];
  const image = {
    width: iw,
    height: ih,
    data: Float32Array.from({ length: iw * ih }, (_, i) => {
      const u = ((i % iw) - dx) / scale;
      const v = (Math.floor(i / iw) - dy) / scale;
      return u >= 0 && v >= 0 && u < rw && v < rh ? pattern(u, v) * 0.9 + 15 : 60 + 30 * Math.sin(i / 7);
    }),
  };
  const found = estimateAlignment(ref, image, { scale: 1, dx: 20, dy: 25 });
  assert.ok(Math.abs(found.scale - scale) < 0.02, `scale ${found.scale}`);
  assert.ok(Math.abs(found.dx - dx) < 1.5 && Math.abs(found.dy - dy) < 1.5, `位移 ${found.dx}, ${found.dy}`);
  assert.ok(found.score > 0.95, `相关性 ${found.score}`);
});
