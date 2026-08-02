import {
    applyThemeColors,
    extractThemeColorsFromImage,
    sampleMicaColors,
    WallpaperThemeColors,
} from '../utils/performance';
import { showToast } from '../components/ui-toast';
import { createCardSDK } from '../sdk/card-sdk';
import { buildApiUrl, buildDataApiUrl, getApiHeaders, getBootstrapConfig } from './config-service';
import { getIconSvg } from '../utils/icons';

export interface WallpaperData {
    source: 'bing' | 'url' | 'upload' | 'video' | 'script' | 'color';
    url: string;
    thumbnail?: string;
    scriptCode?: string;
    clickUrl?: string;
    copyright?: string;
    title?: string;
    blurRadius: number;
    maskOpacity: number;
    ttlHours: number;
    timestamp: number;
    themeColors?: WallpaperThemeColors;
}

interface WallpaperScriptResult {
    type: 'image' | 'video';
    image: string;
    clickUrl?: string;
    copyright?: string;
    cacheExpire?: number;
}

export interface UploadedWallpaper {
    url: string;
    type: 'image' | 'video';
}

type WallpaperMediaType = 'image' | 'video';

/** 原始媒体地址只存在于解析结果中，渲染层永远不接触它 */
interface ResolvedWallpaperSource {
    sourceUrl: string;
    mediaType: WallpaperMediaType;
    clickUrl?: string;
    copyright?: string;
    cacheExpire: number;
}

/** active.json 的唯一结构，只允许由 SW（或 SW 不可用时的主线程降级路径）写入 */
interface CachedWallpaperRecord {
    sourceHash: string;
    mediaType: WallpaperMediaType;
    cachedUrl: string;
    thumbnail?: string;
    themeColors?: WallpaperThemeColors;
    clickUrl?: string;
    copyright?: string;
    cacheExpire: number;
    timestamp: number;
}

interface CacheRequestPayload {
    sourceUrl: string;
    mediaType: WallpaperMediaType;
    sourceHash: string;
    cacheExpire: number;
    clickUrl?: string;
    copyright?: string;
    downloadApiUrl: string;
    activeJsonUrl: string;
    activeMediaUrl: string;
    headers: Record<string, string>;
}

export const DEFAULT_WALLPAPER_SCRIPT = `
const res = await proxyFetch("https://bing.biturl.top/?resolution=1920&format=json&index=0&mkt=zh-CN", { method: "GET" });
const data = await res.json();
let cacheExpire;
if (data.end_date && /^\\d{8}$/.test(data.end_date)) {
  const year = parseInt(data.end_date.slice(0, 4), 10);
  const month = parseInt(data.end_date.slice(4, 6), 10) - 1;
  const day = parseInt(data.end_date.slice(6, 8), 10);
  cacheExpire = new Date(year, month, day + 1, 0, 0, 0).getTime();
} else {
  const now = new Date();
  cacheExpire = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
}
return {
  type: "image",
  image: data.url,
  clickUrl: data.copyright_link,
  copyright: data.copyright,
  cacheExpire: cacheExpire
};
`.trim();

const ACTIVE_JSON_KEY = 'cache/wallpapers/active.json';
const ACTIVE_MEDIA_KEY = 'cache/wallpapers/active_media.jpg';

let currentConfig: WallpaperData | null = null;
let previewActive = false;
let displayedMediaUrl = '';
let displayedBlobUrl: string | null = null;
let displayedRecordTimestamp: number | undefined;
let refreshInFlight = false;

function headersToRecord(headersInit: HeadersInit): Record<string, string> {
    const record: Record<string, string> = {};
    if (headersInit instanceof Headers) {
        headersInit.forEach((value, key) => {
            record[key] = value;
        });
    } else if (Array.isArray(headersInit)) {
        for (const [key, value] of headersInit) {
            record[key] = value;
        }
    } else if (headersInit && typeof headersInit === 'object') {
        Object.assign(record, headersInit);
    }
    return record;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
}

function isAllowedMediaUrl(value: string): boolean {
    try {
        const parsed = new URL(value, window.location.href);
        return ['http:', 'https:', 'data:', 'blob:'].includes(parsed.protocol);
    } catch (error) {
        console.warn('[WallpaperService] Invalid media URL:', error);
        return false;
    }
}

function simpleHash(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}

/** bing/script 是脚本驱动来源：跳转链接与文案只信脚本返回值和其缓存记录，不回落到 config 中可能残留的旧字段 */
function isScriptDrivenSource(wallpaper: WallpaperData): boolean {
    return wallpaper.source === 'bing' || wallpaper.source === 'script';
}

