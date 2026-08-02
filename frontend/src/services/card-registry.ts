import type { AppUnifiedConfig, BootstrapConfig } from './config-service';
import { buildDataApiUrl, getApiHeaders, getBootstrapConfig } from './config-service';
import type { CardModule, UICardHost } from '../components/card-host';

export interface StoredCardBundle {
  id: string;
  code: string;
  timestamp: number;
}

export interface CardMetadata {
  id: string;
  name: string;
  /** 内置图标名称,或已通过安全校验的内联 SVG 字符串。 */
  icon: string;
  description: string;
}

const BUILTIN_ICON_NAMES = new Set<string>([
  'sun', 'moon', 'settings', 'save', 'info', 'check', 'x', 'code', 'menu',
  'sliders', 'bookmark', 'calendar', 'chevron', 'zap', 'globe', 'star',
  'cloud-sun', 'image', 'layout', 'grid', 'gauge', 'arrow-left', 'trash',
  'plus', 'copy', 'key', 'palette', 'refresh', 'eye', 'eye-off', 'search',
  'external-link',
]);

const SVG_FORBIDDEN_ELEMENTS = new Set([
  'script', 'foreignobject', 'iframe', 'object', 'embed', 'link', 'meta',
  'audio', 'video', 'a', 'image', 'use',
]);

/**
 * 校验卡片自定义 SVG 图标:必须是合法 SVG,且不含脚本、事件处理器、
 * 外部引用等可注入内容。校验失败返回 null。
 */
function sanitizeSvgIcon(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^<svg[\s>]/i.test(trimmed)) return null;

  const doc = new DOMParser().parseFromString(trimmed, 'image/svg+xml');
  if (doc.querySelector('parsererror') !== null) return null;
  const root = doc.documentElement;
  if (root.tagName.toLowerCase() !== 'svg') return null;

  const walk = (element: Element): boolean => {
    if (SVG_FORBIDDEN_ELEMENTS.has(element.tagName.toLowerCase())) return false;
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')) return false;
      if (/javascript\s*:/i.test(attribute.value)) return false;
      if ((name === 'href' || name === 'xlink:href') && !attribute.value.trim().startsWith('#')) {
        return false;
      }
    }
    return Array.from(element.children).every(walk);
  };

  return walk(root) ? trimmed : null;
}

function resolveCardIcon(icon: unknown): string {
  if (typeof icon !== 'string' || icon.trim() === '') return 'code';
  if (BUILTIN_ICON_NAMES.has(icon)) return icon;
  const svg = sanitizeSvgIcon(icon);
  if (svg !== null) return svg;
  console.warn('[CardRegistry] Card icon is neither a builtin name nor a safe SVG, falling back.');
  return 'code';
}

const moduleRegistry = new Map<string, CardModule>();
const metadataRegistry = new Map<string, CardMetadata>();

export function registerCardModule(type: string, cardModule: CardModule): void {
  if (typeof cardModule.mount !== 'function') {
    throw new Error(`Card module "${type}" does not export mount(shadowRoot, sdk).`);
  }
  moduleRegistry.set(type, cardModule);
  metadataRegistry.set(type, {
    id: type,
    name: typeof cardModule.name === 'string' && cardModule.name.trim() !== ''
      ? cardModule.name.trim()
      : type,
    icon: resolveCardIcon(cardModule.icon),
    description: typeof cardModule.description === 'string' ? cardModule.description.trim() : '',
  });
}

export function unregisterCardModule(type: string): void {
  moduleRegistry.delete(type);
  metadataRegistry.delete(type);
}

export function getCardModule(type: string): CardModule | undefined {
  return moduleRegistry.get(type);
}

export function getCardMetadata(type: string): CardMetadata | undefined {
  return metadataRegistry.get(type);
}

export function evaluateCardModule(code: string, cardId: string): CardModule {
  const exportsObject: { default?: CardModule } & Partial<CardModule> = {};
  const moduleObject: { exports: typeof exportsObject | CardModule } = { exports: exportsObject };
  const cleanedCode = code.trim().replace(/export\s+default\s+/, 'module.exports = ');
  const runner = new Function(
    'exports',
    'module',
    `"use strict";\n${cleanedCode}\n//# sourceURL=card-${encodeURIComponent(cardId)}.js`,
  );
  runner(moduleObject.exports, moduleObject);

  const exported = moduleObject.exports as typeof exportsObject;
  const cardModule = exported.default !== undefined ? exported.default : exported as CardModule;
  if (!cardModule || typeof cardModule.mount !== 'function') {
    throw new Error('Card code must export an object with mount(shadowRoot, sdk).');
  }
  return cardModule;
}

