import { Injectable, computed, signal } from '@angular/core';
import {
  COLORFFY_DEFAULT_SEEDS,
  COLORFFY_PRESETS,
  ColorffyPreset,
  ColorffySeedKey,
  ColorffySeeds,
  buildColorffyCssVars,
  findColorffyPreset,
  normalizeHex,
  parseStoredColorffySeeds,
} from './colorffy-palette';

export type Theme = 'light' | 'dark-github' | 'dark-material-purple' | 'dark-colorffy';
export type DarkVariant = 'github' | 'material-purple' | 'colorffy' | 'light';

export interface ThemeOption {
  id: Theme;
  name: string;
  description: string;
  swatches: [string, string, string];
}

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
  {
    id: 'dark-material-purple',
    name: 'Material Purple',
    description: 'MD2 dark theme with Purple 200 (#CE93D8) primary on #121212 surfaces.',
    swatches: ['#121212', '#1e1e1e', '#ce93d8'],
  },
  {
    id: 'dark-colorffy',
    name: 'Colorffy',
    description: 'Dark theme generated from Colorffy palettes, with live preset and color controls.',
    swatches: [
      COLORFFY_DEFAULT_SEEDS.surface,
      COLORFFY_DEFAULT_SEEDS.primary,
      COLORFFY_DEFAULT_SEEDS.danger,
    ],
  },
];

const VALID_THEMES = new Set<string>(THEME_OPTIONS.map((option) => option.id));
const COLORFFY_STYLE_ID = 'colorffy-theme-vars';

function isDarkTheme(theme: Theme): boolean {
  return theme.startsWith('dark');
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly storageKey = 'theme';
  private readonly lastDarkThemeKey = 'lastDarkTheme';
  private readonly colorffyStorageKey = 'colorffyPalette';
  current = signal<Theme>(this.load());
  colorffyPalette = signal<ColorffySeeds>(this.loadColorffyPalette());

  readonly colorffyPresets = COLORFFY_PRESETS;
  isDark = computed(() => isDarkTheme(this.current()));
  isMaterial = computed(() => this.current() === 'dark-material-purple');
  isColorffy = computed(() => this.current() === 'dark-colorffy');
  colorffyPreset = computed<ColorffyPreset | null>(() => findColorffyPreset(this.colorffyPalette()));

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
    if (isDarkTheme(theme)) {
      localStorage.setItem(this.lastDarkThemeKey, theme);
    }
  }

  setColorffyPreset(preset: ColorffyPreset) {
    this.setColorffyPalette({
      primary: preset.primary,
      surface: preset.surface,
      success: preset.success,
      warning: preset.warning,
      danger: preset.danger,
      info: preset.info,
    });
  }

  setColorffyColor(key: ColorffySeedKey, value: string) {
    const hex = normalizeHex(value);
    if (!hex) return;
    this.setColorffyPalette({ ...this.colorffyPalette(), [key]: hex });
  }

  resetColorffyPalette() {
    this.setColorffyPalette({ ...COLORFFY_DEFAULT_SEEDS });
  }

  private setColorffyPalette(seeds: ColorffySeeds) {
    this.colorffyPalette.set(seeds);
    localStorage.setItem(this.colorffyStorageKey, JSON.stringify(seeds));
    if (this.current() === 'dark-colorffy') {
      this.applyColorffyVars(seeds);
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
    if (
      stored === 'dark-material' ||
      stored === 'dark-material-indigo' ||
      stored === 'dark-material-orange'
    ) {
      return 'dark-material-purple';
    }
    if (stored === 'light-beachfront' || stored === 'light-therapy') {
      return 'light';
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark-github' : 'light';
  }

  private loadLastDarkTheme(): Theme {
    const stored = localStorage.getItem(this.lastDarkThemeKey);
    if (stored && isDarkTheme(stored as Theme) && VALID_THEMES.has(stored)) {
      return stored as Theme;
    }
    if (
      stored === 'dark-material' ||
      stored === 'dark-material-indigo' ||
      stored === 'dark-material-orange'
    ) {
      return 'dark-material-purple';
    }
    return 'dark-github';
  }

  private loadColorffyPalette(): ColorffySeeds {
    return parseStoredColorffySeeds(localStorage.getItem(this.colorffyStorageKey))
      ?? { ...COLORFFY_DEFAULT_SEEDS };
  }

  private apply(theme: Theme) {
    const isDark = isDarkTheme(theme);
    const variant = this.themeToVariant(theme);

    document.documentElement.setAttribute('data-bs-theme', isDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-dark-variant', variant);

    if (theme === 'dark-colorffy') {
      this.applyColorffyVars(this.colorffyPalette());
    } else {
      this.clearColorffyVars();
    }
  }

  private themeToVariant(theme: Theme): DarkVariant {
    if (theme === 'light') return 'light';
    if (theme === 'dark-github') return 'github';
    if (theme === 'dark-colorffy') return 'colorffy';
    return 'material-purple';
  }

  private applyColorffyVars(seeds: ColorffySeeds) {
    const vars = buildColorffyCssVars(seeds);
    const declarations = Object.entries(vars)
      .map(([name, value]) => `  ${name}: ${value};`)
      .join('\n');
    this.colorffyStyleEl().textContent =
      `[data-bs-theme='dark'][data-dark-variant='colorffy'] {\n${declarations}\n}`;
  }

  private clearColorffyVars() {
    const el = document.getElementById(COLORFFY_STYLE_ID);
    if (el) el.textContent = '';
  }

  private colorffyStyleEl(): HTMLStyleElement {
    let el = document.getElementById(COLORFFY_STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = COLORFFY_STYLE_ID;
      document.head.appendChild(el);
    }
    return el;
  }
}
