export interface ColorffySeeds {
  primary: string;
  surface: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
}

export interface ColorffyPreset extends ColorffySeeds {
  id: string;
  name: string;
}

export const COLORFFY_SEED_KEYS = [
  'primary',
  'surface',
  'success',
  'warning',
  'danger',
  'info',
] as const;

export type ColorffySeedKey = (typeof COLORFFY_SEED_KEYS)[number];

export const COLORFFY_SEED_LABELS: Record<ColorffySeedKey, string> = {
  primary: 'Primary',
  surface: 'Surface',
  success: 'Success',
  warning: 'Warning',
  danger: 'Danger',
  info: 'Info',
};

/** Palette from https://colorffy.com/dark-theme-generator with the shared Teal seeds. */
export const COLORFFY_DEFAULT_SEEDS: ColorffySeeds = {
  primary: '#20c6a4',
  surface: '#121212',
  success: '#4aff6b',
  warning: '#ffac38',
  danger: '#ff6161',
  info: '#61c2ff',
};

export const COLORFFY_PRESETS: ColorffyPreset[] = [
  { id: 'teal', name: 'Teal', ...COLORFFY_DEFAULT_SEEDS },
  {
    id: 'neon',
    name: 'Neon',
    primary: '#b3fe26',
    surface: '#050505',
    success: '#13e83a',
    warning: '#f0b01a',
    danger: '#ff312e',
    info: '#2daaf7',
  },
  {
    id: 'futuristic',
    name: 'Futuristic',
    primary: '#11eded',
    surface: '#000b2b',
    success: '#7dff95',
    warning: '#ffbc5e',
    danger: '#ff8080',
    info: '#87d1ff',
  },
  {
    id: 'slate',
    name: 'Slate',
    primary: '#94a3b8',
    surface: '#11151c',
    success: '#7dff95',
    warning: '#ffbc5e',
    danger: '#ff8080',
    info: '#87d1ff',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    primary: '#6c8cff',
    surface: '#0f1320',
    success: '#7dff95',
    warning: '#ffbc5e',
    danger: '#ff8080',
    info: '#87d1ff',
  },
  {
    id: 'emerald',
    name: 'Emerald',
    primary: '#34d399',
    surface: '#0c1714',
    success: '#7dff95',
    warning: '#ffbc5e',
    danger: '#ff8080',
    info: '#87d1ff',
  },
  {
    id: 'sunset',
    name: 'Sunset',
    primary: '#ff8a4c',
    surface: '#1a1012',
    success: '#7dff95',
    warning: '#ffbc5e',
    danger: '#ff8080',
    info: '#87d1ff',
  },
  {
    id: 'royal',
    name: 'Royal',
    primary: '#a78bfa',
    surface: '#14101f',
    success: '#7dff95',
    warning: '#ffbc5e',
    danger: '#ff8080',
    info: '#87d1ff',
  },
  {
    id: 'crimson',
    name: 'Crimson',
    primary: '#ff5d73',
    surface: '#1a0f12',
    success: '#7dff95',
    warning: '#ffbc5e',
    danger: '#ff8080',
    info: '#87d1ff',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    primary: '#38bdf8',
    surface: '#0b1620',
    success: '#7dff95',
    warning: '#ffbc5e',
    danger: '#ff8080',
    info: '#87d1ff',
  },
  {
    id: 'gold',
    name: 'Gold',
    primary: '#d4b85a',
    surface: '#161410',
    success: '#7dff95',
    warning: '#ffbc5e',
    danger: '#ff8080',
    info: '#87d1ff',
  },
];

const SURFACE_TINTS = [0, 0.08, 0.165, 0.257, 0.354, 0.451];
const PRIMARY_TINTS = [0, 0.193, 0.314, 0.417, 0.511, 0.601];
const SEMANTIC_TINTS = [0, 0.28, 0.48];

function clampByte(value: number): number {
  return Math.round(Math.min(255, Math.max(0, value)));
}

