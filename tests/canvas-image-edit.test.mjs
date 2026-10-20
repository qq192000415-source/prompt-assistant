import test from 'node:test';
import assert from 'node:assert/strict';

const { applyHomography, centeredCrop, cropFromAnchor, dragCrop, isConvexQuad, moveCrop, perspectiveOutputSize, pixelCrop, solveHomography, warpPerspective } = await import(
  '../src/materials/imageEdit.ts'
);

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} ≠ ${expected}`);

test('单应矩阵：矩形四角准确映射到斜的四边形四角，中间点落在四边形里', () => {
  const rect = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }];
  const quad = [{ x: 10, y: 20 }, { x: 180, y: 5 }, { x: 200, y: 140 }, { x: 0, y: 120 }];
  const h = solveHomography(rect, quad);
  rect.forEach((point, index) => {
    const mapped = applyHomography(h, point.x, point.y);
    near(mapped.x, quad[index].x, `第 ${index} 角 x`);
    near(mapped.y, quad[index].y, `第 ${index} 角 y`);
  });
  const center = applyHomography(h, 50, 25);
  assert.ok(center.x > 0 && center.x < 200 && center.y > 5 && center.y < 140);
  assert.throws(() => solveHomography(rect, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]), /共线/);
});

test('透视裁剪：输出尺寸取对边平均；整张图的四角原样拉回来像素不变，斜着拍的方块被拉正', () => {
  assert.deepEqual(perspectiveOutputSize([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 120, y: 80 }, { x: -20, y: 80 }]), { width: 120, height: 82 });

  // 4×2 的图，每个像素颜色不同；四边形就是整张图时，输出应和原图一样
  const width = 4;
  const height = 2;
  const data = new Uint8ClampedArray(width * height * 4).map((_, index) => (index * 7) % 256);
  const same = warpPerspective({ data, width, height }, [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }], width, height);
  assert.deepEqual([...same], [...data]);

  // 20×20 白底，中间一个黑色的梯形区域；把梯形拉成 10×10，结果应几乎全黑
  const size = 20;
  const canvas = new Uint8ClampedArray(size * size * 4).fill(255);
  const quad = [{ x: 6, y: 4 }, { x: 14, y: 4 }, { x: 17, y: 16 }, { x: 3, y: 16 }];
  // 用反变换判断像素中心是否在梯形里
  const inverse = solveHomography(quad, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const p = applyHomography(inverse, x + 0.5, y + 0.5);
      if (p.x >= -0.05 && p.x <= 1.05 && p.y >= -0.05 && p.y <= 1.05) canvas.fill(0, (y * size + x) * 4, (y * size + x) * 4 + 3);
    }
  }
  const out = warpPerspective({ data: canvas, width: size, height: size }, quad, 10, 10);
  const dark = [...out].filter((value, index) => index % 4 === 0 && value < 64).length;
  assert.ok(dark >= 90, `拉正后的黑色像素只有 ${dark}/100`);
});

test('四边形凸性：正常顺序可以，拖成交叉的不行', () => {
  assert.equal(isConvexQuad([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]), true);
  assert.equal(isConvexQuad([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }]), false);
});

test('裁剪框：锁比例拉角不出图且比例不变；边上手柄只动一条边；移动不出图', () => {
  // 从 (100, 50) 往右下拉到图外，16:9 锁定
  const locked = cropFromAnchor({ x: 100, y: 50 }, { x: 900, y: 900 }, 16 / 9, 400, 300);
  near(locked.w / locked.h, 16 / 9, '比例');
  assert.ok(locked.x + locked.w <= 400 + 1e-9 && locked.y + locked.h <= 300 + 1e-9);
  assert.deepEqual([locked.x, locked.y], [100, 50]);

  // 往左上拉：锚点在右下
  const back = cropFromAnchor({ x: 100, y: 100 }, { x: 20, y: 60 }, null, 400, 300);
  assert.deepEqual(back, { x: 20, y: 60, w: 80, h: 40 });

  const rect = { x: 50, y: 50, w: 100, h: 100 };
  assert.deepEqual(dragCrop(rect, 'e', { x: 500, y: 0 }, null, 400, 300), { x: 50, y: 50, w: 350, h: 100 });
  assert.deepEqual(dragCrop(rect, 'n', { x: 0, y: 200 }, null, 400, 300), { x: 50, y: 142, w: 100, h: 8 });
  const corner = dragCrop(rect, 'nw', { x: 0, y: 0 }, 1, 400, 300);
  assert.deepEqual(corner, { x: 0, y: 0, w: 150, h: 150 });

  assert.deepEqual(moveCrop(rect, 1000, -1000, 400, 300), { x: 300, y: 0, w: 100, h: 100 });
  assert.deepEqual(centeredCrop(1, 400, 300), { x: 50, y: 0, w: 300, h: 300 });
  assert.deepEqual(pixelCrop({ x: -3.4, y: 10.6, w: 500, h: 20.2 }, 400, 300), { x: 0, y: 11, w: 400, h: 20 });
});
