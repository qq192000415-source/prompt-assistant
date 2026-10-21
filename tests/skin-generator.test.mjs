// 拿图生成皮肤：摆法按形状定、配色从图里取、对比度达标、生成的 manifest 能通过皮肤包校验。
import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePixels, contrast, generatedManifest, skinColors, suggestLayout, wallpaperPrompt } from '../src/skins/skinGenerator.ts';
import { buildSkinCss, validateSkinManifest } from '../src/skins/skinPack.ts';

// 造一张图：fill(x, y) 返回 [r, g, b]
const image = (width, height, fill) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = fill(x, y);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
};
const hexRgb = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));

test('暗底红衣的竖图：做靠右立绘、深色界面、主色是红色，按钮白字和正文对比度都达标', () => {
  // 两边是暗墨色，中间一块红色人物
  const info = analyzePixels(image(36, 64, (x, y) => (x > 10 && x < 26 && y > 8 && y < 60 ? [190, 30, 40] : [24, 20, 22])));
  assert.equal(suggestLayout(info), 'right');
  const colors = skinColors(info, { layout: 'right', accent: 0, mode: 'auto' });
  assert.equal(colors.dark, true);
  const [r, g, b] = colors.accent;
  assert.ok(r > g * 2 && r > b * 2, `主色应偏红：${colors.accent}`);
  assert.ok(contrast([255, 255, 255], colors.accent) >= 4.5);
  assert.ok(colors.worstContrast >= 7);
  // 主体找在人物那块
  assert.ok(info.focus.x > 0.3 && info.focus.x < 0.7);
});

test('亮的横图：铺满、浅色界面；可以手动换成深色和别的候选色', () => {
  const info = analyzePixels(image(64, 36, (x) => (x < 20 ? [40, 120, 90] : [200, 215, 230])));
  assert.equal(suggestLayout(info), 'cover');
  assert.equal(skinColors(info, { layout: 'cover', accent: 0, mode: 'auto' }).dark, false);
  assert.equal(skinColors(info, { layout: 'cover', accent: 0, mode: 'dark' }).dark, true);
  assert.ok(info.palette.length >= 2, '绿和蓝两种候选色');
  const second = skinColors(info, { layout: 'cover', accent: 1, mode: 'auto' });
  assert.notDeepEqual(second.accent, skinColors(info, { layout: 'cover', accent: 0, mode: 'auto' }).accent);
});

test('黑白图没有鲜艳颜色时用蓝色兜底，不报错', () => {
  const info = analyzePixels(image(20, 20, (x) => (x < 10 ? [0, 0, 0] : [255, 255, 255])));
  const colors = skinColors(info, { layout: 'cover', accent: 3, mode: 'auto' });
  const [r, , b] = colors.accent;
  assert.ok(b > r);
});

test('生成的 manifest 能通过皮肤包校验，CSS 里有立绘的摆法和主体位置', () => {
  const info = analyzePixels(image(36, 64, (x, y) => (x > 10 && x < 26 ? [190, 30, 40] : [24, 20, 22])), 941 / 1672);
  const manifest = generatedManifest({ id: 'my-abc', name: '魏婴', info, choice: { layout: 'right', accent: 0, mode: 'auto' } });
  const checked = validateSkinManifest(manifest);
  assert.equal(checked.wallpaper.layout, 'right');
  assert.equal(checked.wallpaper.aspect, Number((941 / 1672).toFixed(4)));
  assert.equal(checked.base, 'dark');
  // 立绘底色就是贴界面那侧的边缘色
  assert.deepEqual(hexRgb(checked.wallpaper.base), [24, 20, 22]);
  const css = buildSkinCss(checked, [], (path) => `skin://my-abc/${path}`);
  assert.ok(css.includes('--wallpaper-room-right'));
  const cover = validateSkinManifest(generatedManifest({ id: 'my-def', name: '山水', info, choice: { layout: 'cover', accent: 0, mode: 'light', focus: { x: 0.25, y: 0.7 } } }));
  assert.deepEqual(cover.wallpaper.focus, [25, 70]);
});

test('AI 生成壁纸的提示词：带上描述、风格和适合当背景的构图要求', () => {
  const scene = wallpaperPrompt({ description: '月夜竹林', styles: ['国风水墨'], composition: 'scene' });
  assert.match(scene, /月夜竹林/);
  assert.match(scene, /国风水墨/);
  assert.match(scene, /留出大面积干净/);
  assert.match(wallpaperPrompt({ description: '', styles: [], composition: 'character' }), /全身人物立绘/);
});
