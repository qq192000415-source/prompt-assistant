import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

globalThis.window ??= globalThis;

const { buildSkinCss, skinIconNames, validateSkinManifest } = await import('../src/skins/skinPack.ts');
const { isDarkTheme, normalizeTheme, themeOptions } = await import('../src/lib/theme.ts');

const manifest = (patch = {}) => ({
  id: 'sakura',
  name: '樱花',
  author: '提示词助手',
  version: '1.0.0',
  base: 'light',
  tokens: { '--accent': '#e75480', '--surface': 'rgba(255, 255, 255, 0.72)', '--shadow': '0 10px 28px rgba(0, 0, 0, 0.1)' },
  wallpaper: { file: 'wallpaper.webp', overlay: 'rgba(255, 255, 255, 0.4)' },
  preview: 'preview.webp',
  ...patch,
});

test('皮肤 manifest：合法的照收，note 可省', () => {
  const skin = validateSkinManifest(manifest());
  assert.equal(skin.id, 'sakura');
  assert.equal(skin.note, '');
  assert.deepEqual(skin.wallpaper, { file: 'wallpaper.webp', overlay: 'rgba(255, 255, 255, 0.4)' });
});

test('皮肤 manifest：白名单外的令牌、能注入的值、跳目录的文件名都拒掉', () => {
  const rejects = [
    { id: 'Bad Id' },
    { id: 'x"]{}' },
    { base: 'sepia' },
    { tokens: { 'color': 'red' } },
    { tokens: { '--doc-pdf': 'red' } },
    { tokens: { '--accent': 'url(http://evil.example/x.png)' } },
    { tokens: { '--accent': 'red; } body { display: none' } },
    { tokens: { '--accent': 'red}' } },
    { tokens: { '--accent': 'image-set(a 1x)' } },
    { wallpaper: { file: '../../secret.png' } },
    { wallpaper: { file: 'wall.svg' } },
    { wallpaper: { file: 'wall.webp', overlay: 'url(x)' } },
    { preview: 'sub/preview.webp' },
    { name: '' },
  ];
  for (const patch of rejects) {
    assert.throws(() => validateSkinManifest(manifest(patch)), Error, JSON.stringify(patch));
  }
});

test('皮肤图标：icons/<lucide 名>.svg 走遮罩随文字色，png 保留彩色，放错地方的报错', () => {
  assert.deepEqual(skinIconNames(['icons/star.svg', 'icons/trash-2.png']), [
    { path: 'icons/star.svg', name: 'star', colored: false },
    { path: 'icons/trash-2.png', name: 'trash-2', colored: true },
  ]);
  for (const bad of ['star.svg', 'icons/../x.svg', 'icons/Star.svg', 'icons/star.gif', 'icons/a/b.svg']) {
    assert.throws(() => skinIconNames([bad]), Error, bad);
  }
});

test('皮肤 CSS：令牌、壁纸、图标都限定在这个皮肤下', () => {
  const css = buildSkinCss(validateSkinManifest(manifest()), ['icons/star.svg', 'icons/folder.png'], (path) => `skin://sakura/${path}`);
  const scope = 'html[data-skin="sakura"][data-theme]';
  assert.match(css, /--accent: #e75480;/);
  assert.ok(css.includes(`${scope} body {\n  background: linear-gradient(rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0.4)), url("skin://sakura/wallpaper.webp")`));
  assert.ok(css.includes(`${scope} svg.lucide-star > * {\n  display: none;`));
  assert.ok(css.includes('mask: url("skin://sakura/icons/star.svg") center / contain no-repeat;\n  background: currentColor;'));
  assert.ok(css.includes('background: url("skin://sakura/icons/folder.png") center / contain no-repeat;'));
  // 每条规则都带皮肤作用域，不会漏到别的主题
  for (const selector of css.match(/^[^\s}][^{]*\{/gm)) assert.ok(selector.startsWith(scope), selector);
  assert.throws(() => buildSkinCss(validateSkinManifest(manifest()), [], () => 'x") ; }'), /资源地址不合法/);
});

test('主题选择：skin:<id> 只有皮肤存在时才认，深浅跟着皮肤的 base', () => {
  const skins = [{ id: 'night', name: '夜', note: '', base: 'dark', preview: 'p.webp', css: '' }];
  assert.equal(normalizeTheme('skin:night', skins), 'skin:night');
  assert.equal(normalizeTheme('skin:night'), 'light');
  assert.equal(normalizeTheme('skin:gone', skins), 'light');
  assert.equal(isDarkTheme('skin:night', skins), true);
  assert.deepEqual(themeOptions(skins).map((option) => option.value), ['light', 'dark', 'cream', 'ember', 'skin:night']);
});

test('内置皮肤：每套 manifest 都能通过校验，引用的文件都在，图标文件名合法', () => {
  const root = new URL('../src/skins/builtin/', import.meta.url);
  let dirs = [];
  try {
    dirs = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return;
  }
  for (const dir of dirs) {
    const skin = validateSkinManifest(JSON.parse(readFileSync(new URL(`${dir}/manifest.json`, root), 'utf8')));
    assert.equal(skin.id, dir);
    const files = readdirSync(new URL(`${dir}/`, root));
    assert.ok(files.includes(skin.preview), `${dir} 缺预览图`);
    if (skin.wallpaper) assert.ok(files.includes(skin.wallpaper.file), `${dir} 缺壁纸`);
    let icons = [];
    try {
      icons = readdirSync(new URL(`${dir}/icons/`, root)).map((name) => `icons/${name}`);
    } catch {}
    skinIconNames(icons);
  }
});
