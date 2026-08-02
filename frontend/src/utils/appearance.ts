import type { AppearanceConfig } from '../services/config-service';
import { sampleMicaColors } from './performance';

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function adjustHexColor(hexColor: string, amount: number): string {
  const numeric = Number.parseInt(hexColor.slice(1), 16);
  const red = clamp((numeric >> 16) + amount, 0, 255);
  const green = clamp(((numeric >> 8) & 0xff) + amount, 0, 255);
  const blue = clamp((numeric & 0xff) + amount, 0, 255);
  return `#${[red, green, blue].map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

function hslToRgb(h: number, sPercent: number, lPercent: number): [number, number, number] {
  const s = Math.max(0, Math.min(1, sPercent / 100));
  const l = Math.max(0, Math.min(1, lPercent / 100));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0;
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b = x;
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b = c;
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

export function parseColorToRgb(color: string): [number, number, number] {
  const trimmed = color.trim().toLowerCase();

  if (HEX_COLOR_PATTERN.test(trimmed)) {
    const numeric = Number.parseInt(trimmed.slice(1), 16);
    return [numeric >> 16, (numeric >> 8) & 0xff, numeric & 0xff];
  }

  const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(trimmed);
  if (rgbMatch !== null) {
    return [
      clamp(Number.parseInt(rgbMatch[1], 10), 0, 255),
      clamp(Number.parseInt(rgbMatch[2], 10), 0, 255),
      clamp(Number.parseInt(rgbMatch[3], 10), 0, 255),
    ];
  }

  const hslMatch = /^hsl\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%\s*\)/.exec(trimmed);
  if (hslMatch !== null) {
    const h = Number.parseFloat(hslMatch[1]);
    const s = Number.parseFloat(hslMatch[2]);
    const l = Number.parseFloat(hslMatch[3]);
    return hslToRgb(h, s, l);
  }

  return [0, 120, 212];
}

export interface AccentPalette {
  primary: string;
  hover: string;
  glow: string;
  cardBorderHover: string;
}

export function generateAccentPalette(color: string): AccentPalette {
  const [r, g, b] = parseColorToRgb(color);
  const hex = rgbToHex(r, g, b);
  const hoverHex = adjustHexColor(hex, -18);

  return {
    primary: hex,
    hover: hoverHex,
    glow: `rgba(${r}, ${g}, ${b}, 0.3)`,
    cardBorderHover: `rgba(${r}, ${g}, ${b}, 0.65)`,
  };
}

export function applyAccentPalette(palette: AccentPalette): void {
  const root = document.documentElement;
  root.style.setProperty('--color-accent-primary', palette.primary);
  root.style.setProperty('--color-accent-hover', palette.hover);
  root.style.setProperty('--color-accent-glow', palette.glow);
  root.style.setProperty('--color-card-border-hover', palette.cardBorderHover);
}

export function applyAccentColor(accentColor: string): void {
  const palette = generateAccentPalette(accentColor);
  applyAccentPalette(palette);
}

export function normalizeAccentColor(value: string): string {
  return HEX_COLOR_PATTERN.test(value) ? value.toLowerCase() : '#0078d4';
}

export function applyAppearanceConfig(config: AppearanceConfig): void {
  const root = document.documentElement;
  const accent = normalizeAccentColor(config.accentColor);
  const radius = clamp(Number(config.radius), 4, 24);
  const cardMinWidth = clamp(Number(config.cardMinWidth), 220, 420);
  const cardRowHeight = clamp(Number(config.cardRowHeight), 180, 380);

  root.setAttribute('data-wallpaper-accent', config.useWallpaperAccent ? 'true' : 'false');
  root.style.setProperty('--radius-sm', `${Math.max(4, Math.round(radius * 0.5))}px`);
  root.style.setProperty('--radius-md', `${Math.round(radius)}px`);
  root.style.setProperty('--radius-lg', `${Math.round(radius * 1.5)}px`);
  root.style.setProperty('--radius-xl', `${Math.round(radius * 2)}px`);
  root.style.setProperty('--card-min-width', `${cardMinWidth}px`);
  root.style.setProperty('--card-row-height', `${cardRowHeight}px`);
  root.style.setProperty('--card-gap', '24px');

  if (!config.useWallpaperAccent) {
    applyAccentColor(accent);
  } else {
    sampleMicaColors();
  }
}

