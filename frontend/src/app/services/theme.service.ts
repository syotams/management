import { Injectable, computed, signal } from '@angular/core';

export type MaterialPalette = 'indigo' | 'purple' | 'orange';
export type Theme = 'light' | 'dark-github' | `dark-material-${MaterialPalette}`;
export type DarkVariant = 'github' | `material-${MaterialPalette}`;

export interface ThemeOption {
  id: Theme;
  name: string;
  description: string;
  swatches: [string, string, string];
}

export const MATERIAL_PALETTES: MaterialPalette[] = ['indigo', 'purple', 'orange'];

const MATERIAL_THEME_META: Record<
  MaterialPalette,
  { name: string; description: string; swatches: [string, string, string] }
> = {
  indigo: {
    name: 'Material Indigo',
    description: 'MD2 dark theme with Indigo 200 (#9FA8DA) primary on #121212 surfaces.',
    swatches: ['#121212', '#1e1e1e', '#9fa8da'],
  },
  purple: {
    name: 'Material Purple',
    description: 'MD2 dark theme with Purple 200 (#CE93D8) primary on #121212 surfaces.',
    swatches: ['#121212', '#1e1e1e', '#ce93d8'],
  },
  orange: {
    name: 'Material Orange',
    description: 'MD2 dark theme with Orange 200 (#FFCC80) primary on #121212 surfaces.',
    swatches: ['#121212', '#1e1e1e', '#ffcc80'],
  },
};

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'light',
    name: 'Light',
    description: 'Bright surfaces with high contrast for daytime use.',
    swatches: ['#e8ecf2', '#ffffff', '#4f46e5'],
  },
  {
    id: 'dark-github',
    name: 'GitHub Dark',
    description: 'Deep blue-gray tones inspired by GitHub’s dark mode.',
    swatches: ['#0d1117', '#161b22', '#1f6feb'],
  },
  ...MATERIAL_PALETTES.map((palette) => ({
    id: `dark-material-${palette}` as Theme,
    ...MATERIAL_THEME_META[palette],
  })),
];

const VALID_THEMES = new Set<string>(THEME_OPTIONS.map((option) => option.id));

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly storageKey = 'theme';
  private readonly lastDarkThemeKey = 'lastDarkTheme';
  current = signal<Theme>(this.load());

  isDark = computed(() => this.current() !== 'light');
  isMaterial = computed(() => this.current().startsWith('dark-material-'));
  materialPalette = computed<MaterialPalette | null>(() => {
    const theme = this.current();
    if (!theme.startsWith('dark-material-')) return null;
    return theme.replace('dark-material-', '') as MaterialPalette;
  });

  constructor() {
    this.apply(this.current());
  }

  toggle() {
    if (this.isDark()) {
      this.set('light');
      return;
    }

    this.set(this.loadLastDarkTheme());
  }

  set(theme: Theme) {
    this.current.set(theme);
    this.apply(theme);
    localStorage.setItem(this.storageKey, theme);
    if (theme !== 'light') {
      localStorage.setItem(this.lastDarkThemeKey, theme);
    }
  }

  private load(): Theme {
    const stored = localStorage.getItem(this.storageKey);
    if (stored && VALID_THEMES.has(stored)) {
      return stored as Theme;
    }
    if (stored === 'dark') {
      return 'dark-github';
    }
    if (stored === 'dark-material') {
      return 'dark-material-purple';
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark-github' : 'light';
  }

  private loadLastDarkTheme(): Theme {
    const stored = localStorage.getItem(this.lastDarkThemeKey);
    if (stored && stored !== 'light' && VALID_THEMES.has(stored)) {
      return stored as Theme;
    }
    return 'dark-github';
  }

  private apply(theme: Theme) {
    const isDark = theme !== 'light';
    const variant = this.themeToVariant(theme);

    document.documentElement.setAttribute('data-bs-theme', isDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-dark-variant', variant);
  }

  private themeToVariant(theme: Theme): DarkVariant | 'light' {
    if (theme === 'light') return 'light';
    if (theme === 'dark-github') return 'github';
    return theme.replace('dark-material-', 'material-') as DarkVariant;
  }
}
