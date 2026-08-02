import { showToast } from '../components/ui-toast';
import {
  buildApiUrl,
  buildDataApiUrl,
  getApiHeaders,
  getBootstrapConfig,
} from '../services/config-service';
import {
  EnvironmentRegistration,
  registerEnvironmentVariable,
} from '../services/environment-service';
import {
  CardSettingDefinition,
  RegisteredCardSetting,
  getSettingValue,
  registerCardSetting,
} from '../services/settings-registry';

export interface CardEnvironment {
  baseUrl: string;
  dataRoot: string;
  theme: 'light' | 'dark';
}

export type EventCallback = (data: unknown) => void;
export type CacheResponseType = 'auto' | 'json' | 'text' | 'blob' | 'arrayBuffer';

class CardEventBus {
  private listeners: Map<string, Set<EventCallback>> = new Map();

  public on(event: string, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    const callbacks = this.listeners.get(event);
    if (callbacks !== undefined) callbacks.add(callback);
    return () => this.off(event, callback);
  }

  public off(event: string, callback: EventCallback): void {
    this.listeners.get(event)?.delete(callback);
  }

  public emit(event: string, data?: unknown): void {
    this.listeners.get(event)?.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`[CardEventBus] Listener for "${event}" failed:`, error);
      }
    });
  }
}

export interface CardSDKCacheOptions {
  expireTime?: number;
  ttlHours?: number;
  ttlSeconds?: number;
  autoExtend?: boolean;
}

export interface CardSDKCacheDownloadResult {
  url: string;
  thumbnail?: string;
}

export interface CardSDKCache {
  get: (key: string, responseType?: CacheResponseType) => Promise<unknown>;
  set: (key: string, data: unknown, options?: CardSDKCacheOptions | number) => Promise<boolean>;
  delete: (key: string) => Promise<boolean>;
  downloadImage: (
    url: string,
    options?: { key?: string; expireTime?: number; ttlHours?: number; ttlSeconds?: number; autoExtend?: boolean },
  ) => Promise<CardSDKCacheDownloadResult>;
}

export interface CardSDKSettings {
  register: (
    definition: CardSettingDefinition,
    handlers?: Pick<RegisteredCardSetting, 'serialize' | 'deserialize'>,
  ) => void;
  get: <T>(id: string, expectedDefault?: T) => T;
  onChange: (id: string, callback: (value: unknown) => void) => () => void;
}

export interface CardSDK {
  instanceId: string;
  cardType: string;
  proxyFetch: (url: string, init?: RequestInit) => Promise<Response>;
  registerEnvironmentVariable: (definition: Omit<EnvironmentRegistration, 'requestedBy'>) => Promise<string>;
  getEnvironmentAsync: (key?: string) => Promise<string | CardEnvironment>;
  getEnvironment: (key?: string) => string | CardEnvironment;
  navigate: (url: string, target?: '_self' | '_blank') => void;
  cache: CardSDKCache;
  data: CardSDKCache;
  settings: CardSDKSettings;
  eventBus: CardEventBus;
  showToast: typeof showToast;
}

const cachedEnvironmentValues: Record<string, string> = {};

function getRuntimeEnvironment(): CardEnvironment {
  const bootstrap = getBootstrapConfig();
  const themeAttribute = document.documentElement.getAttribute('data-theme');
  return {
    baseUrl: bootstrap.baseUrl,
    dataRoot: bootstrap.dataRoot,
    theme: themeAttribute === 'dark' ? 'dark' : 'light',
  };
}

function normalizeCacheSegment(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/');
  if (normalized === '' || normalized.startsWith('/') || normalized.split('/').some(segment => segment === '..' || segment === '')) {
    throw new Error('Keys must be relative paths without empty or parent-directory segments.');
  }
  return normalized.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function normalizeCardNamespace(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]/g, '_');
  return normalized !== '' ? normalized : 'anonymous';
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function encodeProxyBody(body: BodyInit | null | undefined, headers: Headers): Promise<{
  body: unknown;
  bodyEncoding: 'text' | 'json' | 'base64';
}> {
  if (body === undefined || body === null) return { body: null, bodyEncoding: 'text' };
  if (typeof body === 'string') {
    const contentType = headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        return { body: JSON.parse(body) as unknown, bodyEncoding: 'json' };
      } catch (error) {
        console.warn('[CardSDK] JSON request body could not be parsed and will be sent as text:', error);
      }
    }
    return { body, bodyEncoding: 'text' };
  }
  if (body instanceof URLSearchParams) {
    if (!headers.has('content-type')) headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8');
    return { body: body.toString(), bodyEncoding: 'text' };
  }
  if (body instanceof Blob) {
    if (body.type && !headers.has('content-type')) headers.set('content-type', body.type);
    return { body: arrayBufferToBase64(await body.arrayBuffer()), bodyEncoding: 'base64' };
  }
  if (body instanceof FormData) {
    const response = new Response(body);
    const contentType = response.headers.get('content-type');
    if (contentType) headers.set('content-type', contentType);
    return { body: arrayBufferToBase64(await response.arrayBuffer()), bodyEncoding: 'base64' };
  }
  if (body instanceof ArrayBuffer) {
    return { body: arrayBufferToBase64(body), bodyEncoding: 'base64' };
  }
  if (ArrayBuffer.isView(body)) {
    const copy = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    return { body: arrayBufferToBase64(copy), bodyEncoding: 'base64' };
  }
  throw new Error('ReadableStream request bodies are not supported by proxyFetch.');
}

