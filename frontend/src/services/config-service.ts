import { CardLayoutItem } from '../layout/grid-packer';
import { PerformanceConfig, sampleMicaColors } from '../utils/performance';
import type { WallpaperData } from './wallpaper-service';
import { showToast } from '../components/ui-toast';

export type ThemeMode = 'system' | 'light' | 'dark';

export type HeaderPreset = 'clock' | 'search' | 'clock_search' | 'script' | 'none';
export type HeaderOpenTarget = '_self' | '_blank';
export type HeaderSuggestAction = 'search' | 'fill';

export interface HeaderConfig {
  preset: HeaderPreset;
  scriptCode?: string;
  searchEngine?: 'bing' | 'google' | 'baidu' | 'duckduckgo';
  openTarget?: HeaderOpenTarget;
  enableSuggest?: boolean;
  suggestAction?: HeaderSuggestAction;
}

export interface BootstrapConfig {
  baseUrl: string;
  dataRoot: string;
  theme: ThemeMode;
  apiToken?: string;
}

export interface AppearanceConfig {
  accentColor: string;
  useWallpaperAccent: boolean;
  radius: number;
  cardMinWidth: number;
  cardRowHeight: number;
}

export interface AppUnifiedConfig {
  version: string;
  theme: ThemeMode;
  editMode: boolean;
  header: HeaderConfig;
  appearance: AppearanceConfig;
  performance: PerformanceConfig;
  wallpaper: WallpaperData;
  cards: CardLayoutItem[];
  settings: Record<string, unknown>;
}

export const DEFAULT_BOOTSTRAP_CONFIG: BootstrapConfig = {
  baseUrl: '/',
  dataRoot: 'api/data',
  theme: 'system',
};

export const DEFAULT_HEADER_SCRIPT = `
// 自定义 Header 脚本示例
// 参数：
//   container: Header 内容的 DOM 容器 HTMLElement
//   utils: 包含 getIconSvg 等辅助工具
// 返回：可选 cleanup 清理闭包，在组件重新渲染或卸载时自动调用

container.innerHTML = \`
  <div style="display: flex; flex-direction: column; gap: 10px;">
    <div style="display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px; border-radius: 12px; background: rgba(0, 120, 212, 0.18); border: 1px solid rgba(0, 120, 212, 0.35); width: fit-content;">
      <span style="width: 8px; height: 8px; border-radius: 50%; background: #107c10; box-shadow: 0 0 8px #107c10;"></span>
      <span style="font-size: 12.5px; font-weight: 600; color: var(--color-text-primary);">✨ 自定义 Header 脚本已生效</span>
    </div>
    <div id="custom-header-clock" style="font-size: 60px; font-weight: 700; color: var(--color-text-primary); text-shadow: 0 4px 20px rgba(0, 0, 0, 0.5); line-height: 1; letter-spacing: -1.5px;">
    </div>
    <div id="custom-header-sub" style="font-size: 15px; font-weight: 600; color: var(--color-text-primary); text-shadow: 0 2px 8px rgba(0, 0, 0, 0.75);">
    </div>
  </div>
\`;

const clockElem = container.querySelector('#custom-header-clock');
const subElem = container.querySelector('#custom-header-sub');

const update = () => {
  const now = new Date();
  if (clockElem !== null) {
    clockElem.textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
  }
  if (subElem !== null) {
    const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
    subElem.textContent = \`\${now.toLocaleDateString('zh-CN', options)} · 自定义视图\`;
  }
};

update();
const timer = setInterval(update, 1000);

return () => {
  clearInterval(timer);
};
`.trim();

export const DEFAULT_HEADER_CONFIG: HeaderConfig = {
  preset: 'clock',
  scriptCode: DEFAULT_HEADER_SCRIPT,
  searchEngine: 'bing',
  openTarget: '_blank',
  enableSuggest: true,
  suggestAction: 'search',
};

export const DEFAULT_UNIFIED_CONFIG: AppUnifiedConfig = {
  version: '1.1.0',
  theme: 'system',
  editMode: false,
  header: DEFAULT_HEADER_CONFIG,
  appearance: {
    accentColor: '#0078d4',
    useWallpaperAccent: false,
    radius: 12,
    cardMinWidth: 280,
    cardRowHeight: 260,
  },
  performance: {
    preset: 'high',
    material: 'acrylic',
    enableBlur: true,
    enableOverlayBlur: true,
    enableShimmer: true,
    enableFlipModal: true,
    enableFlipSourceAnimation: false,
    blurRadius: 16,
    overlayBlurRadius: 4,
  },
  wallpaper: {
    source: 'bing',
    url: 'https://bing.biturl.top/?resolution=1920&format=image&index=0&mkt=zh-CN',
    blurRadius: 0,
    maskOpacity: 0.15,
    ttlHours: 24,
    timestamp: 0,
  },
  cards: [],
  settings: {},
};


