// 皮肤包：manifest.json + 资源文件（壁纸、预览图、icons/<lucide 名>.svg|png）。
// 内置皮肤和安装的皮肤包都走这里校验、生成 CSS。皮肤包来自别人，是信任边界：
// 只收已有颜色令牌的白名单，值里不能有 url( 和能跳出声明的字符，图标和图片只按文件名引用。

export type SkinBase = 'light' | 'dark';

export type SkinManifest = {
  id: string;
  name: string;
  note: string;
  author: string;
  version: string;
  base: SkinBase;
  tokens: Record<string, string>;
  wallpaper: { file: string; overlay: string } | null;
  preview: string;
};

// styles.css 里 :root 的颜色令牌，皮肤只能改这些。
export const SKIN_TOKENS = [
  '--sidebar',
  '--surface',
  '--surface-quiet',
  '--surface-raised',
  '--surface-muted',
  '--overlay-surface',
  '--hover',
  '--border',
  '--border-strong',
  '--text',
  '--muted',
  '--faint',
  '--accent',
  '--accent-hover',
  '--accent-weak',
  '--on-accent',
  '--global',
  '--global-weak',
  '--danger',
  '--danger-weak',
  '--success',
  '--warning',
  '--warning-weak',
  '--shadow',
  '--shadow-soft',
];

const ID_PATTERN = /^[a-z0-9-]{1,40}$/;
const ICON_PATTERN = /^icons\/([a-z0-9-]{1,60})\.(svg|png)$/;
const FILE_PATTERN = /^[a-z0-9_-]{1,60}\.(webp|png|jpg|jpeg)$/;
// 颜色、rgba()、阴影够用了；没有引号、冒号、斜杠、分号、花括号，写不出 url(...) 也跳不出声明。
const VALUE_PATTERN = /^[#a-zA-Z0-9(),.%\s+-]{1,200}$/;

const text = (value: unknown, field: string, max: number, required = true) => {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > max) {
    throw new Error(`皮肤包的 ${field} 必须是不超过 ${max} 字的文字`);
  }
  return value.trim();
};

export const checkCssValue = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !VALUE_PATTERN.test(value) || /url\s*\(|image-set|expression/i.test(value)) {
    throw new Error(`皮肤包的 ${field} 值不合法：只能是颜色或阴影`);
  }
  return value.trim();
};

const file = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !FILE_PATTERN.test(value)) {
    throw new Error(`皮肤包的 ${field} 必须是同目录下的图片文件名（小写字母、数字、-、_，webp/png/jpg）`);
  }
  return value;
};

export const validateSkinManifest = (raw: unknown): SkinManifest => {
  if (!raw || typeof raw !== 'object') throw new Error('manifest.json 不是一个 JSON 对象');
  const input = raw as Record<string, unknown>;
  const id = text(input.id, 'id', 40);
  if (!ID_PATTERN.test(id)) throw new Error('皮肤包的 id 只能用小写字母、数字和 -');
  if (input.base !== 'light' && input.base !== 'dark') throw new Error('皮肤包的 base 必须是 light 或 dark');
  if (!input.tokens || typeof input.tokens !== 'object' || Array.isArray(input.tokens)) throw new Error('皮肤包缺少 tokens');
  const tokens: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.tokens as Record<string, unknown>)) {
    if (!SKIN_TOKENS.includes(name)) throw new Error(`皮肤包不能改 ${name}，只能改这些令牌：${SKIN_TOKENS.join(' ')}`);
    tokens[name] = checkCssValue(value, name);
  }
  let wallpaper: SkinManifest['wallpaper'] = null;
  if (input.wallpaper !== undefined) {
    const raw = input.wallpaper as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object') throw new Error('皮肤包的 wallpaper 格式不对');
    wallpaper = {
      file: file(raw.file, 'wallpaper.file'),
      overlay: raw.overlay === undefined ? 'transparent' : checkCssValue(raw.overlay, 'wallpaper.overlay'),
    };
  }
  return {
    id,
    name: text(input.name, 'name', 20),
    note: text(input.note, 'note', 40, false),
    author: text(input.author, 'author', 40),
    version: text(input.version, 'version', 20),
    base: input.base,
    tokens,
    wallpaper,
    preview: file(input.preview, 'preview'),
  };
};

// 皮肤包里的图标文件 → lucide 图标名；不是 icons/<名>.svg|png 的一律报错，不悄悄跳过。
export const skinIconNames = (paths: string[]) =>
  paths.map((path) => {
    const match = ICON_PATTERN.exec(path);
    if (!match) throw new Error(`皮肤包的图标 ${path} 不合法：要放在 icons/ 下，文件名是 lucide 图标名，.svg 或 .png`);
    return { path, name: match[1], colored: match[2] === 'png' };
  });

const cssUrl = (url: string) => {
  if (/["\\\n\r]/.test(url)) throw new Error(`资源地址不合法：${url}`);
  return `url("${url}")`;
};

// 生成整个皮肤的 CSS。assetUrl 把包里的相对路径换成能加载的地址（内置是 Vite 打包后的地址，安装的是 skin://）。
export const buildSkinCss = (manifest: SkinManifest, iconPaths: string[], assetUrl: (path: string) => string) => {
  const scope = `html[data-skin="${manifest.id}"][data-theme]`;
  const tokens = Object.entries(manifest.tokens).map(([name, value]) => `  ${name}: ${value};`);
  const rules = [`${scope} {\n${tokens.join('\n')}\n  color: var(--text);\n  background: var(--surface-quiet);\n}`];
  if (manifest.wallpaper) {
    const overlay = manifest.wallpaper.overlay;
    rules.push(
      `${scope} body {\n  background: linear-gradient(${overlay}, ${overlay}), ${cssUrl(assetUrl(manifest.wallpaper.file))} center / cover fixed no-repeat, var(--surface-quiet);\n}`,
    );
  }
  for (const icon of skinIconNames(iconPaths)) {
    const url = cssUrl(assetUrl(icon.path));
    const paint = icon.colored
      ? `background: ${url} center / contain no-repeat;`
      : `mask: ${url} center / contain no-repeat;\n  background: currentColor;`;
    rules.push(`${scope} svg.lucide-${icon.name} > * {\n  display: none;\n}\n${scope} svg.lucide-${icon.name} {\n  ${paint}\n}`);
  }
  return `${rules.join('\n')}\n`;
};