function computeSourceHash(wallpaper: WallpaperData): string {
    // 不混入 baseUrl：active.json 存在后端自己的磁盘上，天然按后端隔离；
    // 混入只会导致同一后端在不同 origin / 浏览器档案下互相判定缓存失效
    return simpleHash(JSON.stringify({
        source: wallpaper.source,
        url: wallpaper.url,
        scriptCode: wallpaper.scriptCode ?? '',
    }));
}

function parseExpirationTimestamp(expire: number | string, defaultTtlHours: number): number {
    if (typeof expire === 'number') {
        if (expire < 1e11) {
            return Math.floor(expire * 1000);
        }
        return Math.floor(expire);
    }
    if (typeof expire === 'string') {
        const parsed = Date.parse(expire);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
    }
    return Date.now() + Math.max(1, defaultTtlHours) * 3_600_000;
}

async function executeWallpaperScript(code: string): Promise<WallpaperScriptResult | null> {
    try {
        const sdk = createCardSDK('wallpaper-script');
        const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor as new (...args: string[]) => (...runnerArgs: unknown[]) => Promise<unknown>;
        const runner = new AsyncFunction('proxyFetch', `"use strict";\n${code}\n//# sourceURL=wallpaper-script.js`);
        const rawResult = await runner(sdk.proxyFetch);
        if (!rawResult || typeof rawResult !== 'object') throw new Error('Wallpaper script must return an object');
        const result = rawResult as Partial<WallpaperScriptResult>;
        if ((result.type !== 'image' && result.type !== 'video') || typeof result.image !== 'string' || !isAllowedMediaUrl(result.image)) {
            throw new Error('Wallpaper script returned an invalid type or media URL');
        }
        return result as WallpaperScriptResult;
    } catch (error) {
        console.error('[WallpaperService] Wallpaper script failed:', error);
        showToast({
            message: `壁纸脚本执行失败：${error instanceof Error ? error.message : '未知错误'}`,
            type: 'error',
        });
        return null;
    }
}

/** 解析壁纸来源，得到原始媒体地址。这是唯一允许接触原始 URL 的环节 */
async function resolveSource(wallpaper: WallpaperData): Promise<ResolvedWallpaperSource | null> {
    const defaultExpire = Date.now() + Math.max(1, wallpaper.ttlHours) * 3_600_000;

    // bing 与 script 统一走脚本管线：bing 就是"使用内置脚本的 script 源"
    if (wallpaper.source === 'bing' || wallpaper.source === 'script') {
        const code = wallpaper.source === 'script'
            && wallpaper.scriptCode !== undefined
            && wallpaper.scriptCode.trim() !== ''
            ? wallpaper.scriptCode
            : DEFAULT_WALLPAPER_SCRIPT;
        const result = await executeWallpaperScript(code);
        if (result === null) return null;
        // 脚本主动返回的 cacheExpire 一律尊重（包括"立即过期"），仅在未返回时回落到 ttlHours
        const cacheExpire = result.cacheExpire !== undefined
            ? parseExpirationTimestamp(result.cacheExpire, wallpaper.ttlHours)
            : defaultExpire;
        return {
            sourceUrl: result.image,
            mediaType: result.type,
            clickUrl: result.clickUrl,
            copyright: result.copyright,
            cacheExpire,
        };
    }

    return {
        sourceUrl: wallpaper.url,
        mediaType: wallpaper.source === 'video' ? 'video' : 'image',
        clickUrl: wallpaper.clickUrl,
        copyright: wallpaper.copyright,
        cacheExpire: defaultExpire,
    };
}

async function readCachedWallpaper(): Promise<CachedWallpaperRecord | null> {
    try {
        // active.json 会被原地覆写，后端又按剩余 TTL 发 max-age，必须绕过浏览器 HTTP 缓存
        const response = await fetch(buildDataApiUrl(ACTIVE_JSON_KEY), {
            headers: getApiHeaders(),
            cache: 'no-store',
        });
        if (!response.ok) return null;
        const record = await response.json() as Partial<CachedWallpaperRecord>;
        if (typeof record.sourceHash !== 'string') return null;
        if (record.mediaType !== 'image' && record.mediaType !== 'video') return null;
        if (typeof record.cachedUrl !== 'string' || !isAllowedMediaUrl(record.cachedUrl)) return null;
        if (typeof record.cacheExpire !== 'number' || !Number.isFinite(record.cacheExpire)) return null;
        return record as CachedWallpaperRecord;
    } catch (error) {
        console.warn('[WallpaperService] Failed to read cached wallpaper record:', error);
        return null;
    }
}

