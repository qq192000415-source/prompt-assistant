// 把 themes/<id>/ 里的皮肤打成主题市场的文件：themes/dist/<id>.zip、themes/dist/<id>.<预览图扩展名>、themes/index.json。
//   node scripts/build-theme-index.cjs
// 每个包都用软件里同一套校验（electron/materials/skinStore.ts 的 readSkinZip）检查一遍，有一个不过就整体失败。
// 以 _ 或 . 开头的文件夹（比如 _template）不进市场；和内置皮肤重名的拒绝。
// zip 里的文件按名字排序、时间固定，内容没变时重新打出来的 zip 和 SHA256 也不变，git 里不会冒出无意义的改动。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

const root = path.resolve(__dirname, '..');
const themesDir = path.join(root, 'themes');
const distDir = path.join(themesDir, 'dist');
const builtinIds = fs.readdirSync(path.join(root, 'src', 'skins', 'builtin'));
const FIXED_DATE = new Date('2026-01-01T00:00:00Z');

const listFiles = (dir, prefix = '') =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? listFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]))
    .sort();

const main = async () => {
  const { readSkinZip } = await import('../electron/materials/skinStore.ts');
  const ids = fs
    .readdirSync(themesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'dist' && !/^[_.]/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  fs.mkdirSync(distDir, { recursive: true });
  const themes = [];
  const outputs = new Set();
  for (const id of ids) {
    if (builtinIds.includes(id)) throw new Error(`themes/${id} 和内置皮肤重名，换一个 id`);
    const dir = path.join(themesDir, id);
    const zip = new JSZip();
    for (const name of listFiles(dir)) zip.file(name, fs.readFileSync(path.join(dir, name)), { date: FIXED_DATE });
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'DOS' });
    let manifest;
    try {
      ({ manifest } = await readSkinZip(bytes));
    } catch (error) {
      throw new Error(`themes/${id} 没通过校验：${error.message}`);
    }
    if (manifest.id !== id) throw new Error(`themes/${id} 的 manifest.json 里 id 是「${manifest.id}」，要和文件夹名一致`);
    const preview = `dist/${id}${path.extname(manifest.preview)}`;
    fs.writeFileSync(path.join(distDir, `${id}.zip`), bytes);
    fs.copyFileSync(path.join(dir, manifest.preview), path.join(themesDir, preview));
    outputs.add(`${id}.zip`).add(path.basename(preview));
    themes.push({
      id,
      name: manifest.name,
      note: manifest.note,
      author: manifest.author,
      version: manifest.version,
      base: manifest.base,
      size: bytes.byteLength,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      preview,
    });
    console.log(`[themes] ${id}  ${manifest.name}  v${manifest.version}  ${bytes.byteLength} 字节`);
  }
  // 删掉已经不在 themes/ 里的旧包
  for (const name of fs.readdirSync(distDir)) {
    if (!outputs.has(name)) {
      fs.rmSync(path.join(distDir, name));
      console.log(`[themes] 删除旧文件 dist/${name}`);
    }
  }
  fs.writeFileSync(path.join(themesDir, 'index.json'), `${JSON.stringify({ schemaVersion: 1, themes }, null, 2)}\n`);
  console.log(`[themes] 写入 themes/index.json，共 ${themes.length} 个皮肤`);
};

main().catch((error) => {
  console.error(`[themes] ${error.message || error}`);
  process.exitCode = 1;
});
