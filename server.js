const http = require('http');
const fs = require('fs');
const path = require('path');
const { decodePolyline } = require('./polyline');

const PORT = process.env.PORT || 3000;
const busData = JSON.parse(fs.readFileSync(path.join(__dirname, 'bus_data.json'), 'utf8'));

// Pre-process polylines and routes for fast response
const routeCache = {};
for (const fleet of busData.fleets) {
    const fId = String(fleet.fleetId);
    const poly = busData.polylines[fId] || {};
    const stations = busData.routeStations[fId] || { go: [], ret: [] };

    routeCache[fleet.code] = {
        ...fleet,
        go: {
            path: poly['1'] ? decodePolyline(poly['1']) : [],
            stations: stations.go
        },
        ret: {
            path: poly['0'] ? decodePolyline(poly['0']) : [],
            stations: stations.ret
        }
    };
    routeCache[fId] = routeCache[fleet.code];
}

// Load Fleet 83 Full Data
try {
    const fleet83Path = path.join(__dirname, 'fleet_83.json');
    if (fs.existsSync(fleet83Path)) {
        const fleet83Data = JSON.parse(fs.readFileSync(fleet83Path, 'utf8'));
        routeCache['83'] = fleet83Data;
        routeCache['8300'] = fleet83Data;

        // Add or update in busData.fleets
        const idx = busData.fleets.findIndex(f => f.code === '83');
        if (idx !== -1) {
            busData.fleets[idx] = { ...busData.fleets[idx], ...fleet83Data };
        } else {
            busData.fleets.push(fleet83Data);
        }

        // Register all stations of route 83 into busData.stations for instant offline search & lookup
        const allStations83 = [...(fleet83Data.go.stations || []), ...(fleet83Data.ret.stations || [])];
        for (const st of allStations83) {
            if (st.stationId) {
                busData.stations[st.stationId] = {
                    stationId: st.stationId,
                    name: st.name,
                    address: st.address || st.name,
                    lat: st.lat,
                    lng: st.lng,
                    fleetOver: '83'
                };
            }
        }

        console.log('Loaded Route 83 full data with', fleet83Data.go.stations.length, 'stations and', fleet83Data.go.path.length, 'path coordinates.');
    }
} catch (e) {
    console.error('Error loading fleet_83.json:', e);
}

// Build Station Direction Map: Tra cứu chiều đi/về và đích đến của từng trạm dừng
const stationDirectionMap = new Map();

for (const fleet of busData.fleets) {
    const fId = String(fleet.fleetId);
    const stations = busData.routeStations[fId] || { go: [], ret: [] };
    const parts = (fleet.name || '').split('-');
    const destGo = parts[parts.length - 1] ? parts[parts.length - 1].trim() : 'Chiều đi';
    const destRet = parts[0] ? parts[0].trim() : 'Chiều về';

    for (const st of (stations.go || [])) {
        if (!stationDirectionMap.has(st.stationId)) {
            stationDirectionMap.set(st.stationId, {
                isGo: true,
                directionText: `Chiều đi (➜ ${destGo})`,
                destination: destGo,
                routeCode: fleet.code,
                order: st.order
            });
        }
    }
    for (const st of (stations.ret || [])) {
        if (!stationDirectionMap.has(st.stationId)) {
            stationDirectionMap.set(st.stationId, {
                isGo: false,
                directionText: `Chiều về (⬅ ${destRet})`,
                destination: destRet,
                routeCode: fleet.code,
                order: st.order
            });
        }
    }
}

// Thiết lập tường minh cho Tuyến 83 (Bến xe Gia Lâm <-> Bến xe Hưng Yên)
if (routeCache['83']) {
    for (const st of (routeCache['83'].go.stations || [])) {
        const info = {
            isGo: true,
            directionText: 'Chiều đi (➜ Bến xe Hưng Yên)',
            destination: 'Bến xe Hưng Yên',
            routeCode: '83',
            order: st.order
        };
        stationDirectionMap.set(st.stationId, info);
        stationDirectionMap.set(String(st.stationId), info);
    }
    for (const st of (routeCache['83'].ret.stations || [])) {
        const info = {
            isGo: false,
            directionText: 'Chiều về (⬅ Bến xe Gia Lâm)',
            destination: 'Bến xe Gia Lâm',
            routeCode: '83',
            order: st.order
        };
        stationDirectionMap.set(st.stationId, info);
        stationDirectionMap.set(String(st.stationId), info);
    }
}