async function generateThumbnailBase64(blob: Blob): Promise<string | undefined> {
    try {
        const imageBitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(32, 18);
        const context = canvas.getContext('2d');
        if (context === null) return undefined;

        const targetRatio = 32 / 18;
        const imageRatio = imageBitmap.width / imageBitmap.height;
        let srcX = 0;
        let srcY = 0;
        let srcW = imageBitmap.width;
        let srcH = imageBitmap.height;
        if (imageRatio > targetRatio) {
            srcW = imageBitmap.height * targetRatio;
            srcX = (imageBitmap.width - srcW) / 2;
        } else {
            srcH = imageBitmap.width / targetRatio;
            srcY = (imageBitmap.height - srcH) / 2;
        }
        context.drawImage(imageBitmap, srcX, srcY, srcW, srcH, 0, 0, 32, 18);
        const thumbBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
        return await new Promise<string | undefined>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : undefined);
            reader.onerror = () => resolve(undefined);
            reader.readAsDataURL(thumbBlob);
        });
    } catch (error) {
        console.warn('[WallpaperService] Thumbnail generation failed:', error);
        return undefined;
    }
}

/** SW 不可用时的降级路径：主线程完成同样的 下载 → 缩略图 → 写 active.json 流程 */
async function cacheWallpaperFromMainThread(payload: CacheRequestPayload): Promise<void> {
    const downloadResponse = await fetch(payload.downloadApiUrl, {
        method: 'POST',
        headers: getApiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
            url: payload.sourceUrl,
            key: 'wallpapers/active_media.jpg',
            expireTime: payload.cacheExpire,
        }),
    });
    if (!downloadResponse.ok) throw new Error(`Wallpaper download returned HTTP ${downloadResponse.status}`);

    let thumbnail: string | undefined;
    if (payload.mediaType === 'image') {
        const blobResponse = await fetch(payload.activeMediaUrl, {
            headers: getApiHeaders(),
            cache: 'no-store',
        });
        if (blobResponse.ok) {
            thumbnail = await generateThumbnailBase64(await blobResponse.blob());
        }
    }

    const record: CachedWallpaperRecord = {
        sourceHash: payload.sourceHash,
        mediaType: payload.mediaType,
        cachedUrl: payload.activeMediaUrl,
        thumbnail,
        clickUrl: payload.clickUrl,
        copyright: payload.copyright,
        cacheExpire: payload.cacheExpire,
        timestamp: Date.now(),
    };
    const writeResponse = await fetch(payload.activeJsonUrl, {
        method: 'POST',
        headers: getApiHeaders({
            'Content-Type': 'application/json',
            'X-Cache-Expire-Time': String(payload.cacheExpire),
        }),
        body: JSON.stringify(record),
    });
    if (!writeResponse.ok) throw new Error(`active.json write returned HTTP ${writeResponse.status}`);
    handleCachedWallpaper(record);
}

function requestWallpaperCache(resolved: ResolvedWallpaperSource, sourceHash: string): Promise<void> | void {
    const payload: CacheRequestPayload = {
        sourceUrl: resolved.sourceUrl,
        mediaType: resolved.mediaType,
        sourceHash,
        cacheExpire: resolved.cacheExpire,
        clickUrl: resolved.clickUrl,
        copyright: resolved.copyright,
        downloadApiUrl: buildApiUrl('data/cache/download'),
        activeJsonUrl: buildDataApiUrl(ACTIVE_JSON_KEY),
        activeMediaUrl: buildDataApiUrl(ACTIVE_MEDIA_KEY),
        headers: headersToRecord(getApiHeaders()),
    };
    const controller = 'serviceWorker' in navigator ? navigator.serviceWorker.controller : null;
    if (controller !== null) {
        // SW 下载期间会丢弃后续请求，渲染等待 WALLPAPER_CACHE_UPDATED 广播
        controller.postMessage({ type: 'CACHE_WALLPAPER', payload });
        return;
    }
    return cacheWallpaperFromMainThread(payload).catch(error => {
        console.warn('[WallpaperService] Main-thread wallpaper caching failed:', error);
        showToast({ message: '壁纸缓存失败，请检查后端连接', type: 'warning' });
    });
}

