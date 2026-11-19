// Service worker của Tìm Bus Promax
// - Ô bản đồ: lấy từ cache trước (cache-first), giữ tối đa MAX_TILES ô -> mở lại khu vực quen thuộc tức thì.
// - Giao diện (HTML/JS/CSS/ảnh, Leaflet): lấy mạng trước, mất mạng thì dùng bản cache.
// - API realtime: không can thiệp.
const APP_CACHE = 'app-v5';
const TILE_CACHE = 'tiles-v1';
const MAX_TILES = 3000; // ~45 MB

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        for (const k of await caches.keys()) {
            if (k !== APP_CACHE && k !== TILE_CACHE) await caches.delete(k);
        }
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    if (/^mt\d\.google\.com$/.test(url.hostname)) {
        event.respondWith(tileFirst(req));
    } else if (url.origin === location.origin && !url.pathname.startsWith('/api/')) {
        event.respondWith(networkFirst(req));
    } else if (url.hostname === 'unpkg.com') {
        event.respondWith(networkFirst(req));
    }
});

async function tileFirst(req) {
    const cache = await caches.open(TILE_CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) {
        cache.put(req, res.clone());
        if (Math.random() < 0.02) trimTiles(cache); // thỉnh thoảng dọn bớt
    }
    return res;
}

async function trimTiles(cache) {
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}

async function networkFirst(req) {
    const cache = await caches.open(APP_CACHE);
    try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
    } catch (e) {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        throw e;
    }
}

// Bấm vào thông báo -> mở lại app
self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil((async () => {
        const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        if (all.length) return all[0].focus();
        return self.clients.openWindow('/');
    })());
});