function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function normalizeDataRoot(value: string): string {
  const normalized = value.trim().replace(/^\/+|\/+$/g, '');
  if (normalized === '' || normalized === 'data') {
    return 'api/data';
  }
  return normalized;
}

export function getBootstrapConfig(): BootstrapConfig {
  const raw = localStorage.getItem('app_bootstrap');
  if (raw === null) {
    return { ...DEFAULT_BOOTSTRAP_CONFIG };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<BootstrapConfig>;
    const theme: ThemeMode = parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'system'
      ? parsed.theme
      : DEFAULT_BOOTSTRAP_CONFIG.theme;
    return {
      baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim() !== ''
        ? normalizeBaseUrl(parsed.baseUrl)
        : DEFAULT_BOOTSTRAP_CONFIG.baseUrl,
      dataRoot: typeof parsed.dataRoot === 'string'
        ? normalizeDataRoot(parsed.dataRoot)
        : DEFAULT_BOOTSTRAP_CONFIG.dataRoot,
      theme,
      apiToken: typeof parsed.apiToken === 'string' && parsed.apiToken !== '' ? parsed.apiToken : undefined,
    };
  } catch (error) {
    console.warn('[ConfigService] Failed to parse bootstrap config:', error);
    return { ...DEFAULT_BOOTSTRAP_CONFIG };
  }
}

export function saveBootstrapConfig(config: BootstrapConfig): void {
  const normalized: BootstrapConfig = {
    baseUrl: normalizeBaseUrl(config.baseUrl),
    dataRoot: normalizeDataRoot(config.dataRoot),
    theme: config.theme,
    apiToken: config.apiToken && config.apiToken !== '' ? config.apiToken : undefined,
  };
  localStorage.setItem('app_bootstrap', JSON.stringify(normalized));
}

export function getApiHeaders(extra?: HeadersInit, bootstrap: BootstrapConfig = getBootstrapConfig()): Headers {
  const headers = new Headers(extra);
  if (bootstrap.apiToken) {
    headers.set('X-App-Token', bootstrap.apiToken);
  }
  return headers;
}

export function buildApiUrl(path: string, bootstrap: BootstrapConfig = getBootstrapConfig()): string {
  const normalizedPath = path.replace(/^\/+/, '');
  return `${normalizeBaseUrl(bootstrap.baseUrl)}/api/${normalizedPath}`;
}

export function buildDataApiUrl(path: string, bootstrap: BootstrapConfig = getBootstrapConfig()): string {
  const normalizedPath = path.replace(/^\/+/, '');
  return `${normalizeBaseUrl(bootstrap.baseUrl)}/${normalizeDataRoot(bootstrap.dataRoot)}/${normalizedPath}`;
}

