const http = require('http');
const fs = require('fs');
const path = require('path');
const { decodePolyline } = require('./polyline');
const Geo = require('./public/geo');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_ROUTE = '83';

// ==========================================
// 1. NẠP DỮ LIỆU OFFLINE
// ==========================================
const busData = JSON.parse(fs.readFileSync(path.join(__dirname, 'bus_data.json'), 'utf8'));

// Trong bus_data.json: `name` của trạm là danh sách tuyến đi qua, `address` mới là tên trạm.
// Chuẩn hoá về { name: tên trạm, fleetOver: các tuyến } để client dùng thống nhất.
function normalizeStation(s, order) {
    return {
        ...(order !== undefined && { order }),
        stationId: s.stationId,
        name: s.address || s.name,
        address: s.address || '',
        lat: s.lat,
        lng: s.lng,
        fleetOver: s.fleetOver || s.name || ''
    };
}

const routeCache = {};           // code | fleetId -> route
function cacheRoute(route, ...keys) {
    for (const k of keys) routeCache[String(k)] = route;
}

for (const fleet of busData.fleets) {
    const fId = String(fleet.fleetId);
    const poly = busData.polylines[fId] || {};
    const st = busData.routeStations[fId] || {};
    cacheRoute({
        ...fleet,
        go: { path: poly['1'] ? decodePolyline(poly['1']) : [], stations: (st.go || []).map(s => normalizeStation(s, s.order)) },
        ret: { path: poly['0'] ? decodePolyline(poly['0']) : [], stations: (st.ret || []).map(s => normalizeStation(s, s.order)) }
    }, fleet.code, fId);
}

const stationIndex = {};         // stationId -> station (đã chuẩn hoá)
for (const s of Object.values(busData.stations)) stationIndex[s.stationId] = normalizeStation(s);

// Tuyến 83 có dữ liệu đầy đủ riêng (fleet_83.json)
try {
    const f83 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fleet_83.json'), 'utf8'));
    cacheRoute(f83, '83', f83.fleetId);
    const idx = busData.fleets.findIndex(f => f.code === '83');
    const meta = { ...f83 };
    delete meta.go; delete meta.ret;
    if (idx === -1) busData.fleets.push(meta); else busData.fleets[idx] = { ...busData.fleets[idx], ...meta };
    for (const s of [...f83.go.stations, ...f83.ret.stations]) {
        if (s.stationId) stationIndex[s.stationId] = { ...s, address: s.address || s.name, fleetOver: '83' };
    }
    console.log(`Đã nạp tuyến 83: ${f83.go.stations.length} trạm, ${f83.go.path.length} điểm lộ trình.`);
} catch (e) {
    console.warn('Không nạp được fleet_83.json:', e.message);
}

function routeDestinations(route) {
    const parts = (route.name || '').split('-').map(s => s.trim());
    return { go: parts[parts.length - 1] || 'Bến cuối', ret: parts[0] || 'Bến đầu' };
}

function directionText(route, isGo) {
    const d = routeDestinations(route);
    return isGo ? `Chiều đi (➜ ${d.go})` : `Chiều về (⬅ ${d.ret})`;
}

// Bản đồ trạm -> chiều đi/về (tuyến mặc định được ưu tiên ghi trước)
const stationDirectionMap = new Map();
{
    const routes = [...new Set(Object.values(routeCache))];
    routes.sort((a, b) => (b.code === DEFAULT_ROUTE) - (a.code === DEFAULT_ROUTE));
    for (const r of routes) {
        const dest = routeDestinations(r);
        for (const [dir, isGo] of [['go', true], ['ret', false]]) {
            for (const s of r[dir].stations || []) {
                if (stationDirectionMap.has(s.stationId)) continue;
                stationDirectionMap.set(s.stationId, {
                    isGo,
                    directionText: directionText(r, isGo),
                    destination: isGo ? dest.go : dest.ret
                });
            }
        }
    }
}