async function refreshWallpaper(wallpaper: WallpaperData, sourceHash: string): Promise<void> {
    if (refreshInFlight) {
        console.info('[WallpaperService] Wallpaper refresh already in progress, dropping duplicate request.');
        return;
    }
    refreshInFlight = true;
    try {
        const resolved = await resolveSource(wallpaper);
        if (resolved === null) return;
        await requestWallpaperCache(resolved, sourceHash);
    } finally {
        refreshInFlight = false;
    }
}

function persistThemeColorsToCache(sourceHash: string, themeColors: WallpaperThemeColors): void {
    const payload = {
        sourceHash,
        themeColors,
        activeJsonUrl: buildDataApiUrl(ACTIVE_JSON_KEY),
        headers: headersToRecord(getApiHeaders()),
    };
    const controller = 'serviceWorker' in navigator ? navigator.serviceWorker.controller : null;
    if (controller !== null) {
        controller.postMessage({ type: 'WALLPAPER_THEME_COLORS', payload });
        return;
    }
    void (async () => {
        try {
            const cached = await readCachedWallpaper();
            if (cached === null || cached.sourceHash !== sourceHash) return;
            await fetch(buildDataApiUrl(ACTIVE_JSON_KEY), {
                method: 'POST',
                headers: getApiHeaders({
                    'Content-Type': 'application/json',
                    'X-Cache-Expire-Time': String(cached.cacheExpire),
                }),
                body: JSON.stringify({ ...cached, themeColors }),
            });
        } catch (error) {
            console.warn('[WallpaperService] Failed to persist theme colors to cache:', error);
        }
    })();
}

function ensureWallpaperElements(): {
    background: HTMLDivElement;
    imageLayer: HTMLDivElement;
    video: HTMLVideoElement;
    mask: HTMLDivElement;
    attribution: HTMLAnchorElement;
    refreshBtn: HTMLButtonElement;
    controlsContainer: HTMLDivElement;
} {
    let background = document.querySelector('#wallpaper-bg') as HTMLDivElement | null;
    if (background === null) {
        background = document.createElement('div');
        background.id = 'wallpaper-bg';
        background.className = 'wallpaper-layer';
        document.body.appendChild(background);
    }
    let imageLayer = document.querySelector('#wallpaper-img') as HTMLDivElement | null;
    if (imageLayer === null) {
        imageLayer = document.createElement('div');
        imageLayer.id = 'wallpaper-img';
        imageLayer.className = 'wallpaper-layer';
        document.body.appendChild(imageLayer);
    }
    let video = document.querySelector('#wallpaper-video') as HTMLVideoElement | null;
    if (video === null) {
        video = document.createElement('video');
        video.id = 'wallpaper-video';
        video.className = 'wallpaper-layer';
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        document.body.appendChild(video);
    }
    let mask = document.querySelector('#wallpaper-mask') as HTMLDivElement | null;
    if (mask === null) {
        mask = document.createElement('div');
        mask.id = 'wallpaper-mask';
        document.body.appendChild(mask);
    }
    let controlsContainer = document.querySelector('#wallpaper-controls') as HTMLDivElement | null;
    if (controlsContainer === null) {
        controlsContainer = document.createElement('div');
        controlsContainer.id = 'wallpaper-controls';
        document.body.appendChild(controlsContainer);
    }
    let attribution = controlsContainer.querySelector('#wallpaper-attribution') as HTMLAnchorElement | null;
    if (attribution === null) {
        attribution = document.createElement('a');
        attribution.id = 'wallpaper-attribution';
        attribution.target = '_blank';
        attribution.rel = 'noopener noreferrer';
        attribution.innerHTML = `<span class="wallpaper-attribution-icon">${getIconSvg('external-link')}</span><span class="wallpaper-attribution-text"></span>`;
        controlsContainer.appendChild(attribution);
    }
    let refreshBtn = controlsContainer.querySelector('#wallpaper-refresh-btn') as HTMLButtonElement | null;
    if (refreshBtn === null) {
        refreshBtn = document.createElement('button');
        refreshBtn.id = 'wallpaper-refresh-btn';
        refreshBtn.type = 'button';
        refreshBtn.title = '销毁缓存并立刻刷新壁纸';
        refreshBtn.innerHTML = `<span class="wallpaper-attribution-icon">${getIconSvg('refresh')}</span><span class="wallpaper-refresh-text">刷新壁纸</span>`;
        refreshBtn.addEventListener('click', () => {
            clearWallpaperCacheAndRefresh();
        });
        controlsContainer.appendChild(refreshBtn);
    }
    return { background, imageLayer, video, mask, attribution, refreshBtn, controlsContainer };
}