// Session manager for timbus.vn
let currentSessionCookie = '';
let lastCookieTime = 0;
const routeRealtimeCache = new Map(); // routeCode -> { timestamp, buses }

// ==========================================
// GEOMETRY HELPERS: Tính toán vị trí xe chính xác trên làn đường (Polyline)
// ==========================================
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
    const brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
}

function findClosestPathIndex(path, stLat, stLng) {
    let minDist = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < path.length; i++) {
        const d = getDistance(stLat, stLng, path[i][0], path[i][1]);
        if (d < minDist) {
            minDist = d;
            bestIdx = i;
        }
    }
    return bestIdx;
}

function interpolatePositionBackwards(path, targetLat, targetLng, distanceMeters) {
    if (!path || path.length === 0) return { lat: targetLat, lng: targetLng, bearing: 0 };
    if (!distanceMeters || distanceMeters <= 5) return { lat: targetLat, lng: targetLng, bearing: 0 };

    const targetIdx = findClosestPathIndex(path, targetLat, targetLng);
    let remaining = distanceMeters;
    let currIdx = targetIdx;

    while (currIdx > 0 && remaining > 0) {
        const pCurrent = path[currIdx];
        const pPrev = path[currIdx - 1];
        const segDist = getDistance(pCurrent[0], pCurrent[1], pPrev[0], pPrev[1]);

        if (remaining <= segDist) {
            const ratio = remaining / (segDist || 1);
            const lat = pCurrent[0] + (pPrev[0] - pCurrent[0]) * ratio;
            const lng = pCurrent[1] + (pPrev[1] - pCurrent[1]) * ratio;
            const bearing = calculateBearing(pPrev[0], pPrev[1], pCurrent[0], pCurrent[1]);
            return { lat, lng, bearing };
        } else {
            remaining -= segDist;
            currIdx--;
        }
    }

    const firstPt = path[0];
    const secondPt = path[1] || firstPt;
    return {
        lat: firstPt[0],
        lng: firstPt[1],
        bearing: calculateBearing(firstPt[0], firstPt[1], secondPt[0], secondPt[1])
    };
}

function enrichStationBuses(rawBuses, stLat, stLng) {
    return (rawBuses || []).map(b => {
        let busLat = stLat || 0;
        let busLng = stLng || 0;
        let bearing = 0;
        const rCode = String(b.Fleet || '').trim();
        const rData = routeCache[rCode];
        const isGo = (b.FleetCode || '').includes('Đi') || (b.FleetCode || '').includes('Xuất');
        let path = [];
        if (rData && busLat && busLng) {
            path = isGo ? (rData.go ? rData.go.path : []) : (rData.ret ? rData.ret.path : []);
            if (path && path.length > 0) {
                const pos = interpolatePositionBackwards(path, busLat, busLng, b.PartRemained || 0);
                busLat = pos.lat;
                busLng = pos.lng;
                bearing = pos.bearing;
            }
        }
        const parts = (rData && rData.name) ? rData.name.split('-') : [];
        const destGo = parts[parts.length - 1] ? parts[parts.length - 1].trim() : 'Bến cuối';
        const destRet = parts[0] ? parts[0].trim() : 'Bến đầu';
        return {
            plate: b.BienKiemSoat,
            fleet: b.Fleet,
            fleetCode: b.FleetCode,
            partRemained: b.PartRemained,
            timeRemained: b.TimeRemained,
            speed: b.Speed,
            isGo: isGo,
            directionText: isGo ? `Chiều đi (➜ ${destGo})` : `Chiều về (⬅ ${destRet})`,
            dirShort: isGo ? 'Đi' : 'Về',
            lat: busLat,
            lng: busLng,
            bearing: bearing,
            path: path
        };
    });
}

