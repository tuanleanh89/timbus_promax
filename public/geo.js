// Hàm hình học dùng chung cho server (require) và trình duyệt (window.Geo).
// Lộ trình được chuẩn bị một lần thành { path, cum } với cum[i] = quãng đường (m)
// từ điểm đầu đến path[i], nhờ đó mọi phép tính "dọc tuyến" chỉ còn O(log n).
(function (root) {
    const R = 6371000;
    const RAD = Math.PI / 180;

    function distance(lat1, lng1, lat2, lng2) {
        const dLat = (lat2 - lat1) * RAD;
        const dLng = (lng2 - lng1) * RAD;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function bearing(lat1, lng1, lat2, lng2) {
        const dLng = (lng2 - lng1) * RAD;
        const y = Math.sin(dLng) * Math.cos(lat2 * RAD);
        const x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) -
            Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos(dLng);
        return (Math.atan2(y, x) / RAD + 360) % 360;
    }

    function buildGeo(path) {
        path = Array.isArray(path) ? path : [];
        const cum = new Float64Array(path.length);
        for (let i = 1; i < path.length; i++) {
            cum[i] = cum[i - 1] + distance(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
        }
        return { path, cum, idxCache: new Map() };
    }

    // Chỉ số điểm gần nhất trên lộ trình (có cache theo toạ độ vì trạm dừng lặp lại liên tục).
    function closestIndex(geo, lat, lng) {
        if (!geo || !geo.path.length || !lat || !lng) return -1;
        const key = lat + ',' + lng;
        const hit = geo.idxCache.get(key);
        if (hit !== undefined) return hit;
        let best = 0, min = Infinity;
        for (let i = 0; i < geo.path.length; i++) {
            const d = distance(lat, lng, geo.path[i][0], geo.path[i][1]);
            if (d < min) { min = d; best = i; }
        }
        geo.idxCache.set(key, best);
        return best;
    }

    // Quãng đường dọc tuyến (m) của một toạ độ (chiếu về điểm gần nhất).
    function along(geo, lat, lng) {
        const i = closestIndex(geo, lat, lng);
        return i < 0 ? -1 : geo.cum[i];
    }

    // Toạ độ tại quãng đường s (m) tính từ đầu tuyến.
    function pointAt(geo, s) {
        const { path, cum } = geo;
        if (!path.length) return null;
        if (s <= 0) return { lat: path[0][0], lng: path[0][1] };
        const last = path.length - 1;
        if (s >= cum[last]) return { lat: path[last][0], lng: path[last][1] };
        let lo = 0, hi = last;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (cum[mid] <= s) lo = mid; else hi = mid;
        }
        const seg = cum[hi] - cum[lo] || 1;
        const t = (s - cum[lo]) / seg;
        return {
            lat: path[lo][0] + (path[hi][0] - path[lo][0]) * t,
            lng: path[lo][1] + (path[hi][1] - path[lo][1]) * t
        };
    }

    const Geo = { distance, bearing, buildGeo, closestIndex, along, pointAt };
    if (typeof module !== 'undefined' && module.exports) module.exports = Geo;
    else root.Geo = Geo;
})(typeof window !== 'undefined' ? window : globalThis);
