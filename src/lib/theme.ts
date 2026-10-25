export type ThemePreference = 'system' | 'light' | 'dark';

/** Applies the theme to the page (theme.css reads data-theme; "system" follows the OS). */
export function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

export const NEXT_THEME: Record<ThemePreference, ThemePreference> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};

export const THEME_LABEL: Record<ThemePreference, string> = {
  system: 'Thème : comme le système',
  light: 'Thème : clair',
  dark: 'Thème : sombre',
};