// Lộ trình đã tính sẵn quãng đường tích luỹ (tạo lười theo nhu cầu)
const geoCache = new WeakMap();
function routeGeo(route, isGo) {
    const dirData = isGo ? route.go : route.ret;
    let g = geoCache.get(dirData);
    if (!g) { g = Geo.buildGeo(dirData.path); geoCache.set(dirData, g); }
    return g;
}

// ==========================================
// 2. GỌI API timbus.vn
// ==========================================
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
let sessionCookie = '';
let sessionCookieTime = 0;

function getSessionCookie() {
    if (sessionCookie && Date.now() - sessionCookieTime < 10 * 60 * 1000) return Promise.resolve(sessionCookie);
    return new Promise(resolve => {
        const req = http.get('http://timbus.vn/', res => {
            const cookies = res.headers['set-cookie'];
            if (cookies) {
                sessionCookie = cookies.map(c => c.split(';')[0]).join('; ');
                sessionCookieTime = Date.now();
            }
            res.resume();
            resolve(sessionCookie);
        });
        req.on('error', () => resolve(sessionCookie));
        req.setTimeout(4000, () => { req.destroy(); resolve(sessionCookie); });
    });
}

// POST form tới timbus.vn, trả về JSON hoặc null nếu lỗi.
async function postTimbus(apiPath, form, timeout = 5000) {
    const cookie = await getSessionCookie();
    const body = new URLSearchParams(form).toString();
    return new Promise(resolve => {
        const req = http.request({
            hostname: 'timbus.vn',
            path: apiPath,
            method: 'POST',
            timeout,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Content-Length': Buffer.byteLength(body),
                'User-Agent': UA,
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': 'http://timbus.vn/',
                ...(cookie && { Cookie: cookie })
            }
        }, res => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.end(body);
    });
}

const SEARCH_API = '/Engine/Business/Search/action.ashx';
const VEHICLE_API = '/Engine/Business/Vehicle/action.ashx';

async function searchOnlineStations(key) {
    const r = await postTimbus(SEARCH_API, { act: 'searchfull', typ: 2, key }, 4000);
    return (r && r.st && r.dt && r.dt.Data) || [];
}

async function fetchStationBuses(stationId, fleet = '', state = true) {
    const r = await postTimbus(VEHICLE_API, { act: 'partremained', State: state, StationID: stationId, FleetOver: fleet });
    return r && r.st && Array.isArray(r.dt) ? r.dt : null;
}

async function fetchOnlineRoute(code) {
    const fid = parseInt(code, 10);
    if (isNaN(fid)) return null;
    const r = await postTimbus(SEARCH_API, { act: 'fleetdetail', fid });
    const d = r && r.st ? r.dt : null;
    if (!d) return null;
    const mapDir = dir => ({
        path: (dir.Geo || []).map(p => [p.Lat, p.Lng]),
        stations: (dir.Station || []).map((s, i) => ({
            order: i + 1,
            stationId: s.ObjectID,
            name: s.Name,
            address: s.Name,
            lat: s.Geo ? s.Geo.Lat : 0,
            lng: s.Geo ? s.Geo.Lng : 0,
            fleetOver: s.FleetOver || code
        }))
    });
    return {
        fleetId: fid,
        code: d.Code || code,
        name: d.Name,
        operationsTime: d.OperationsTime || '',
        frequence: d.Frequency || '',
        cost: d.Cost || '7000',
        trajectoryGo: d.Go.Route || '',
        trajectoryReturn: d.Re.Route || '',
        go: mapDir(d.Go || {}),
        ret: mapDir(d.Re || {})
    };
}

const isGoFleetCode = fc => /Đi|Xuất/.test(fc || '');

// ==========================================
// 3. QUÉT XE REALTIME TRÊN TOÀN TUYẾN
// ==========================================
const realtimeCache = new Map();   // code -> { time, buses }
const realtimeInflight = new Map(); // code -> Promise (gộp các request trùng)
const REALTIME_TTL = 3500;