function createStorageApi(apiPrefix: 'cache' | 'storage', typeNs: string, instNs: string): CardSDKCache {
  const getNamespacedKey = (key: string): string =>
    `cards/${encodeURIComponent(typeNs)}/${encodeURIComponent(instNs)}/${normalizeCacheSegment(key)}`;

  return {
    get: async (key: string, responseType: CacheResponseType = 'auto'): Promise<unknown> => {
      const namespacedKey = getNamespacedKey(key);
      const response = await fetch(buildDataApiUrl(`${apiPrefix}/${namespacedKey}`), {
        headers: getApiHeaders(),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`${apiPrefix} read returned HTTP ${response.status}`);

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const resolvedType = responseType === 'auto'
        ? contentType.includes('json')
          ? 'json'
          : contentType.startsWith('text/')
            ? 'text'
            : contentType.startsWith('image/') || contentType.startsWith('audio/') || contentType.startsWith('video/')
              ? 'blob'
              : 'arrayBuffer'
        : responseType;

      if (resolvedType === 'json') return await response.json();
      if (resolvedType === 'text') return await response.text();
      if (resolvedType === 'blob') return await response.blob();
      return await response.arrayBuffer();
    },
    set: async (key: string, data: unknown, options?: CardSDKCacheOptions | number): Promise<boolean> => {
      const namespacedKey = getNamespacedKey(key);
      let body: BodyInit;
      let contentType: string;
      if (data instanceof Blob) {
        body = data;
        contentType = data.type || 'application/octet-stream';
      } else if (data instanceof ArrayBuffer) {
        body = data;
        contentType = 'application/octet-stream';
      } else if (ArrayBuffer.isView(data)) {
        const bytes = new Uint8Array(data.byteLength);
        bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        body = bytes.buffer;
        contentType = 'application/octet-stream';
      } else if (typeof data === 'string') {
        body = data;
        contentType = key.endsWith('.json') ? 'application/json' : 'text/plain;charset=UTF-8';
      } else {
        body = JSON.stringify(data);
        contentType = 'application/json';
      }

      const headersRecord: Record<string, string> = { 'Content-Type': contentType };
      if (typeof options === 'number') {
        headersRecord['X-Cache-Expire-Time'] = String(options);
      } else if (options !== undefined) {
        if (options.expireTime !== undefined) {
          headersRecord['X-Cache-Expire-Time'] = String(options.expireTime);
        }
        if (options.ttlHours !== undefined) {
          headersRecord['X-TTL-Hours'] = String(options.ttlHours);
        }
        if (options.ttlSeconds !== undefined) {
          headersRecord['X-TTL-Seconds'] = String(options.ttlSeconds);
        }
        if (options.autoExtend !== undefined) {
          headersRecord['X-Auto-Extend'] = String(options.autoExtend);
        }
      }

      const response = await fetch(buildDataApiUrl(`${apiPrefix}/${namespacedKey}`), {
        method: 'POST',
        headers: getApiHeaders(headersRecord),
        body,
      });
      return response.ok;
    },
    delete: async (key: string): Promise<boolean> => {
      const namespacedKey = getNamespacedKey(key);
      const response = await fetch(buildDataApiUrl(`${apiPrefix}/${namespacedKey}`), {
        method: 'DELETE',
        headers: getApiHeaders(),
      });
      return response.ok || response.status === 404;
    },
    downloadImage: async (
      url: string,
      options?: { key?: string; expireTime?: number; ttlHours?: number; ttlSeconds?: number; autoExtend?: boolean },
    ): Promise<CardSDKCacheDownloadResult> => {
      let targetKey: string | undefined = undefined;
      if (options !== undefined && options.key !== undefined) {
        const rawKey = options.key.trim();
        if (rawKey.startsWith('wallpapers/') || rawKey.startsWith('cards/')) {
          targetKey = normalizeCacheSegment(rawKey);
        } else {
          targetKey = getNamespacedKey(rawKey);
        }
      }
      const payload: Record<string, unknown> = { url };
      if (targetKey !== undefined) {
        payload.key = targetKey;
      }
      if (options !== undefined) {
        if (options.expireTime !== undefined) payload.expireTime = options.expireTime;
        if (options.ttlHours !== undefined) payload.ttlHours = options.ttlHours;
        if (options.ttlSeconds !== undefined) payload.ttlSeconds = options.ttlSeconds;
        if (options.autoExtend !== undefined) payload.autoExtend = options.autoExtend;
      }
      const response = await fetch(buildDataApiUrl('cache/download'), {
        method: 'POST',
        headers: getApiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        console.warn(`[CardSDKCache] downloadImage returned HTTP ${response.status}`);
        throw new Error(`downloadImage returned HTTP ${response.status}`);
      }
      const result = (await response.json()) as { url: string; key: string; thumbnail?: string };
      return {
        url: buildDataApiUrl(`cache/${result.key}`),
        thumbnail: result.thumbnail,
      };
    },
  };
}

export function createCardSDK(instanceId: string, cardType: string = 'system'): CardSDK {
  const globalEventBus = window.__card_event_bus || new CardEventBus();
  window.__card_event_bus = globalEventBus;
  const typeNs = normalizeCardNamespace(cardType);
  const instNs = normalizeCardNamespace(instanceId);

  const ensureEnvironmentVariable = async (
    definition: Omit<EnvironmentRegistration, 'requestedBy'>,
  ): Promise<string> => {
    const result = await registerEnvironmentVariable({ ...definition, requestedBy: `${cardType}:${instanceId}` });
    if (result.entry.value !== '') {
      cachedEnvironmentValues[result.key] = result.entry.value;
    }
    if (result.created) {
      showToast({
        message: `卡片请求了新的环境变量“${result.key}”，已添加到环境变量设置页。`,
        type: 'warning',
        duration: 4500,
      });
    }
    return result.entry.value;
  };

  return {
    instanceId,
    cardType,
    proxyFetch: async (targetUrl: string, init?: RequestInit): Promise<Response> => {
      const requestHeaders = new Headers(init && init.headers ? init.headers : undefined);
      const encodedBody = await encodeProxyBody(init ? init.body : undefined, requestHeaders);
      const headersObject: Record<string, string> = {};
      requestHeaders.forEach((value, key) => { headersObject[key] = value; });

      const proxyResponse = await fetch(buildApiUrl('proxy'), {
        method: 'POST',
        headers: getApiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          url: targetUrl,
          method: init && init.method ? init.method : 'GET',
          headers: headersObject,
          body: encodedBody.body,
          bodyEncoding: encodedBody.bodyEncoding,
        }),
      });

      if (!proxyResponse.ok) {
        const detail = await proxyResponse.text().catch(() => proxyResponse.statusText);
        console.warn(`[CardSDK] Proxy request to "${targetUrl}" rejected by backend: HTTP ${proxyResponse.status} – ${detail}`);
        throw new Error(`Proxy request failed: HTTP ${proxyResponse.status} – ${detail}`);
      }

      return proxyResponse;
    },

    registerEnvironmentVariable: ensureEnvironmentVariable,

    getEnvironmentAsync: async (key?: string): Promise<string | CardEnvironment> => {
      const runtimeEnv = getRuntimeEnvironment();
      if (key === undefined) return runtimeEnv;
      if (Object.prototype.hasOwnProperty.call(cachedEnvironmentValues, key) && cachedEnvironmentValues[key] !== '') {
        return cachedEnvironmentValues[key];
      }
      return await ensureEnvironmentVariable({ key, defaultValue: '', description: '', secret: true });
    },

    getEnvironment: (key?: string): string | CardEnvironment => {
      const runtimeEnv = getRuntimeEnvironment();
      if (key === undefined) return runtimeEnv;
      if (Object.prototype.hasOwnProperty.call(cachedEnvironmentValues, key)) {
        return cachedEnvironmentValues[key];
      }
      return '';
    },

    navigate: (url: string, target?: '_self' | '_blank' | '_top'): void => {
      const parsed = new URL(url, window.location.href);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Navigation blocked for unsupported scheme "${parsed.protocol}".`);
      }
      
      const openTarget = target || '_blank';
      
      if (openTarget === '_self' || openTarget === '_top') {
        const link = document.createElement('a');
        link.href = parsed.href;
        link.target = '_top';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        window.open(parsed.href, '_blank', 'noopener,noreferrer');
      }
    },

    cache: createStorageApi('cache', typeNs, instNs),
    data: createStorageApi('storage', typeNs, instNs),

    settings: {
      register: (definition, handlers): void => registerCardSetting(cardType, definition, handlers),
      get: <T>(id: string, expectedDefault?: T): T => getSettingValue<T>(id, expectedDefault),
      onChange: (id: string, callback: (value: unknown) => void): (() => void) => {
        const listener = (event: Event) => {
          const customEvent = event as CustomEvent<{ id: string; value: unknown }>;
          if (customEvent.detail.id === id) callback(customEvent.detail.value);
        };
        window.addEventListener('setting-changed', listener);
        return () => window.removeEventListener('setting-changed', listener);
      },
    },

    eventBus: globalEventBus,
    showToast,
  };
}

declare global {
  interface Window {
    __card_event_bus?: CardEventBus;
    cardSDK?: CardSDK;
  }
}
