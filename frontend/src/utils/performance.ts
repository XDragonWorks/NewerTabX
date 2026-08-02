import { applyAccentColor, applyAccentPalette, generateAccentPalette } from './appearance';

export interface PerformanceConfig {
  preset: 'high' | 'medium' | 'low' | 'custom';
  material: 'opaque' | 'mica' | 'acrylic';
  enableBlur: boolean;
  enableOverlayBlur: boolean;
  enableShimmer: boolean;
  enableFlipModal: boolean;
  enableFlipSourceAnimation: boolean;
  blurRadius: number;
  overlayBlurRadius: number;
}

const DEFAULT_PERFORMANCE_CONFIG: PerformanceConfig = {
  preset: 'high',
  material: 'acrylic',
  enableBlur: true,
  enableOverlayBlur: true,
  enableShimmer: true,
  enableFlipModal: true,
  enableFlipSourceAnimation: false,
  blurRadius: 16,
  overlayBlurRadius: 4,
};

let currentPerformanceConfig: PerformanceConfig = { ...DEFAULT_PERFORMANCE_CONFIG };

export function getPerformanceConfig(): PerformanceConfig {
  return { ...currentPerformanceConfig };
}

export function applyPerformanceConfig(config: PerformanceConfig): void {
  currentPerformanceConfig = {
    ...DEFAULT_PERFORMANCE_CONFIG,
    ...config,
    blurRadius: Math.max(0, Math.min(40, Number(config.blurRadius))),
    overlayBlurRadius: Math.max(0, Math.min(20, Number(config.overlayBlurRadius))),
  };

  const root = document.documentElement;
  root.setAttribute('data-material', currentPerformanceConfig.material);
  root.setAttribute('data-blur', currentPerformanceConfig.enableBlur ? 'true' : 'false');
  root.setAttribute('data-overlay-blur', currentPerformanceConfig.enableOverlayBlur ? 'true' : 'false');
  root.setAttribute('data-shimmer', currentPerformanceConfig.enableShimmer ? 'true' : 'false');
  root.setAttribute('data-flip', currentPerformanceConfig.enableFlipModal ? 'true' : 'false');
  root.setAttribute('data-flip-source', currentPerformanceConfig.enableFlipSourceAnimation ? 'true' : 'false');

  const effectiveBlur = currentPerformanceConfig.enableBlur ? currentPerformanceConfig.blurRadius : 0;
  const effectiveOverlayBlur = currentPerformanceConfig.enableOverlayBlur ? currentPerformanceConfig.overlayBlurRadius : 0;

  root.style.setProperty('--blur-acrylic', `${effectiveBlur}px`);
  root.style.setProperty('--blur-card', `${effectiveBlur}px`);
  root.style.setProperty('--blur-overlay', `${effectiveOverlayBlur}px`);

  if (currentPerformanceConfig.material === 'acrylic') {
    root.style.removeProperty('--color-card-bg');
    root.style.removeProperty('--color-surface-acrylic');
  }
}