function getSessionCookie() {
    return new Promise((resolve) => {
        const now = Date.now();
        if (currentSessionCookie && (now - lastCookieTime < 10 * 60 * 1000)) {
            return resolve(currentSessionCookie);
        }

        const req = http.get('http://timbus.vn/', (res) => {
            const cookies = res.headers['set-cookie'];
            if (cookies) {
                currentSessionCookie = cookies.map(c => c.split(';')[0]).join('; ');
                lastCookieTime = Date.now();
            }
            resolve(currentSessionCookie);
        });
        req.on('error', () => resolve(currentSessionCookie));
        req.setTimeout(4000, () => { req.destroy(); resolve(currentSessionCookie); });
    });
}

// Fetch fleet detail on demand from timbus.vn if route data is missing
function fetchOnlineFleetDetail(fid) {
    return new Promise((resolve) => {
        const postBody = `act=fleetdetail&fid=${fid}`;
        const req = http.request({
            hostname: 'timbus.vn',
            port: 80,
            path: '/Engine/Business/Search/action.ashx',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Content-Length': Buffer.byteLength(postBody),
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': 'http://timbus.vn/'
            },
            timeout: 5000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed && parsed.st ? parsed.dt : null);
                } catch (e) {
                    resolve(null);
                }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.write(postBody);
        req.end();
    });
}

// Query online bus search from timbus.vn (typ 1: route, typ 2: station)
function searchOnlineTimbus(key, typ = 2) {
    return new Promise(async (resolve) => {
        try {
            const cookies = await getSessionCookie();
            const postBody = `act=searchfull&typ=${typ}&key=${encodeURIComponent(key)}`;
            const headers = {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Content-Length': Buffer.byteLength(postBody),
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': 'http://timbus.vn/'
            };
            if (cookies) headers['Cookie'] = cookies;

            const req = http.request({
                hostname: 'timbus.vn',
                port: 80,
                path: '/Engine/Business/Search/action.ashx',
                method: 'POST',
                headers: headers,
                timeout: 4000
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed && parsed.st && parsed.dt ? parsed.dt.Data : []);
                    } catch (e) {
                        resolve([]);
                    }
                });
            });

            req.on('error', () => resolve([]));
            req.on('timeout', () => { req.destroy(); resolve([]); });
            req.write(postBody);
            req.end();
        } catch (e) {
            resolve([]);
        }
    });
}

function fetchRealtimeStation(stationId, state = true, fleet = '') {
    return new Promise(async (resolve) => {
        try {
            const cookies = await getSessionCookie();
            const postBody = `act=partremained&State=${state}&StationID=${stationId}&FleetOver=${encodeURIComponent(fleet)}`;
            const headers = {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Content-Length': Buffer.byteLength(postBody),
                'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': 'http://timbus.vn/'
            };
            if (cookies) headers['Cookie'] = cookies;

            const req = http.request({
                hostname: 'timbus.vn',
                port: 80,
                path: '/Engine/Business/Vehicle/action.ashx',
                method: 'POST',
                headers: headers,
                timeout: 5000
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed);
                    } catch (e) {
                        resolve({ success: false, st: false, dt: [] });
                    }
                });
            });

            req.on('error', (err) => {
                resolve({ success: false, error: err.message, dt: [] });
            });
            req.on('timeout', () => {
                req.destroy();
                resolve({ success: false, error: 'Timeout', dt: [] });
            });

            req.write(postBody);
            req.end();
        } catch (e) {
            resolve({ success: false, error: e.message, dt: [] });
        }
    });
}