function mergeWithDefaultConfig(fetched: Partial<AppUnifiedConfig>): AppUnifiedConfig {
  const defaults = deepClone(DEFAULT_UNIFIED_CONFIG);
  const theme: ThemeMode = fetched.theme === 'light' || fetched.theme === 'dark' || fetched.theme === 'system'
    ? fetched.theme
    : defaults.theme;

  const cards = Array.isArray(fetched.cards)
    ? fetched.cards.map((card, index) => ({
      ...card,
      order: typeof card.order === 'number' ? card.order : index + 1,
    }))
    : defaults.cards;

  const fetchedHeader = fetched.header && typeof fetched.header === 'object' ? fetched.header : undefined;
  let header: HeaderConfig;
  if (fetchedHeader !== undefined) {
    const validPresets: HeaderPreset[] = ['clock', 'search', 'clock_search', 'script', 'none'];
    const preset = validPresets.includes(fetchedHeader.preset)
      ? fetchedHeader.preset
      : defaults.header.preset;

    const validEngines = ['bing', 'google', 'baidu', 'duckduckgo'];
    const searchEngine = fetchedHeader.searchEngine && validEngines.includes(fetchedHeader.searchEngine)
      ? fetchedHeader.searchEngine
      : defaults.header.searchEngine;

    const scriptCode = typeof fetchedHeader.scriptCode === 'string' && fetchedHeader.scriptCode.trim() !== ''
      ? fetchedHeader.scriptCode
      : defaults.header.scriptCode;

    const validTargets: HeaderOpenTarget[] = ['_self', '_blank'];
    const openTarget = fetchedHeader.openTarget && validTargets.includes(fetchedHeader.openTarget)
      ? fetchedHeader.openTarget
      : defaults.header.openTarget;

    const enableSuggest = typeof fetchedHeader.enableSuggest === 'boolean'
      ? fetchedHeader.enableSuggest
      : defaults.header.enableSuggest;

    const validSuggestActions: HeaderSuggestAction[] = ['search', 'fill'];
    const suggestAction = fetchedHeader.suggestAction && validSuggestActions.includes(fetchedHeader.suggestAction)
      ? fetchedHeader.suggestAction
      : defaults.header.suggestAction;

    header = {
      preset,
      scriptCode,
      searchEngine,
      openTarget,
      enableSuggest,
      suggestAction,
    };
  } else {
    header = defaults.header;
  }

  return {
    version: typeof fetched.version === 'string' ? fetched.version : defaults.version,
    theme,
    editMode: typeof fetched.editMode === 'boolean' ? fetched.editMode : defaults.editMode,
    header,
    appearance: fetched.appearance
      ? { ...defaults.appearance, ...fetched.appearance }
      : defaults.appearance,
    performance: fetched.performance
      ? { ...defaults.performance, ...fetched.performance }
      : defaults.performance,
    wallpaper: fetched.wallpaper
      ? { ...defaults.wallpaper, ...fetched.wallpaper }
      : defaults.wallpaper,
    cards,
    settings: fetched.settings && typeof fetched.settings === 'object' ? fetched.settings : {},
  };
}

export async function fetchUnifiedConfig(bootstrap: BootstrapConfig = getBootstrapConfig()): Promise<AppUnifiedConfig> {
  const configUrl = buildDataApiUrl('config', bootstrap);
  try {
    const response = await fetch(configUrl, { headers: getApiHeaders(undefined, bootstrap) });
    if (!response.ok) {
      console.warn(`[ConfigService] Config request returned HTTP ${response.status}`);
      throw new Error(`Config request returned HTTP ${response.status}`);
    }
    const data = await response.json() as Partial<AppUnifiedConfig>;
    const merged = mergeWithDefaultConfig(data);
    syncBootstrapTheme(merged.theme);
    return merged;
  } catch (error) {
    console.warn('[ConfigService] Failed to fetch config, using local defaults:', error);
    const fallback = deepClone(DEFAULT_UNIFIED_CONFIG);
    syncBootstrapTheme(fallback.theme);
    return fallback;
  }
}

export async function saveUnifiedConfig(
  config: AppUnifiedConfig,
  silent: boolean = false,
  bootstrap: BootstrapConfig = getBootstrapConfig(),
): Promise<boolean> {
  const configUrl = buildDataApiUrl('config', bootstrap);
  try {
    const response = await fetch(configUrl, {
      method: 'POST',
      headers: getApiHeaders({ 'Content-Type': 'application/json' }, bootstrap),
      body: JSON.stringify(config),
    });
    if (!response.ok) {
      console.warn(`[ConfigService] Config save returned HTTP ${response.status}`);
      if (!silent) showToast({ message: '保存失败，请重试', type: 'warning' });
      return false;
    }
    if (!silent) showToast({ message: '设置保存成功', type: 'success' });
    return true;
  } catch (error) {
    console.warn('[ConfigService] Config save failed:', error);
    if (!silent) showToast({ message: '网络异常，无法保存设置', type: 'error' });
    return false;
  }
}

export function syncBootstrapTheme(theme: ThemeMode): void {
  const bootstrap = getBootstrapConfig();
  saveBootstrapConfig({ ...bootstrap, theme });

  let actualTheme: 'light' | 'dark' = theme === 'dark' ? 'dark' : 'light';
  if (theme === 'system') {
    actualTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  document.documentElement.setAttribute('data-theme', actualTheme);
  sampleMicaColors();
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const bootstrap = getBootstrapConfig();
  if (bootstrap.theme === 'system') {
    syncBootstrapTheme('system');
  }
});