async function scanRouteBuses(route) {
    const all = [...route.go.stations, ...route.ret.stations];
    const step = Math.max(1, Math.min(3, Math.floor(all.length / 25)));
    const samples = all.filter((_, i) => i % step === 0);
    if (all.length && samples[samples.length - 1] !== all[all.length - 1]) samples.push(all[all.length - 1]);

    const code = String(route.code).trim().toLowerCase();
    const best = new Map(); // plate -> { raw, station }
    const BATCH = 6;
    for (let i = 0; i < samples.length; i += BATCH) {
        await Promise.all(samples.slice(i, i + BATCH).map(async st => {
            const list = await fetchStationBuses(st.stationId, route.code);
            for (const b of list || []) {
                if (String(b.Fleet).trim().toLowerCase() !== code) continue;
                const prev = best.get(b.BienKiemSoat);
                // Gắn xe vào trạm sắp tới gần nhất (PartRemained nhỏ nhất)
                if (!prev || (typeof b.PartRemained === 'number' && b.PartRemained < prev.raw.PartRemained)) {
                    best.set(b.BienKiemSoat, { raw: b, station: st });
                }
            }
        }));
    }

    return [...best.values()].map(({ raw: b, station: st }) => {
        const isGo = isGoFleetCode(b.FleetCode);
        const geo = routeGeo(route, isGo);
        const target = Geo.along(geo, st.lat, st.lng);
        const pos = target >= 0 ? Geo.pointAt(geo, target - (b.PartRemained || 0)) : null;
        return {
            plate: String(b.BienKiemSoat || '').trim(),
            fleet: b.Fleet,
            isGo,
            directionText: directionText(route, isGo),
            partRemained: b.PartRemained,
            timeRemained: b.TimeRemained,
            speed: b.Speed,
            nextStation: st.name,
            nextStationId: st.stationId,
            targetLat: st.lat,
            targetLng: st.lng,
            lat: pos ? pos.lat : st.lat,
            lng: pos ? pos.lng : st.lng
        };
    });
}

function getRouteBuses(route) {
    const key = route.code;
    const cached = realtimeCache.get(key);
    if (cached && Date.now() - cached.time < REALTIME_TTL) return Promise.resolve(cached.buses);
    if (realtimeInflight.has(key)) return realtimeInflight.get(key);
    const p = scanRouteBuses(route)
        .then(buses => { realtimeCache.set(key, { time: Date.now(), buses }); return buses; })
        .finally(() => realtimeInflight.delete(key));
    realtimeInflight.set(key, p);
    return p;
}

// ==========================================
// 4. HTTP SERVER
// ==========================================
function sendJson(res, data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

function findRoute(code) {
    return routeCache[code] || routeCache[code.toUpperCase()] || null;
}

function searchRoutes(q) {
    return busData.fleets.filter(r =>
        r.code.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (r.trajectoryGo || '').toLowerCase().includes(q) ||
        (r.trajectoryReturn || '').toLowerCase().includes(q)
    ).sort((a, b) => {
        const rank = r => (r.code.toLowerCase() === q ? 0 : r.code.toLowerCase().startsWith(q) ? 1 : 2);
        return rank(a) - rank(b) || a.code.localeCompare(b.code, undefined, { numeric: true });
    }).slice(0, 10).map(({ code, name, frequence, cost }) => ({ code, name, frequence, cost }));
}

const api = {
    // Tìm kiếm chung: tuyến + điểm dừng
    async '/api/search'(url) {
        const q = (url.searchParams.get('q') || '').trim();
        if (!q) return { success: true, routes: [], stations: [] };
        const ql = q.toLowerCase();

        const offline = Object.values(stationIndex)
            .filter(s => s.name.toLowerCase().includes(ql) || (s.address || '').toLowerCase().includes(ql))
            .slice(0, 8);
        const online = (await searchOnlineStations(q)).map(os => ({
            stationId: os.ObjectID,
            name: os.Name || os.PrivateName,
            address: os.Street !== '-' ? os.Street : '',
            lat: os.Geo ? os.Geo.Lat : 0,
            lng: os.Geo ? os.Geo.Lng : 0,
            fleetOver: os.FleetOver || ''
        }));

        const stations = new Map();
        for (const st of [...online, ...offline]) {
            if (stations.has(st.stationId)) continue;
            const dir = stationDirectionMap.get(st.stationId);
            stations.set(st.stationId, {
                ...st,
                isGo: dir ? dir.isGo : null,
                directionText: dir ? dir.directionText : ''
            });
        }
        return { success: true, query: q, routes: searchRoutes(ql), stations: [...stations.values()].slice(0, 12) };
    },

    '/api/routes'(url) {
        const q = (url.searchParams.get('q') || '').trim().toLowerCase();
        const data = q ? busData.fleets.filter(r => r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)) : busData.fleets;
        return { success: true, count: data.length, data };
    },

    '/api/version'() {
        try {
            return { success: true, ...JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'version.json'), 'utf8')) };
        } catch {
            return { success: false };
        }
    }
};