// Request dispatcher
const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        return res.end();
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // 1. SMART UNIVERSAL SEARCH: Tìm cả Tuyến VÀ Điểm Dừng
    if (pathname === '/api/search') {
        const q = (parsedUrl.searchParams.get('q') || '').trim();
        if (!q) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, routes: [], stations: [] }));
        }

        const qLower = q.toLowerCase();

        // 1.1 Match Routes (ưu tiên tuyến trùng khớp chính xác lên đầu)
        const matchedRoutes = busData.fleets.filter(r =>
            r.code.toLowerCase().includes(qLower) ||
            r.name.toLowerCase().includes(qLower) ||
            (r.trajectoryGo && r.trajectoryGo.toLowerCase().includes(qLower)) ||
            (r.trajectoryReturn && r.trajectoryReturn.toLowerCase().includes(qLower))
        ).sort((a, b) => {
            const aExact = a.code.toLowerCase() === qLower;
            const bExact = b.code.toLowerCase() === qLower;
            if (aExact && !bExact) return -1;
            if (!aExact && bExact) return 1;
            const aStarts = a.code.toLowerCase().startsWith(qLower);
            const bStarts = b.code.toLowerCase().startsWith(qLower);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            return a.code.localeCompare(b.code, undefined, { numeric: true });
        }).slice(0, 10);

        // 1.2 Match Stations (Offline)
        const matchedOfflineStations = Object.values(busData.stations).filter(s =>
            (s.name && s.name.toLowerCase().includes(qLower)) ||
            (s.address && s.address.toLowerCase().includes(qLower))
        ).slice(0, 8).map(s => ({
            stationId: s.stationId,
            name: s.name || s.address,
            address: s.address,
            lat: s.lat,
            lng: s.lng,
            fleetOver: s.name || ''
        }));

        // 1.3 Match Stations (Online from timbus.vn)
        const onlineStations = await searchOnlineTimbus(q, 2);
        const mappedOnlineStations = (onlineStations || []).map(os => ({
            stationId: os.ObjectID,
            name: os.Name || os.PrivateName,
            address: os.Street !== '-' ? os.Street : (os.Name || ''),
            lat: os.Geo ? os.Geo.Lat : 0,
            lng: os.Geo ? os.Geo.Lng : 0,
            fleetOver: os.FleetOver || ''
        }));

        // Merge stations and de-duplicate by stationId, đồng thời gắn thông tin chiều đi / chiều về
        const stationMap = new Map();
        for (const st of [...mappedOnlineStations, ...matchedOfflineStations]) {
            if (!stationMap.has(st.stationId)) {
                const dirInfo = stationDirectionMap.get(st.stationId);
                const isGo = dirInfo ? dirInfo.isGo : null;
                const dirText = dirInfo ? dirInfo.directionText : '';
                const dest = dirInfo ? dirInfo.destination : '';
                stationMap.set(st.stationId, {
                    ...st,
                    isGo: isGo,
                    directionText: dirText,
                    destination: dest
                });
            }
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
            success: true,
            query: q,
            routes: matchedRoutes,
            stations: Array.from(stationMap.values()).slice(0, 12)
        }));
    }

    // 2. API: List all routes
    if (pathname === '/api/routes') {
        const q = (parsedUrl.searchParams.get('q') || '').trim().toLowerCase();
        let routes = busData.fleets;
        if (q) {
            routes = routes.filter(r =>
                r.code.toLowerCase().includes(q) ||
                r.name.toLowerCase().includes(q)
            );
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ success: true, count: routes.length, data: routes }));
    }

    // 3. API: Route details (path, stations)
    if (pathname.startsWith('/api/route/')) {
        const code = decodeURIComponent(pathname.replace('/api/route/', '')).trim();
        let route = routeCache[code] || routeCache[code.toUpperCase()];

        // If route exists but path is empty, try online fetch
        if (!route || (!route.go.path.length && !route.ret.path.length)) {
            const fid = parseInt(code, 10);
            if (!isNaN(fid)) {
                const onlineDetail = await fetchOnlineFleetDetail(fid);
                if (onlineDetail) {
                    const goPath = (onlineDetail.Go.Geo || []).map(p => [p.Lat, p.Lng]);
                    const retPath = (onlineDetail.Re.Geo || []).map(p => [p.Lat, p.Lng]);
                    const goStations = (onlineDetail.Go.Station || []).map((s, idx) => ({
                        order: idx + 1,
                        stationId: s.ObjectID,
                        name: s.Name,
                        address: s.Name,
                        lat: s.Geo ? s.Geo.Lat : 0,
                        lng: s.Geo ? s.Geo.Lng : 0,
                        fleetOver: s.FleetOver || code
                    }));
                    const retStations = (onlineDetail.Re.Station || []).map((s, idx) => ({
                        order: idx + 1,
                        stationId: s.ObjectID,
                        name: s.Name,
                        address: s.Name,
                        lat: s.Geo ? s.Geo.Lat : 0,
                        lng: s.Geo ? s.Geo.Lng : 0,
                        fleetOver: s.FleetOver || code
                    }));

                    route = {
                        fleetId: fid,
                        code: onlineDetail.Code || code,
                        name: onlineDetail.Name,
                        operationsTime: onlineDetail.OperationsTime || '05:00 - 21:00',
                        frequence: onlineDetail.Frequency || '',
                        cost: onlineDetail.Cost || '7000',
                        trajectoryGo: onlineDetail.Go.Route || '',
                        trajectoryReturn: onlineDetail.Re.Route || '',
                        go: { path: goPath, stations: goStations },
                        ret: { path: retPath, stations: retStations }
                    };
                    routeCache[code] = route;
                }
            }
        }

        if (!route) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: false, message: 'Route not found' }));
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ success: true, data: route }));
    }

    // 3.1 API: Check App Version & Updates
    if (pathname === '/api/version') {
        const verPath = path.join(__dirname, 'public', 'version.json');
        try {
            const verData = JSON.parse(fs.readFileSync(verPath, 'utf8'));
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, ...verData }));
        } catch (e) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: true, version: '1.2.0', appName: 'Tìm Bus Promax' }));
        }
    }

    // 4. API: Station Detail & Realtime incoming buses
    if (pathname.startsWith('/api/station/')) {
        const stationId = parseInt(pathname.replace('/api/station/', ''), 10);
        const fleet = parsedUrl.searchParams.get('fleet') || '';

        const offlineSt = busData.stations[stationId] || {};

        let r = await fetchRealtimeStation(stationId, true, fleet);
        if (!r || !r.st || !Array.isArray(r.dt) || r.dt.length === 0) {
            r = await fetchRealtimeStation(stationId, false, fleet);
        }

        const enrichedBuses = enrichStationBuses(r && r.st ? r.dt : [], offlineSt.lat, offlineSt.lng);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
            success: true,
            stationId,
            name: offlineSt.name || offlineSt.address || `Điểm dừng #${stationId}`,
            address: offlineSt.address || '',
            lat: offlineSt.lat || 0,
            lng: offlineSt.lng || 0,
            buses: enrichedBuses
        }));
    }

    // 5. API: Realtime station incoming buses (used for alerts)
    if (pathname.startsWith('/api/realtime/station/')) {
        const stationId = parseInt(pathname.replace('/api/realtime/station/', ''), 10);
        const fleet = parsedUrl.searchParams.get('fleet') || '';

        const offlineSt = busData.stations[stationId] || {};

        let r = await fetchRealtimeStation(stationId, false, fleet);
        if (!r || !r.st || !Array.isArray(r.dt)) {
            r = await fetchRealtimeStation(stationId, true, fleet);
        }

        const enrichedBuses = enrichStationBuses(r && r.st ? r.dt : [], offlineSt.lat, offlineSt.lng);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
            success: true,
            stationId,
            buses: enrichedBuses
        }));
    }

    // 6. API: Realtime buses on an ENTIRE ROUTE (Quét bao quát toàn bộ xe đang hoạt động)
    if (pathname.startsWith('/api/realtime/route/')) {
        const code = decodeURIComponent(pathname.replace('/api/realtime/route/', '')).trim();
        let route = routeCache[code] || routeCache[code.toUpperCase()];

        if (!route) {
            res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ success: false, message: 'Route not found' }));
        }

        const now = Date.now();
        const cached = routeRealtimeCache.get(code);
        if (cached && (now - cached.timestamp < 3500)) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({
                success: true,
                route: route.code,
                count: cached.buses.length,
                buses: cached.buses
            }));
        }

        const stationsGo = route.go.stations || [];
        const stationsRet = route.ret.stations || [];
        const allStations = [...stationsGo, ...stationsRet];

        // Pick sample stations: every 2-3 stations to cover the entire line thoroughly
        const sampleStations = [];
        const step = Math.max(1, Math.min(3, Math.floor(allStations.length / 25)));
        for (let i = 0; i < allStations.length; i += step) {
            sampleStations.push(allStations[i]);
        }
        if (allStations.length > 0 && !sampleStations.includes(allStations[allStations.length - 1])) {
            sampleStations.push(allStations[allStations.length - 1]);
        }

        const busMap = new Map();
        const batchSize = 6;
        for (let i = 0; i < sampleStations.length; i += batchSize) {
            const batch = sampleStations.slice(i, i + batchSize);
            const promises = batch.map(st =>
                fetchRealtimeStation(st.stationId, true, route.code).then(r => {
                    if (r && r.st && Array.isArray(r.dt)) {
                        for (const b of r.dt) {
                            if (String(b.Fleet).trim().toLowerCase() === String(route.code).trim().toLowerCase()) {
                                const isGo = (b.FleetCode || '').includes('Đi') || (b.FleetCode || '').includes('Xuất');
                                const stList = isGo ? stationsGo : stationsRet;
                                const targetStation = stList.find(s => s.stationId === st.stationId) || st;
                                const path = isGo ? (route.go ? route.go.path : []) : (route.ret ? route.ret.path : []);

                                const existing = busMap.get(b.BienKiemSoat);
                                // Pin bus to the closest approaching station (smallest PartRemained)
                                if (!existing || (typeof b.PartRemained === 'number' && b.PartRemained < existing.partRemained)) {
                                    // Interpolate exact road position along polyline
                                    const pos = interpolatePositionBackwards(path, targetStation.lat, targetStation.lng, b.PartRemained || 0);
                                    const parts = (route.name || '').split('-');
                                    const destGo = parts[parts.length - 1] ? parts[parts.length - 1].trim() : 'Bến cuối';
                                    const destRet = parts[0] ? parts[0].trim() : 'Bến đầu';

                                    busMap.set(b.BienKiemSoat, {
                                        plate: b.BienKiemSoat,
                                        fleet: b.Fleet,
                                        fleetCode: b.FleetCode,
                                        partRemained: b.PartRemained,
                                        timeRemained: b.TimeRemained,
                                        speed: b.Speed,
                                        nextStation: targetStation.name || targetStation.address,
                                        nextStationId: targetStation.stationId,
                                        isGo: isGo,
                                        directionText: isGo ? `Chiều đi (➜ ${destGo})` : `Chiều về (⬅ ${destRet})`,
                                        dirShort: isGo ? 'Đi' : 'Về',
                                        targetLat: targetStation.lat,
                                        targetLng: targetStation.lng,
                                        lat: pos.lat,
                                        lng: pos.lng,
                                        bearing: pos.bearing,
                                        path: path
                                    });
                                }
                            }
                        }
                    }
                })
            );
            await Promise.all(promises);
        }

        const resultBuses = Array.from(busMap.values());
        routeRealtimeCache.set(code, { timestamp: Date.now(), buses: resultBuses });

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
            success: true,
            route: route.code,
            count: resultBuses.length,
            buses: resultBuses
        }));
    }

    // Static File Serving
    let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath)) {
        filePath = path.join(__dirname, 'public', 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(500);
            return res.end('Server Error: ' + err.code);
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content, 'utf-8');
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`  BUS HANOI PRO - Ứng dụng Tìm Buýt Realtime Tinh Gọn`);
    console.log(`  Đang chạy tại: http://localhost:${PORT}`);
    console.log(`=======================================================`);
});