export async function fetchStoredCardBundle(
  cardId: string,
  bootstrap: BootstrapConfig = getBootstrapConfig(),
): Promise<StoredCardBundle> {
  const response = await fetch(buildDataApiUrl(`cards/${encodeURIComponent(cardId)}`, bootstrap), {
    headers: getApiHeaders(undefined, bootstrap),
  });
  if (!response.ok) {
    throw new Error(`Card bundle "${cardId}" returned HTTP ${response.status}`);
  }
  const text = await response.text();
  let code = text;
  let timestamp = Date.now();

  try {
    if (text.trim().startsWith('{')) {
      const parsed = JSON.parse(text) as Partial<StoredCardBundle>;
      if (typeof parsed.code === 'string') {
        code = parsed.code;
      }
      if (typeof parsed.timestamp === 'number') {
        timestamp = parsed.timestamp;
      }
    }
  } catch (error) {
    console.warn(`[CardRegistry] Failed to parse card payload as JSON for "${cardId}", falling back to raw JS code:`, error);
  }

  return {
    id: cardId,
    code,
    timestamp,
  };
}

export async function saveStoredCardBundle(
  bundle: StoredCardBundle,
  bootstrap: BootstrapConfig = getBootstrapConfig(),
): Promise<boolean> {
  const response = await fetch(buildDataApiUrl(`cards/${encodeURIComponent(bundle.id)}`, bootstrap), {
    method: 'POST',
    headers: getApiHeaders({ 'Content-Type': 'application/javascript' }, bootstrap),
    body: bundle.code,
  });
  return response.ok;
}

export async function deleteStoredCardBundle(
  cardId: string,
  bootstrap: BootstrapConfig = getBootstrapConfig(),
): Promise<boolean> {
  const response = await fetch(buildDataApiUrl(`cards/${encodeURIComponent(cardId)}`, bootstrap), {
    method: 'DELETE',
    headers: getApiHeaders(undefined, bootstrap),
  });
  return response.ok || response.status === 404;
}

/** 列出后端 data/cards 目录下所有卡片 ID(文件名即 ID)。 */
export async function fetchCardIdList(
  bootstrap: BootstrapConfig = getBootstrapConfig(),
): Promise<string[]> {
  const response = await fetch(buildDataApiUrl('cards', bootstrap), {
    headers: getApiHeaders(undefined, bootstrap),
  });
  if (!response.ok) {
    throw new Error(`Card list request returned HTTP ${response.status}`);
  }
  const data = await response.json() as { cards?: unknown };
  if (!Array.isArray(data.cards)) return [];
  return data.cards.filter((id): id is string => typeof id === 'string');
}

/** 按需加载:仅拉取并注册尚未加载的卡片模块。 */
export async function ensureCardsLoaded(
  cardIds: string[],
  bootstrap: BootstrapConfig = getBootstrapConfig(),
): Promise<void> {
  const missingIds = Array.from(new Set(cardIds)).filter(id => !moduleRegistry.has(id));
  await Promise.all(missingIds.map(async cardId => {
    try {
      const bundle = await fetchStoredCardBundle(cardId, bootstrap);
      registerCardModule(cardId, evaluateCardModule(bundle.code, cardId));
    } catch (error) {
      console.error(`[CardRegistry] Failed to load card "${cardId}":`, error);
    }
  }));
}

/** 启动时只加载面板上实际摆放的卡片类型。 */
export async function loadCustomCardModules(config: AppUnifiedConfig): Promise<void> {
  const usedTypes = config.cards
    .map(card => card.type)
    .filter((type): type is string => typeof type === 'string' && type !== '');
  await ensureCardsLoaded(usedTypes);
}

function createUnavailableCardModule(type: string): CardModule {
  return {
    mount: shadowRoot => {
      const container = shadowRoot.querySelector('.card-container');
      if (container === null) return;
      container.textContent = '';
      const card = document.createElement('ui-card');
      card.setAttribute('title', '卡片无法加载');
      const message = document.createElement('p');
      message.style.color = 'var(--color-text-secondary)';
      message.style.fontSize = '13px';
      message.textContent = `没有找到ID为“${type}”的卡片文件。`;
      card.appendChild(message);
      container.appendChild(card);
    },
  };
}

export function mountRegisteredCard(host: UICardHost, type: string): void {
  const cardModule = getCardModule(type) || createUnavailableCardModule(type);
  host.mountCardModule(cardModule);
}
