// 皮肤包：manifest.json + 资源文件（壁纸、预览图、icons/<lucide 名>.svg|png）。
// 内置皮肤和安装的皮肤包都走这里校验、生成 CSS。皮肤包来自别人，是信任边界：
// 只收已有颜色令牌的白名单，值里不能有 url( 和能跳出声明的字符，图标和图片只按文件名引用。

export type SkinBase = 'light' | 'dark';

// 壁纸摆法（1.17.0）：cover 铺满窗口（focus 是窗口变窄时保住的主体位置，百分比）；left / right 是侧边立绘，
// 按窗口高度完整贴在一侧，朝内容那边渐隐到 base 色，aspect 是图的宽高比（算立绘多宽）。
export type WallpaperLayout = 'cover' | 'left' | 'right';
export type SkinWallpaper = { file: string; overlay: string; layout: WallpaperLayout; focus: [number, number]; aspect: number; base: string };

export type SkinManifest = {
  id: string;
  name: string;
  note: string;
  author: string;
  version: string;
  base: SkinBase;
  tokens: Record<string, string>;
  wallpaper: SkinWallpaper | null;
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
    const layout = raw.layout ?? 'cover';
    if (layout !== 'cover' && layout !== 'left' && layout !== 'right') throw new Error('皮肤包的 wallpaper.layout 只能是 cover、left 或 right');
    const focus = raw.focus ?? [50, 50];
    if (!Array.isArray(focus) || focus.length !== 2 || !focus.every((value) => typeof value === 'number' && value >= 0 && value <= 100)) {
      throw new Error('皮肤包的 wallpaper.focus 要写成 [横向百分比, 纵向百分比]，都在 0–100');
    }
    const aspect = raw.aspect ?? 0;
    if (layout !== 'cover' && !(typeof aspect === 'number' && aspect >= 0.2 && aspect <= 5)) {
      throw new Error('侧边立绘（wallpaper.layout 是 left/right）要写 wallpaper.aspect：图片宽 ÷ 高，0.2–5');
    }
    wallpaper = {
      file: file(raw.file, 'wallpaper.file'),
      overlay: raw.overlay === undefined ? 'transparent' : checkCssValue(raw.overlay, 'wallpaper.overlay'),
      layout,
      focus: [focus[0], focus[1]],
      aspect: typeof aspect === 'number' ? aspect : 0,
      base: raw.base === undefined ? 'var(--surface-quiet)' : checkCssValue(raw.base, 'wallpaper.base'),
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
  const wallpaper = manifest.wallpaper;
  // 侧边立绘那一侧给内容区让出位置：宽窗口里人物露出来，窄了就退到磨砂玻璃后面（styles.css 用这个变量）。
  if (wallpaper && wallpaper.layout !== 'cover') tokens.push(`  --wallpaper-room-${wallpaper.layout}: calc(100vh * ${wallpaper.aspect} * 0.62);`);
  const rules = [`${scope} {\n${tokens.join('\n')}\n  color: var(--text);\n  background: var(--surface-quiet);\n}`];
  if (wallpaper) {
    // 壁纸画在 body 的两个固定层上（::before 是图，::after 是压暗/提亮的一层），不画进 body 背景：
    // 这样看图的页面能单独把图调淡（styles.css 里 html[data-view] 的规则），立绘也能用遮罩渐隐。
    // html 垫底色、body 要透明，否则 body 背景会盖住 z-index 为负的这两层。
    const { overlay, layout, focus, aspect, base } = wallpaper;
    const url = cssUrl(assetUrl(wallpaper.file));
    const layer = 'content: "";\n  position: fixed;\n  z-index: -1;\n  top: 0;\n  bottom: 0;\n  pointer-events: none;';
    let image = `left: 0;\n  right: 0;\n  background: ${url} ${focus[0]}% ${focus[1]}% / cover no-repeat;`;
    if (layout !== 'cover') {
      const mask = `linear-gradient(${layout === 'right' ? 'to left' : 'to right'}, #000 62%, transparent), linear-gradient(to bottom, #000 85%, transparent)`;
      image = `${layout}: 0;\n  width: calc(100vh * ${aspect});\n  background: ${url} center / cover no-repeat;\n  -webkit-mask-image: ${mask};\n  -webkit-mask-composite: source-in;\n  mask-image: ${mask};\n  mask-composite: intersect;`;
    }
    rules.push(
      `${scope} {\n  background: ${layout === 'cover' ? 'var(--overlay-surface)' : base};\n}`,
      `${scope} body {\n  background: transparent;\n}`,
      `${scope} body::before {\n  ${layer}\n  ${image}\n  transition: opacity 0.4s, filter 0.4s;\n}`,
      `${scope} body::after {\n  ${layer}\n  left: 0;\n  right: 0;\n  background: ${overlay};\n}`,
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