function updateAttribution(wallpaper: WallpaperData, clickUrl?: string, copyright?: string): void {
    const { attribution, refreshBtn, controlsContainer } = ensureWallpaperElements();
    const text = attribution.querySelector('.wallpaper-attribution-text');
    if (text === null) {
        console.warn('[WallpaperService] Wallpaper attribution text element not found');
        return;
    }

    // bing/script 是脚本驱动来源：点击链接与文案只以脚本返回值（或其缓存记录）为准，
    // 绝不回落到 config 中可能残留的旧字段（例如曾经 Bing 壁纸的 copyright）。
    // url/video/upload/color 才允许使用 config 中手工配置的 clickUrl/copyright。
    const scriptDriven = isScriptDrivenSource(wallpaper);
    const targetUrl = clickUrl ?? (scriptDriven ? undefined : wallpaper.clickUrl);
    const hasTargetUrl = targetUrl !== undefined && /^https?:\/\//i.test(targetUrl);
    if (hasTargetUrl) {
        const label = copyright ?? (scriptDriven ? undefined : wallpaper.copyright);
        text.textContent = label !== undefined && label !== '' ? label : '查看壁纸';
        attribution.href = targetUrl;
        attribution.hidden = false;
        attribution.style.display = 'inline-flex';
    } else {
        attribution.removeAttribute('href');
        attribution.hidden = true;
        attribution.style.display = 'none';
    }

    const showRefresh = wallpaper.source !== 'color';
    refreshBtn.hidden = !showRefresh;
    refreshBtn.style.display = showRefresh ? 'inline-flex' : 'none';
    const showContainer = showRefresh || hasTargetUrl;
    controlsContainer.hidden = !showContainer;
    controlsContainer.style.display = showContainer ? 'flex' : 'none';
}

function calculateBlurScale(blurRadius: number): number {
    const blur = clamp(Number(blurRadius), 0, 40);
    if (blur <= 0) return 1;
    // 高斯模糊视觉羽化扩展半径大约为 1.5 * blur px
    // 双向边缘羽化补偿总长度 = 2 * (1.5 * blur) = 3 * blur px
    const minViewportDim = Math.max(300, Math.min(window.innerWidth, window.innerHeight));
    const scaleNeeded = 1 + (3 * blur) / minViewportDim;
    return Number(scaleNeeded.toFixed(4));
}

function applyLayerStyles(blurRadius: number, maskOpacity: number): void {
    const { background, imageLayer, video, mask } = ensureWallpaperElements();
    const blur = clamp(Number(blurRadius), 0, 40);
    const maskOpacityClamped = clamp(Number(maskOpacity), 0, 0.8);
    const scale = calculateBlurScale(blur);
    const transform = scale > 1 ? `scale(${scale})` : 'none';
    const filter = blur > 0 ? `blur(${blur}px)` : 'none';

    for (const layer of [background, imageLayer, video]) {
        layer.style.filter = filter;
        layer.style.transform = transform;
    }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    mask.style.backgroundColor = isDark
        ? `rgba(0, 0, 0, ${maskOpacityClamped})`
        : `rgba(255, 255, 255, ${maskOpacityClamped})`;
}

export function updateWallpaperStyle(blurRadius: number, maskOpacity: number): void {
    applyLayerStyles(blurRadius, maskOpacity);
}

function setDisplayedMedia(mediaUrl: string, blobUrl: string | null, recordTimestamp?: number): void {
    if (displayedBlobUrl !== null && displayedBlobUrl !== blobUrl) {
        URL.revokeObjectURL(displayedBlobUrl);
    }
    displayedMediaUrl = mediaUrl;
    displayedBlobUrl = blobUrl;
    displayedRecordTimestamp = recordTimestamp;
}

