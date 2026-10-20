export const THEME_STORAGE_KEY = 'prompt-library.theme';

// 外观主题：浅色、深色是原来的两套；米白、暖夜照 Claude 桌面端的暖米色调（赭橙强调色）。
// 只换颜色令牌（styles.css 里 html[data-theme] 的几块），组件不用改。
export type BaseTheme = 'light' | 'dark' | 'cream' | 'ember';
// 皮肤（src/skins/）：在浅色或深色上面叠一层令牌、壁纸和图标，存成 skin:<id>。
export type ThemeMode = BaseTheme | `skin:${string}`;

// 已经生成好 CSS 的皮肤，内置和安装的都是这个样子。
export type SkinEntry = { id: string; name: string; note: string; base: 'light' | 'dark'; preview: string; css: string };

export const THEMES: ReadonlyArray<{ value: BaseTheme; label: string; note: string; swatch: [string, string] }> = [
  { value: 'light', label: '浅色', note: '冷灰底、蓝色强调', swatch: ['#f7f9fc', '#2563eb'] },
  { value: 'dark', label: '深色', note: '适合弱光环境', swatch: ['#101114', '#2563eb'] },
  { value: 'cream', label: '米白', note: 'Claude 桌面端的暖米色', swatch: ['#faf9f5', '#b4532f'] },
  { value: 'ember', label: '暖夜', note: 'Claude 深色的暖灰底', swatch: ['#262624', '#d97757'] },
];

export const skinOf = (theme: ThemeMode, skins: ReadonlyArray<SkinEntry>) =>
  theme.startsWith('skin:') ? skins.find((skin) => `skin:${skin.id}` === theme) : undefined;

export const isDarkTheme = (theme: ThemeMode, skins: ReadonlyArray<SkinEntry> = []) =>
  theme === 'dark' || theme === 'ember' || skinOf(theme, skins)?.base === 'dark';

export const normalizeTheme = (value: unknown, skins: ReadonlyArray<SkinEntry> = []): ThemeMode => {
  if (THEMES.some((theme) => theme.value === value)) return value as BaseTheme;
  if (typeof value === 'string' && skinOf(value as ThemeMode, skins)) return value as ThemeMode;
  return 'light';
};

export const readTheme = (skins: ReadonlyArray<SkinEntry> = []): ThemeMode => {
  try {
    return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY), skins);
  } catch {
    return 'light';
  }
};

export const applyTheme = (theme: ThemeMode, skins: ReadonlyArray<SkinEntry> = []) => {
  const skin = skinOf(theme, skins);
  const root = document.documentElement;
  root.classList.toggle('dark', isDarkTheme(theme, skins));
  root.dataset.theme = skin ? skin.base : theme;
  if (skin) root.dataset.skin = skin.id;
  else delete root.dataset.skin;
  let style = document.getElementById('app-skin');
  if (!style) {
    style = document.createElement('style');
    style.id = 'app-skin';
    document.head.append(style);
  }
  style.textContent = skin?.css ?? '';
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 隐私模式写不进 localStorage 时，仍保留当前页面的外观。
  }
};

// 顶部栏菜单和设置页共用的选项：四套主题用色块，皮肤用预览图。
export const themeOptions = (skins: ReadonlyArray<SkinEntry>) => [
  ...THEMES.map((theme) => ({ value: theme.value as ThemeMode, label: theme.label, note: theme.note, swatch: theme.swatch, preview: '' })),
  ...skins.map((skin) => ({ value: `skin:${skin.id}` as ThemeMode, label: skin.name, note: skin.note, swatch: null, preview: skin.preview })),
];
