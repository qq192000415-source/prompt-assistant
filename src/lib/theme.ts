export const THEME_STORAGE_KEY = 'prompt-library.theme';

// 外观主题：浅色、深色是原来的两套；米白、暖夜照 Claude 桌面端的暖米色调（赭橙强调色）。
// 只换颜色令牌（styles.css 里 html[data-theme] 的几块），组件不用改。
export type ThemeMode = 'light' | 'dark' | 'cream' | 'ember';

export const THEMES: ReadonlyArray<{ value: ThemeMode; label: string; note: string; swatch: [string, string] }> = [
  { value: 'light', label: '浅色', note: '冷灰底、蓝色强调', swatch: ['#f7f9fc', '#2563eb'] },
  { value: 'dark', label: '深色', note: '适合弱光环境', swatch: ['#101114', '#2563eb'] },
  { value: 'cream', label: '米白', note: 'Claude 桌面端的暖米色', swatch: ['#faf9f5', '#b4532f'] },
  { value: 'ember', label: '暖夜', note: 'Claude 深色的暖灰底', swatch: ['#262624', '#d97757'] },
];

export const isDarkTheme = (theme: ThemeMode) => theme === 'dark' || theme === 'ember';

export const normalizeTheme = (value: unknown): ThemeMode => (THEMES.some((theme) => theme.value === value) ? (value as ThemeMode) : 'light');

export const readTheme = (): ThemeMode => {
  try {
    return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'light';
  }
};

export const applyTheme = (theme: ThemeMode) => {
  document.documentElement.classList.toggle('dark', isDarkTheme(theme));
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 隐私模式写不进 localStorage 时，仍保留当前页面的外观。
  }
};