function preloadWallpaperImage(
    mediaUrl: string,
    onLoaded: (img: HTMLImageElement, blobUrl: string) => void,
    onError: (error: unknown) => void,
): void {
    void (async () => {
        let blobUrl = '';
        try {
            const bootstrapBaseUrl = getBootstrapConfig().baseUrl.replace(/\/+$/, '');
            const isBackendUrl = (bootstrapBaseUrl !== '' && mediaUrl.startsWith(bootstrapBaseUrl)) || mediaUrl.startsWith('/');
            const response = await fetch(mediaUrl, {
                headers: isBackendUrl ? getApiHeaders() : undefined,
                // 后端按剩余 TTL 发 max-age 且无 ETag，缓存命中期间会返回旧字节
                cache: 'no-store',
            });
            if (!response.ok) throw new Error(`HTTP ${response.status} fetching image blob`);
            const blob = await response.blob();
            blobUrl = URL.createObjectURL(blob);

            const img = new Image();
            let handled = false;
            const succeed = () => {
                if (handled) return;
                handled = true;
                onLoaded(img, blobUrl);
            };
            const fail = (error: unknown) => {
                if (handled) return;
                handled = true;
                URL.revokeObjectURL(blobUrl);
                onError(error);
            };
            img.onload = succeed;
            img.onerror = fail;
            img.src = blobUrl;
            if (img.complete && img.naturalWidth > 0) succeed();
        } catch (error) {
            if (blobUrl !== '') URL.revokeObjectURL(blobUrl);
            console.warn('[WallpaperService] Preload image blob fetch failed:', mediaUrl, error);
            onError(error);
        }
    })();
}

function renderColor(wallpaper: WallpaperData): void {
    const { background, imageLayer, video } = ensureWallpaperElements();
    applyLayerStyles(wallpaper.blurRadius, wallpaper.maskOpacity);

    video.pause();
    video.hidden = true;
    imageLayer.classList.remove('loaded');
    imageLayer.hidden = true;
    background.hidden = false;
    background.style.backgroundImage = 'none';
    background.style.backgroundColor = CSS.supports('color', wallpaper.url) ? wallpaper.url : 'var(--color-bg-base)';
    setDisplayedMedia('', null);
    sampleMicaColors();
    updateAttribution(wallpaper);
}

interface RenderExtras {
    thumbnail?: string;
    themeColors?: WallpaperThemeColors;
    clickUrl?: string;
    copyright?: string;
    /** 仅来自缓存记录时存在，用于把提取出的主题色回写给缓存 */
    sourceHash?: string;
    /**
     * 缓存记录的写入时间。cachedUrl 是固定 key，刷新前后 URL 不变，
     * 必须靠它判断记录是否已更新，否则新图会被"同 URL 已加载"逻辑吞掉
     */
    recordTimestamp?: number;
}

function renderMedia(
    mediaType: WallpaperMediaType,
    mediaUrl: string,
    wallpaper: WallpaperData,
    extras: RenderExtras = {},
): void {
    const { background, imageLayer, video } = ensureWallpaperElements();
    applyLayerStyles(wallpaper.blurRadius, wallpaper.maskOpacity);

    if (mediaType === 'video') {
        imageLayer.classList.remove('loaded');
        imageLayer.hidden = true;
        background.hidden = true;
        video.hidden = false;
        video.classList.add('loaded');
        // <video> 无法设置 fetch cache mode，后端又对固定 key 发 max-age，
        // 用记录时间戳做查询参数穿透浏览器 HTTP 缓存
        const playbackUrl = extras.recordTimestamp !== undefined
            ? `${mediaUrl}?v=${extras.recordTimestamp}`
            : mediaUrl;
        if (video.src !== playbackUrl) {
            video.src = playbackUrl;
        }
        void video.play().catch(error => console.warn('[WallpaperService] Video autoplay failed:', error));
        setDisplayedMedia(mediaUrl, null, extras.recordTimestamp);
        if (extras.themeColors !== undefined) {
            applyThemeColors(extras.themeColors);
        } else {
            sampleMicaColors();
        }
        updateAttribution(wallpaper, extras.clickUrl, extras.copyright);
        return;
    }

    video.pause();
    video.hidden = true;
    imageLayer.hidden = false;
    background.hidden = false;

    // 先用缩略图或预计算主题色在 0ms 铺满占位，避免加载间隙白屏
    if (extras.thumbnail !== undefined && extras.thumbnail.startsWith('data:image/')) {
        background.style.backgroundImage = `url("${extras.thumbnail}")`;
        background.style.backgroundColor = 'transparent';
        if (extras.themeColors !== undefined) {
            applyThemeColors(extras.themeColors);
        }
        background.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' });
    } else if (extras.themeColors !== undefined) {
        if (extras.themeColors.gradientBackground !== undefined) {
            background.style.backgroundImage = extras.themeColors.gradientBackground;
        } else {
            background.style.backgroundImage = 'none';
            background.style.backgroundColor = extras.themeColors.dominantColor;
        }
        applyThemeColors(extras.themeColors);
    } else {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        background.style.backgroundImage = isDark
            ? 'radial-gradient(at 10% 10%, rgb(40, 48, 68) 0%, transparent 65%), radial-gradient(at 90% 90%, rgb(30, 35, 50) 0%, transparent 65%), rgb(20, 24, 33)'
            : 'radial-gradient(at 10% 10%, rgb(220, 230, 245) 0%, transparent 65%), radial-gradient(at 90% 90%, rgb(235, 225, 240) 0%, transparent 65%), rgb(242, 244, 248)';
    }

    const isSameLoadedRecord = extras.recordTimestamp === undefined || extras.recordTimestamp === displayedRecordTimestamp;
    if (displayedMediaUrl === mediaUrl && imageLayer.classList.contains('loaded') && isSameLoadedRecord) {
        updateAttribution(wallpaper, extras.clickUrl, extras.copyright);
        return;
    }

    preloadWallpaperImage(
        mediaUrl,
        (loadedImg, blobUrl) => {
            const extracted = extractThemeColorsFromImage(loadedImg);
            if (extracted !== null) {
                applyThemeColors(extracted);
                if (extras.themeColors === undefined && extras.sourceHash !== undefined) {
                    persistThemeColorsToCache(extras.sourceHash, extracted);
                }
            } else {
                console.warn('[WallpaperService] Color extraction from preloaded image returned null:', mediaUrl);
            }

            setDisplayedMedia(mediaUrl, blobUrl, extras.recordTimestamp);
            imageLayer.style.backgroundImage = `url(${JSON.stringify(blobUrl)})`;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    imageLayer.classList.add('loaded');
                    imageLayer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 640, easing: 'ease-out' });
                });
            });
        },
        (error) => {
            console.warn('[WallpaperService] Preloading wallpaper image failed:', mediaUrl, error);
        },
    );
    updateAttribution(wallpaper, extras.clickUrl, extras.copyright);
}

