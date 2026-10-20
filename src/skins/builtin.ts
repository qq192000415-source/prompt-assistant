import type { SkinEntry } from '../lib/theme';
import { buildSkinCss, validateSkinManifest } from './skinPack';

// 内置皮肤：src/skins/builtin/<id>/ 下一个 manifest.json 加资源，格式和皮肤包一样。
// 资源由 Vite 打包成带哈希的地址；不选这个皮肤时 CSS 不引用，图片也就不会加载。
const manifests = import.meta.glob<Record<string, unknown>>('./builtin/*/manifest.json', { eager: true, import: 'default' });
const assets = import.meta.glob<string>('./builtin/*/**/*.{webp,png,jpg,jpeg,svg}', { eager: true, query: '?url', import: 'default' });

export const BUILTIN_SKINS: SkinEntry[] = Object.entries(manifests).map(([manifestPath, raw]) => {
  const dir = manifestPath.slice(0, -'manifest.json'.length);
  const manifest = validateSkinManifest(raw);
  const files = Object.keys(assets)
    .filter((path) => path.startsWith(dir))
    .map((path) => path.slice(dir.length));
  const assetUrl = (path: string) => {
    const url = assets[dir + path];
    if (!url) throw new Error(`内置皮肤 ${manifest.id} 缺少文件 ${path}`);
    return url;
  };
  return {
    id: manifest.id,
    name: manifest.name,
    note: manifest.note,
    base: manifest.base,
    preview: assetUrl(manifest.preview),
    css: buildSkinCss(manifest, files.filter((path) => path.startsWith('icons/')), assetUrl),
  };
});