const prefixApi = [
    // Chi tiết tuyến (lộ trình + điểm dừng)
    ['/api/route/', async code => {
        let route = findRoute(code);
        if (!route || (!route.go.path.length && !route.ret.path.length)) {
            const online = await fetchOnlineRoute(code);
            if (online) cacheRoute(route = online, code);
        }
        return route ? { success: true, data: route } : [404, { success: false, message: 'Route not found' }];
    }],
    // Xe đang tới một trạm (dùng cho cảnh báo)
    ['/api/realtime/station/', async (id, url) => {
        const stationId = parseInt(id, 10);
        const fleet = url.searchParams.get('fleet') || '';
        const list = (await fetchStationBuses(stationId, fleet, false)) || (await fetchStationBuses(stationId, fleet, true)) || [];
        return {
            success: true,
            stationId,
            buses: list.map(b => ({
                plate: String(b.BienKiemSoat || '').trim(),
                fleet: b.Fleet,
                isGo: isGoFleetCode(b.FleetCode),
                partRemained: b.PartRemained,
                timeRemained: b.TimeRemained,
                speed: b.Speed
            }))
        };
    }],
    // Toàn bộ xe đang chạy trên tuyến
    ['/api/realtime/route/', async code => {
        const route = findRoute(code);
        if (!route) return [404, { success: false, message: 'Route not found' }];
        const buses = await getRouteBuses(route);
        return { success: true, route: route.code, count: buses.length, buses };
    }]
];

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

function serveStatic(pathname, res) {
    let file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
    // Chặn truy cập ra ngoài thư mục public; đường dẫn lạ trả về index.html (SPA)
    if (!file.startsWith(PUBLIC_DIR + path.sep)) file = path.join(PUBLIC_DIR, 'index.html');
    fs.stat(file, (err, stat) => {
        if (err || !stat.isFile()) file = path.join(PUBLIC_DIR, 'index.html');
        fs.readFile(file, (err2, content) => {
            if (err2) { res.writeHead(500); return res.end('Server Error'); }
            const ext = path.extname(file).toLowerCase();
            res.writeHead(200, {
                'Content-Type': MIME[ext] || 'application/octet-stream',
                // Ảnh tĩnh được cache; HTML/JS/CSS luôn kiểm tra lại để bản cập nhật có hiệu lực ngay
                'Cache-Control': ext === '.png' ? 'public, max-age=604800' : 'no-cache'
            });
            res.end(content);
        });
    });
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;

    try {
        if (api[pathname]) return sendJson(res, await api[pathname](url));
        for (const [prefix, handler] of prefixApi) {
            if (!pathname.startsWith(prefix)) continue;
            const arg = decodeURIComponent(pathname.slice(prefix.length)).trim();
            const out = await handler(arg, url);
            return Array.isArray(out) ? sendJson(res, out[1], out[0]) : sendJson(res, out);
        }
    } catch (e) {
        console.error('API error', pathname, e);
        return sendJson(res, { success: false, message: 'Server error' }, 500);
    }

    serveStatic(pathname, res);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('=======================================================');
    console.log('  TÌM BUS PROMAX - Theo dõi xe buýt Hà Nội realtime');
    console.log(`  Đang chạy tại: http://localhost:${PORT}`);
    console.log('=======================================================');
});