export function areFlipAnimationsEnabled(): boolean {
  return currentPerformanceConfig.enableFlipModal
    && currentPerformanceConfig.preset !== 'low'
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function areFlipSourceAnimationsEnabled(): boolean {
  return areFlipAnimationsEnabled() && currentPerformanceConfig.enableFlipSourceAnimation;
}

function rgbToHsl(red: number, green: number, blue: number): [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  let hue = 0;

  if (delta !== 0) {
    if (maximum === r) hue = ((g - b) / delta) % 6;
    else if (maximum === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = Math.round(hue * 60);
    if (hue < 0) hue += 360;
  }

  const lightness = (maximum + minimum) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return [hue, saturation * 100, lightness * 100];
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

function drawCoverImageToCanvas(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  canvasWidth: number,
  canvasHeight: number
): void {
  const imgWidth = image.naturalWidth || image.width;
  const imgHeight = image.naturalHeight || image.height;

  if (imgWidth === 0 || imgHeight === 0) {
    context.drawImage(image, 0, 0, canvasWidth, canvasHeight);
    return;
  }

  const targetAspect = canvasWidth / canvasHeight;
  const imgAspect = imgWidth / imgHeight;

  let sx = 0;
  let sy = 0;
  let sw = imgWidth;
  let sh = imgHeight;

  if (imgAspect > targetAspect) {
    sw = imgHeight * targetAspect;
    sx = (imgWidth - sw) / 2;
  } else if (imgAspect < targetAspect) {
    sh = imgWidth / targetAspect;
    sy = (imgHeight - sh) / 2;
  }

  context.drawImage(image, sx, sy, sw, sh, 0, 0, canvasWidth, canvasHeight);
}

let micaGrid: string[][] = [];

export function getMicaColorAt(rect: { left: number; top: number; width: number; height: number }): string {
  if (micaGrid.length === 0 || micaGrid[0].length === 0) {
    const root = document.documentElement;
    const isDark = root.getAttribute('data-theme') === 'dark';
    return isDark ? '#292d34' : '#f2f6fc';
  }

  const vw = Math.max(window.innerWidth, 1);
  const vh = Math.max(window.innerHeight, 1);

  const x1 = Math.max(0, Math.min(1, rect.left / vw));
  const y1 = Math.max(0, Math.min(1, rect.top / vh));
  const x2 = Math.max(0, Math.min(1, (rect.left + rect.width) / vw));
  const y2 = Math.max(0, Math.min(1, (rect.top + rect.height) / vh));

  const rows = micaGrid.length;
  const cols = micaGrid[0].length;

  const gx1 = Math.min(cols - 1, Math.floor(x1 * cols));
  const gy1 = Math.min(rows - 1, Math.floor(y1 * rows));
  const gx2 = Math.min(cols - 1, Math.floor(x2 * cols));
  const gy2 = Math.min(rows - 1, Math.floor(y2 * rows));

  const colorTL = micaGrid[gy1][gx1];
  const colorBR = micaGrid[gy2][gx2];

  if (colorTL === colorBR) {
    return colorTL;
  }
  return `linear-gradient(135deg, ${colorTL}, ${colorBR})`;
}

export function applyElementMicaBackground(element: HTMLElement): void {
  if (currentPerformanceConfig.material !== 'mica') return;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const micaStyle = getMicaColorAt(rect);
  element.style.setProperty('--color-card-bg', micaStyle);
}

export function refreshAllMicaElements(): void {
  if (currentPerformanceConfig.material !== 'mica') return;
  const elements = document.querySelectorAll('.dashboard-cell, ui-card, .modal-panel, .drawer-panel');
  elements.forEach(el => {
    applyElementMicaBackground(el as HTMLElement);
  });
}

let lastExtractedThemeColors: WallpaperThemeColors | null = null;

export function sampleMicaColors(source?: HTMLImageElement): WallpaperThemeColors | null {
  const root = document.documentElement;
  const isDark = root.getAttribute('data-theme') === 'dark';

  const applyFallback = () => {
    micaGrid = [];
    const fallbackMica = isDark ? '#22252a' : '#e8edf5';
    const fallbackCard = isDark ? '#292d34' : '#f2f6fc';
    root.style.setProperty('--color-surface-mica', fallbackMica);
    if (currentPerformanceConfig.material === 'mica') {
      root.style.setProperty('--color-card-bg', fallbackCard);
    } else if (currentPerformanceConfig.material === 'acrylic') {
      root.style.removeProperty('--color-card-bg');
    }
    if (root.getAttribute('data-wallpaper-accent') === 'true') {
      const defaultPrimary = isDark ? '#4cc2ff' : '#0078d4';
      applyAccentColor(defaultPrimary);
    }
  };

  if (!(source instanceof HTMLImageElement)) {
    if (lastExtractedThemeColors !== null) {
      applyThemeColors(lastExtractedThemeColors);
      return lastExtractedThemeColors;
    }
    applyFallback();
    return null;
  }

  const processLoadedImage = (image: HTMLImageElement): WallpaperThemeColors | null => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 36;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) {
        console.warn('[MicaSampler] Canvas 2D context creation failed: getContext returned null');
        applyFallback();
        return null;
      }

      drawCoverImageToCanvas(context, image, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let globalR = 0;
      let globalG = 0;
      let globalB = 0;
      let globalCount = 0;

      const gridCols = 16;
      const gridRows = 9;
      const cellWidth = Math.floor(canvas.width / gridCols);
      const cellHeight = Math.floor(canvas.height / gridRows);
      micaGrid = Array.from({ length: gridRows }, () => Array.from({ length: gridCols }, () => ''));

      const blend = isDark ? 0.6 : 0.64;
      const target = isDark ? [28, 32, 40] : [242, 244, 248];

      const rawGrid: [number, number, number][][] = Array.from({ length: gridRows }, () =>
        Array.from({ length: gridCols }, () => [target[0], target[1], target[2]])
      );

      const quadR = [0, 0, 0, 0, 0];
      const quadG = [0, 0, 0, 0, 0];
      const quadB = [0, 0, 0, 0, 0];
      const quadCount = [0, 0, 0, 0, 0];

      const halfWidth = canvas.width / 2;
      const halfHeight = canvas.height / 2;
      const centerStartX = Math.round(canvas.width * 0.25);
      const centerEndX = Math.round(canvas.width * 0.75);
      const centerStartY = Math.round(canvas.height * 0.25);
      const centerEndY = Math.round(canvas.height * 0.75);

      for (let gy = 0; gy < gridRows; gy++) {
        for (let gx = 0; gx < gridCols; gx++) {
          let sumR = 0;
          let sumG = 0;
          let sumB = 0;
          let count = 0;

          const startX = gx * cellWidth;
          const endX = Math.min(canvas.width, startX + cellWidth);
          const startY = gy * cellHeight;
          const endY = Math.min(canvas.height, startY + cellHeight);

          for (let py = startY; py < endY; py++) {
            for (let px = startX; px < endX; px++) {
              const offset = (py * canvas.width + px) * 4;
              const r = pixels[offset];
              const g = pixels[offset + 1];
              const b = pixels[offset + 2];
              const a = pixels[offset + 3];

              if (a > 50) {
                sumR += r;
                sumG += g;
                sumB += b;
                count++;
                globalR += r;
                globalG += g;
                globalB += b;
                globalCount++;

                const quadIndex = (py < halfHeight ? 0 : 2) + (px < halfWidth ? 0 : 1);
                quadR[quadIndex] += r;
                quadG[quadIndex] += g;
                quadB[quadIndex] += b;
                quadCount[quadIndex]++;

                if (px >= centerStartX && px <= centerEndX && py >= centerStartY && py <= centerEndY) {
                  quadR[4] += r;
                  quadG[4] += g;
                  quadB[4] += b;
                  quadCount[4]++;
                }
              }
            }
          }

          if (count > 0) {
            const avgR = sumR / count;
            const avgG = sumG / count;
            const avgB = sumB / count;

            const [h, s, l] = rgbToHsl(avgR, avgG, avgB);
            const subduedS = s * 0.4;
            const [desatR, desatG, desatB] = hslToRgb(h, subduedS, l);

            const finalR = Math.round(desatR * (1 - blend) + target[0] * blend);
            const finalG = Math.round(desatG * (1 - blend) + target[1] * blend);
            const finalB = Math.round(desatB * (1 - blend) + target[2] * blend);

            rawGrid[gy][gx] = [finalR, finalG, finalB];
          }
        }
      }

      for (let gy = 0; gy < gridRows; gy++) {
        for (let gx = 0; gx < gridCols; gx++) {
          let smoothR = 0;
          let smoothG = 0;
          let smoothB = 0;
          let neighborhoodCount = 0;

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const ny = gy + dy;
              const nx = gx + dx;
              if (ny >= 0 && ny < gridRows && nx >= 0 && nx < gridCols) {
                smoothR += rawGrid[ny][nx][0];
                smoothG += rawGrid[ny][nx][1];
                smoothB += rawGrid[ny][nx][2];
                neighborhoodCount++;
              }
            }
          }

          const r = Math.round(smoothR / neighborhoodCount);
          const g = Math.round(smoothG / neighborhoodCount);
          const b = Math.round(smoothB / neighborhoodCount);

          micaGrid[gy][gx] = `rgb(${r}, ${g}, ${b})`;
        }
      }

      if (globalCount === 0) {
        applyFallback();
        return null;
      }

      const sampledRed = Math.round(globalR / globalCount);
      const sampledGreen = Math.round(globalG / globalCount);
      const sampledBlue = Math.round(globalB / globalCount);

      const [gh, gs, gl] = rgbToHsl(sampledRed, sampledGreen, sampledBlue);
      const [gDesatR, gDesatG, gDesatB] = hslToRgb(gh, gs * 0.4, gl);

      const finalRed = Math.round(gDesatR * (1 - blend) + target[0] * blend);
      const finalGreen = Math.round(gDesatG * (1 - blend) + target[1] * blend);
      const finalBlue = Math.round(gDesatB * (1 - blend) + target[2] * blend);
      const dominantColor = `rgb(${finalRed}, ${finalGreen}, ${finalBlue})`;

      root.style.setProperty('--color-surface-mica', dominantColor);
      if (currentPerformanceConfig.material === 'mica') {
        refreshAllMicaElements();
      } else if (currentPerformanceConfig.material === 'acrylic') {
        root.style.removeProperty('--color-card-bg');
      }

      const quadColors: string[] = [];
      for (let index = 0; index < 5; index++) {
        if (quadCount[index] > 0) {
          const rawR = Math.round(quadR[index] / quadCount[index]);
          const rawG = Math.round(quadG[index] / quadCount[index]);
          const rawB = Math.round(quadB[index] / quadCount[index]);
          const [qH, qS, qL] = rgbToHsl(rawR, rawG, rawB);
          const subduedS = Math.min(60, Math.round(qS * 0.8));
          const boostedL = isDark
            ? Math.max(16, Math.min(32, qL * 0.8 + (index % 2 === 0 ? 3 : -3)))
            : Math.min(94, Math.max(80, qL * 1.05 + (index % 2 === 0 ? 2 : -2)));
          quadColors.push(`hsl(${Math.round(qH)}, ${Math.round(subduedS)}%, ${Math.round(boostedL)}%)`);
        } else {
          quadColors.push(dominantColor);
        }
      }

      const gradientBackground = [
        `radial-gradient(at 10% 10%, ${quadColors[0]} 0%, transparent 65%)`,
        `radial-gradient(at 90% 10%, ${quadColors[1]} 0%, transparent 65%)`,
        `radial-gradient(at 50% 50%, ${quadColors[4]} 0%, transparent 60%)`,
        `radial-gradient(at 10% 90%, ${quadColors[2]} 0%, transparent 65%)`,
        `radial-gradient(at 90% 90%, ${quadColors[3]} 0%, transparent 65%)`,
        dominantColor,
      ].join(', ');

      const [hue, saturation] = rgbToHsl(sampledRed, sampledGreen, sampledBlue);
      const accentSaturation = Math.max(35, Math.min(75, Math.round(saturation * 1.1)));
      const accentLightness = isDark ? 68 : 44;
      const accentPrimary = `hsl(${Math.round(hue)}, ${Math.round(accentSaturation)}%, ${Math.round(accentLightness)}%)`;
      const palette = generateAccentPalette(accentPrimary);
      const accentHover = palette.hover;
      const accentGlow = palette.glow;
      const accentBorderHover = palette.cardBorderHover;

      if (root.getAttribute('data-wallpaper-accent') === 'true') {
        applyAccentPalette(palette);
      }

      const result: WallpaperThemeColors = {
        dominantColor,
        gradientBackground,
        micaColor: dominantColor,
        accentPrimary,
        accentHover,
        accentGlow,
        accentBorderHover,
      };
      lastExtractedThemeColors = result;
      return result;
    } catch (error) {
      console.warn('[MicaSampler] Background sampling failed:', error);
      applyFallback();
      return null;
    }
  };

  return processLoadedImage(source);
}

export interface WallpaperThemeColors {
  dominantColor: string;
  gradientBackground?: string;
  micaColor?: string;
  accentPrimary?: string;
  accentHover?: string;
  accentGlow?: string;
  accentBorderHover?: string;
}

export function extractThemeColorsFromImage(image: HTMLImageElement): WallpaperThemeColors | null {
  return sampleMicaColors(image);
}

export function applyThemeColors(colors: WallpaperThemeColors): void {
  lastExtractedThemeColors = colors;
  const root = document.documentElement;
  if (colors.micaColor !== undefined) {
    root.style.setProperty('--color-surface-mica', colors.micaColor);
    if (currentPerformanceConfig.material === 'mica') {
      refreshAllMicaElements();
    }
  }

  if (root.getAttribute('data-wallpaper-accent') === 'true' && colors.accentPrimary !== undefined) {
    applyAccentColor(colors.accentPrimary);
  }
}