function handleCachedWallpaper(record: CachedWallpaperRecord): void {
    if (previewActive) {
        console.info('[WallpaperService] Preview is active, ignoring wallpaper cache update');
        return;
    }
    if (currentConfig === null) return;
    if (record.sourceHash !== computeSourceHash(currentConfig)) {
        console.info('[WallpaperService] Ignoring cache update for a stale wallpaper source');
        return;
    }
    renderMedia(record.mediaType, record.cachedUrl, currentConfig, {
        thumbnail: record.thumbnail,
        themeColors: record.themeColors,
        // bing/script 来源仅信任缓存记录里的脚本返回值，不回落到 config 中的陈旧字段
        clickUrl: record.clickUrl ?? (isScriptDrivenSource(currentConfig) ? undefined : currentConfig.clickUrl),
        copyright: record.copyright ?? (isScriptDrivenSource(currentConfig) ? undefined : currentConfig.copyright),
        sourceHash: record.sourceHash,
        recordTimestamp: record.timestamp,
    });
}

function resetDocumentBackground(): void {
    document.documentElement.style.backgroundColor = 'transparent';
    document.body.style.backgroundColor = 'transparent';
    document.body.style.backgroundImage = 'none';
}

/**
 * 权威应用壁纸：启动 / 保存 / 撤销预览 / 手动刷新时调用。
 * 渲染只会使用本地缓存地址，原始地址不会进入 DOM。
 */
export function applyWallpaper(wallpaper: WallpaperData): void {
    currentConfig = wallpaper;
    previewActive = false;
    resetDocumentBackground();

    if (wallpaper.source === 'color' || wallpaper.url === '') {
        renderColor(wallpaper);
        return;
    }

    void (async () => {
        const sourceHash = computeSourceHash(wallpaper);
        const cached = await readCachedWallpaper();
        if (cached !== null) {
            if (cached.sourceHash === sourceHash) {
                renderMedia(cached.mediaType, cached.cachedUrl, wallpaper, {
                    thumbnail: cached.thumbnail,
                    themeColors: cached.themeColors,
                    // bing/script 来源仅信任缓存记录里的脚本返回值，不回落到 config 中的陈旧字段
                    clickUrl: cached.clickUrl ?? (isScriptDrivenSource(wallpaper) ? undefined : wallpaper.clickUrl),
                    copyright: cached.copyright ?? (isScriptDrivenSource(wallpaper) ? undefined : wallpaper.copyright),
                    sourceHash: cached.sourceHash,
                    recordTimestamp: cached.timestamp,
                });
                if (cached.cacheExpire > Date.now()) return;
                console.info('[WallpaperService] Cached wallpaper expired, refreshing in background...');
            } else {
                // 来源已变化：先用旧记录占位避免白屏，后台刷新完成后由广播替换成新图。
                // 不传 sourceHash/clickUrl/copyright：旧记录的元数据不属于新来源，
                // 且不允许把新来源提取的主题色回写到旧记录里
                console.info('[WallpaperService] Cached wallpaper is from a different source, using it as placeholder...');
                renderMedia(cached.mediaType, cached.cachedUrl, wallpaper, {
                    thumbnail: cached.thumbnail,
                    themeColors: cached.themeColors,
                    clickUrl: isScriptDrivenSource(wallpaper) ? undefined : wallpaper.clickUrl,
                    copyright: isScriptDrivenSource(wallpaper) ? undefined : wallpaper.copyright,
                    recordTimestamp: cached.timestamp,
                });
            }
        }
        await refreshWallpaper(wallpaper, sourceHash);
    })();
}