export function normalizeHex(value: string): string | null {
  const raw = value.trim();
  const short = /^#([0-9a-fA-F]{3})$/.exec(raw);
  if (short) {
    const [r, g, b] = short[1];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const full = /^#([0-9a-fA-F]{6})$/.exec(raw);
  return full ? `#${full[1].toLowerCase()}` : null;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = normalizeHex(hex) ?? '#000000';
  return [
    parseInt(normalized.slice(1, 3), 16),
    parseInt(normalized.slice(3, 5), 16),
    parseInt(normalized.slice(5, 7), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => clampByte(c).toString(16).padStart(2, '0')).join('')}`;
}

function rgbToCss(rgb: [number, number, number]): string {
  return rgb.map(clampByte).join(', ');
}

function mix(hex: string, other: string, amount: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(other);
  return rgbToHex(
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  );
}

function ramp(hex: string, tints: number[]): string[] {
  return tints.map((t) => mix(hex, '#ffffff', t));
}

function relativeLuminance(hex: string): number {
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function onColor(background: string): string {
  return relativeLuminance(background) > 0.4 ? '#121212' : '#ffffff';
}

function chip(bg: string, border: string): { bg: string; border: string; text: string } {
  return { bg, border, text: onColor(bg) };
}

export function seedsEqual(a: ColorffySeeds, b: ColorffySeeds): boolean {
  return COLORFFY_SEED_KEYS.every(
    (key) => normalizeHex(a[key]) === normalizeHex(b[key]),
  );
}

export function findColorffyPreset(seeds: ColorffySeeds): ColorffyPreset | null {
  return COLORFFY_PRESETS.find((preset) => seedsEqual(preset, seeds)) ?? null;
}

export function parseStoredColorffySeeds(raw: string | null): ColorffySeeds | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ColorffySeeds>;
    const seeds: ColorffySeeds = { ...COLORFFY_DEFAULT_SEEDS };
    for (const key of COLORFFY_SEED_KEYS) {
      const hex = typeof parsed[key] === 'string' ? normalizeHex(parsed[key]!) : null;
      if (!hex) return null;
      seeds[key] = hex;
    }
    return seeds;
  } catch {
    return null;
  }
}

export function buildColorffyCssVars(seeds: ColorffySeeds): Record<string, string> {
  const primary = ramp(seeds.primary, PRIMARY_TINTS);
  const surface = ramp(seeds.surface, SURFACE_TINTS);
  const success = ramp(seeds.success, SEMANTIC_TINTS);
  const warning = ramp(seeds.warning, SEMANTIC_TINTS);
  const danger = ramp(seeds.danger, SEMANTIC_TINTS);
  const info = ramp(seeds.info, SEMANTIC_TINTS);

  const primaryRgb = hexToRgb(primary[0]);
  const successRgb = hexToRgb(success[0]);
  const warningRgb = hexToRgb(warning[0]);
  const infoRgb = hexToRgb(info[0]);
  const text = mix('#ffffff', seeds.surface, 0.1);
  const muted = surface[5];

  // Colorffy task chips use solid a10 fills with a0 borders (not translucent overlays).
  const todo = chip(primary[1], primary[0]);
  const inProgress = chip(info[1], info[0]);
  const completed = chip(success[1], success[0]);
  const archived = chip(surface[2], surface[3]);
  const urgent = chip(danger[1], danger[0]);
  const high = chip(danger[2], danger[1]);
  const medium = chip(warning[1], warning[0]);
  const low = chip(surface[3], surface[4]);

  return {
    '--app-bg': surface[0],
    '--app-surface': surface[1],
    '--app-surface-hover': surface[2],
    '--app-border': surface[3],
    '--app-border-subtle': surface[2],
    '--app-text': text,
    '--app-text-muted': muted,
    '--app-text-disabled': `rgba(${rgbToCss(hexToRgb(text))}, 0.38)`,
    '--app-navbar-bg': surface[1],
    '--app-navbar-text': text,
    '--app-input-bg': surface[0],
    '--app-input-border': surface[3],
    '--app-input-border-hover': muted,
    '--app-shadow': '0 1px 2px rgba(0, 0, 0, 0.2), 0 4px 16px rgba(0, 0, 0, 0.28)',
    '--app-shadow-lg': '0 8px 32px rgba(0, 0, 0, 0.4)',
    '--app-table-header-bg': surface[1],
    '--app-card-header-bg': surface[1],
    '--app-table-header-text': muted,
    '--app-modal-backdrop': 'rgba(0, 0, 0, 0.65)',
    '--app-primary': primary[0],
    '--app-primary-rgb': rgbToCss(primaryRgb),
    '--app-primary-hover': primary[1],
    '--app-primary-active': primary[2],
    '--app-on-primary': onColor(primary[0]),
    '--app-on-success': onColor(success[0]),
    '--app-link': primary[1],
    '--app-link-hover': primary[2],
    '--app-error': danger[1],
    '--app-error-rgb': rgbToCss(hexToRgb(danger[1])),
    '--app-warning': warning[0],
    '--app-warning-rgb': rgbToCss(warningRgb),
    '--app-success': success[0],
    '--app-success-rgb': rgbToCss(successRgb),
    '--app-info': info[0],
    '--app-info-rgb': rgbToCss(infoRgb),
    '--app-count-badge-bg': `color-mix(in srgb, ${muted} 16%, ${surface[1]})`,
    '--app-count-badge-text': muted,
    '--app-count-badge-border': `color-mix(in srgb, ${muted} 30%, ${surface[1]})`,
    '--app-status-todo-bg': todo.bg,
    '--app-status-todo-text': todo.text,
    '--app-status-todo-border': todo.border,
    '--app-status-in-progress-bg': inProgress.bg,
    '--app-status-in-progress-text': inProgress.text,
    '--app-status-in-progress-border': inProgress.border,
    '--app-status-completed-bg': completed.bg,
    '--app-status-completed-text': completed.text,
    '--app-status-completed-border': completed.border,
    '--app-status-archived-bg': archived.bg,
    '--app-status-archived-text': archived.text,
    '--app-status-archived-border': archived.border,
    '--app-priority-urgent-bg': urgent.bg,
    '--app-priority-urgent-text': urgent.text,
    '--app-priority-urgent-border': urgent.border,
    '--app-priority-high-bg': high.bg,
    '--app-priority-high-text': high.text,
    '--app-priority-high-border': high.border,
    '--app-priority-medium-bg': medium.bg,
    '--app-priority-medium-text': medium.text,
    '--app-priority-medium-border': medium.border,
    '--app-priority-low-bg': low.bg,
    '--app-priority-low-text': low.text,
    '--app-priority-low-border': low.border,
    '--app-btn-ghost-bg': 'rgba(255, 255, 255, 0.04)',
    '--app-btn-ghost-border': surface[3],
    '--app-btn-ghost-hover-bg': `rgba(${rgbToCss(primaryRgb)}, 0.12)`,
    '--app-btn-ghost-hover-border': primary[0],
    '--bs-body-bg': 'var(--app-bg)',
    '--bs-body-color': 'var(--app-text)',
    '--bs-border-color': 'var(--app-border-subtle)',
    '--bs-primary': 'var(--app-primary)',
    '--bs-primary-rgb': 'var(--app-primary-rgb)',
    '--bs-secondary-color': 'var(--app-text-muted)',
    '--bs-tertiary-bg': 'var(--app-surface-hover)',
    '--bs-link-color': 'var(--app-link)',
    '--bs-link-hover-color': 'var(--app-link-hover)',
    '--bs-danger': 'var(--app-error)',
    '--bs-danger-rgb': 'var(--app-error-rgb)',
    '--bs-focus-ring-color': 'rgba(var(--app-primary-rgb), 0.25)',
  };
}
