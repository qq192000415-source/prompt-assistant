export const THEME_STORAGE_KEY = 'prompt-library.theme';

export type ThemeMode = 'light' | 'dark';

export const readTheme = (): ThemeMode => {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

export const applyTheme = (theme: ThemeMode) => {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 隐私模式写不进 localStorage 时，仍保留当前页面的外观。
  }
};