export interface PreviewWallpaperOptions {
    executeScript?: boolean;
}

/**
 * 设置页草稿预览：直接渲染原始地址，不触碰缓存与 SW，不产生任何持久写入。
 */
export function previewWallpaper(wallpaper: WallpaperData, options?: PreviewWallpaperOptions): void {
    previewActive = true;
    resetDocumentBackground();

    if (wallpaper.source === 'color' || wallpaper.url === '') {
        renderColor(wallpaper);
        return;
    }

    void (async () => {
        if (wallpaper.source === 'script' && options?.executeScript !== true) {
            console.info('[WallpaperService] Wallpaper script execution deferred until saved');
            return;
        }
        if (wallpaper.source === 'script' || wallpaper.source === 'bing') {
            const resolved = await resolveSource(wallpaper);
            if (resolved === null) return;
            renderMedia(resolved.mediaType, resolved.sourceUrl, wallpaper, {
                clickUrl: resolved.clickUrl,
                copyright: resolved.copyright,
            });
            return;
        }
        renderMedia(wallpaper.source === 'video' ? 'video' : 'image', wallpaper.url, wallpaper);
    })();
}

export function clearWallpaperCacheAndRefresh(wallpaper?: WallpaperData): void {
    setDisplayedMedia('', null);
    const background = document.querySelector('#wallpaper-bg') as HTMLDivElement | null;
    if (background !== null) {
        background.classList.remove('loaded');
    }

    void (async () => {
        try {
            await fetch(buildDataApiUrl(ACTIVE_JSON_KEY), { method: 'DELETE', headers: getApiHeaders() });
            await fetch(buildDataApiUrl(ACTIVE_MEDIA_KEY), { method: 'DELETE', headers: getApiHeaders() });
        } catch (error) {
            console.warn('[WallpaperService] Failed to delete wallpaper cache:', error);
        }
        const target = wallpaper ?? currentConfig;
        if (target !== null) {
            showToast({ message: '正在刷新壁纸...', type: 'info' });
            applyWallpaper(target);
        } else {
            console.warn('[WallpaperService] No active wallpaper config found for refresh');
            showToast({ message: '未找到当前壁纸配置，刷新失败', type: 'warning' });
        }
    })();
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
        const data = event.data;
        if (data && typeof data === 'object' && data.type === 'WALLPAPER_CACHE_UPDATED' && data.record) {
            console.info('[WallpaperService] Received WALLPAPER_CACHE_UPDATED broadcast from SW');
            handleCachedWallpaper(data.record as CachedWallpaperRecord);
        }
    });
}

function extensionForFile(file: File): string {
    const nameExtension = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : undefined;
    if (nameExtension && /^[a-z0-9]{1,8}$/.test(nameExtension)) return nameExtension;
    const typeMap: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'video/mp4': 'mp4',
        'video/webm': 'webm',
    };
    return typeMap[file.type] || 'bin';
}

export async function uploadWallpaperFile(file: File): Promise<UploadedWallpaper> {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) throw new Error('Only image and video wallpaper files are supported.');
    const extension = extensionForFile(file);
    const key = `wallpapers/upload-${crypto.randomUUID()}.${extension}`;
    const response = await fetch(buildDataApiUrl(`cache/${key}`), {
        method: 'POST',
        headers: getApiHeaders({ 'Content-Type': file.type || 'application/octet-stream' }),
        body: file,
    });
    if (!response.ok) throw new Error(`Wallpaper upload returned HTTP ${response.status}`);
    return {
        url: buildDataApiUrl(`cache/${key}`),
        type: isVideo ? 'video' : 'image',
    };
}
