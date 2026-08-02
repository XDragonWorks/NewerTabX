const SW_VERSION = '2.0.0';

let isDownloading = false;

self.addEventListener('install', () => {
    console.info(`[SW ${SW_VERSION}] Installed successfully`);
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.info(`[SW ${SW_VERSION}] Activated successfully`);
    event.waitUntil(self.clients.claim());
});

async function generateThumbnailBase64(blob) {
    try {
        const imageBitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(32, 18);
        const ctx = canvas.getContext('2d');
        if (ctx === null) {
            console.warn('[SW] Failed to get 2d context from OffscreenCanvas');
            return null;
        }

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

        ctx.drawImage(imageBitmap, srcX, srcY, srcW, srcH, 0, 0, 32, 18);
        const thumbBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                if (typeof reader.result === 'string') {
                    resolve(reader.result);
                } else {
                    reject(new Error('FileReader result is not a string'));
                }
            };
            reader.onerror = (err) => {
                console.warn('[SW] FileReader readAsDataURL failed:', err);
                reject(err);
            };
            reader.readAsDataURL(thumbBlob);
        });
    } catch (error) {
        console.warn('[SW] Thumbnail generation failed via OffscreenCanvas:', error);
        return null;
    }
}

async function writeActiveRecord(activeJsonUrl, headers, record) {
    const response = await fetch(activeJsonUrl, {
        method: 'POST',
        headers: {
            ...headers,
            'Content-Type': 'application/json',
            'X-Cache-Expire-Time': String(record.cacheExpire),
        },
        body: JSON.stringify(record),
    });
    if (!response.ok) {
        throw new Error(`Failed to save active.json to backend cache: HTTP ${response.status}`);
    }
}

async function handleWallpaperCache(payload) {
    if (isDownloading) {
        console.info('[SW] Wallpaper download task already in progress. Dropping request.');
        return;
    }
    if (!payload || !payload.sourceUrl || !payload.downloadApiUrl || !payload.activeJsonUrl || !payload.activeMediaUrl) {
        console.warn('[SW] Invalid payload for CACHE_WALLPAPER', payload);
        return;
    }

    isDownloading = true;
    console.info('[SW] Starting background wallpaper download & processing:', payload.sourceUrl);

    try {
        // 1. 通过后端代理下载原始媒体（避免 CORS 与直连外部站点）
        const downloadRes = await fetch(payload.downloadApiUrl, {
            method: 'POST',
            headers: {
                ...payload.headers,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url: payload.sourceUrl,
                key: 'wallpapers/active_media.jpg',
                expireTime: payload.cacheExpire,
            }),
        });
        if (!downloadRes.ok) {
            throw new Error(`Failed to download wallpaper media via backend download endpoint: HTTP ${downloadRes.status}`);
        }

        // 2. 从本地后端缓存取回二进制，生成缩略图（视频不支持，跳过）
        //    后端按剩余 TTL 发 max-age 且无 ETag，必须绕过浏览器 HTTP 缓存，否则拿到旧字节
        let thumbnail = null;
        if (payload.mediaType === 'image') {
            const blobRes = await fetch(payload.activeMediaUrl, {
                headers: payload.headers,
                cache: 'no-store',
            });
            if (blobRes.ok) {
                thumbnail = await generateThumbnailBase64(await blobRes.blob());
            } else {
                console.warn(`[SW] Failed to fetch cached media for thumbnail: HTTP ${blobRes.status}`);
            }
        }

        // 3. 写入 active.json（唯一写入点）
        const record = {
            sourceHash: payload.sourceHash,
            mediaType: payload.mediaType,
            cachedUrl: payload.activeMediaUrl,
            thumbnail: thumbnail || undefined,
            clickUrl: payload.clickUrl,
            copyright: payload.copyright,
            cacheExpire: payload.cacheExpire,
            timestamp: Date.now(),
        };
        await writeActiveRecord(payload.activeJsonUrl, payload.headers, record);
        console.info('[SW] Wallpaper download & active.json sync completed successfully!');

        // 4. 广播给所有存活页面
        const clientsList = await self.clients.matchAll();
        for (const client of clientsList) {
            client.postMessage({
                type: 'WALLPAPER_CACHE_UPDATED',
                record,
            });
        }
    } catch (error) {
        console.warn('[SW] Wallpaper download & cache process failed:', error);
    } finally {
        isDownloading = false;
    }
}

async function handleThemeColors(payload) {
    if (!payload || !payload.activeJsonUrl || !payload.sourceHash || !payload.themeColors) {
        console.warn('[SW] Invalid payload for WALLPAPER_THEME_COLORS', payload);
        return;
    }
    try {
        const res = await fetch(payload.activeJsonUrl, {
            headers: payload.headers,
            cache: 'no-store',
        });
        if (!res.ok) return;
        const record = await res.json();
        if (record.sourceHash !== payload.sourceHash) return;
        record.themeColors = payload.themeColors;
        await writeActiveRecord(payload.activeJsonUrl, payload.headers, record);
        console.info('[SW] Theme colors merged into active.json');
    } catch (error) {
        console.warn('[SW] Failed to merge theme colors into active.json:', error);
    }
}

self.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'CACHE_WALLPAPER') {
        event.waitUntil(handleWallpaperCache(data.payload));
    } else if (data.type === 'WALLPAPER_THEME_COLORS') {
        event.waitUntil(handleThemeColors(data.payload));
    }
});
