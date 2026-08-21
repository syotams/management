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

export type MaterialPalette = 'indigo' | 'purple' | 'orange';
export type Theme = 'light' | 'dark-github' | `dark-material-${MaterialPalette}` | 'dark-colorffy';
export type DarkVariant = 'github' | `material-${MaterialPalette}` | 'colorffy' | 'light';

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

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly storageKey = 'theme';
  private readonly lastDarkThemeKey = 'lastDarkTheme';
  private readonly colorffyStorageKey = 'colorffyPalette';
  current = signal<Theme>(this.load());
  colorffyPalette = signal<ColorffySeeds>(this.loadColorffyPalette());

  readonly colorffyPresets = COLORFFY_PRESETS;
  isDark = computed(() => this.current() !== 'light');
  isMaterial = computed(() => this.current().startsWith('dark-material-'));
  isColorffy = computed(() => this.current() === 'dark-colorffy');
  materialPalette = computed<MaterialPalette | null>(() => {
    const theme = this.current();
    if (!theme.startsWith('dark-material-')) return null;
    return theme.replace('dark-material-', '') as MaterialPalette;
  });
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
    if (theme !== 'light') {
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

  private loadColorffyPalette(): ColorffySeeds {
    return parseStoredColorffySeeds(localStorage.getItem(this.colorffyStorageKey))
      ?? { ...COLORFFY_DEFAULT_SEEDS };
  }

  private apply(theme: Theme) {
    const isDark = theme !== 'light';
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
    return theme.replace('dark-material-', 'material-') as DarkVariant;
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
