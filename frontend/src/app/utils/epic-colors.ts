/** 12 distinct palette hues for epic chips. */
export const EPIC_COLORS = [
  '#d9a69f',
  '#6c739c',
  '#f0dad5',
  '#babbb1',
  '#c56b62',
  '#424658',
  '#dea785',
  '#c889b5',
  '#fce5cc',
  '#736eae',
  '#527aa6',
  '#97b3ae',
];

/**
 * Returns a palette color for `index`.
 * First pass uses the 12 base hues; later passes use darker/lighter shades
 * so consecutive wraps stay visually distinct.
 */
export function nextEpicColor(index: number): string {
  const base = EPIC_COLORS[((index % EPIC_COLORS.length) + EPIC_COLORS.length) % EPIC_COLORS.length];
  const generation = Math.floor(Math.max(0, index) / EPIC_COLORS.length);
  if (generation === 0) return base;
  return shadeHex(base, generation);
}

/** First palette/shade color not already present in `usedColors`. */
export function nextUnusedEpicColor(usedColors: string[]): string {
  const used = new Set(usedColors.map((c) => c.toLowerCase()));
  for (let i = 0; i < EPIC_COLORS.length * 20; i++) {
    const color = nextEpicColor(i);
    if (!used.has(color.toLowerCase())) return color;
  }
  return nextEpicColor(usedColors.length);
}

function shadeHex(hex: string, generation: number): string {
  const { h, s, l } = hexToHsl(hex);
  // Alternate darker / lighter, increasing the shift each full cycle.
  const step = Math.ceil(generation / 2);
  const amount = Math.min(0.12 * step, 0.36);
  const darker = generation % 2 === 1;
  const nextL = darker
    ? Math.max(0.18, l - amount)
    : Math.min(0.72, l + amount);
  return hslToHex(h, s, nextL);
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const raw = hex.replace('#', '');
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      break;
    case g:
      h = ((b - r) / d + 2) / 6;
      break;
    default:
      h = ((r - g) / d + 4) / 6;
      break;
  }
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (n: number) =>
    Math.round(n * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
