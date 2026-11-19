// Tìm Bus Promax — logic phía trình duyệt
'use strict';

// ==========================================
// 0. HẰNG SỐ, TIỆN ÍCH
// ==========================================
const DEFAULT_ROUTE = '83';
const POLL_MS = 4000;
const ALERT_POLL_MS = 5000;
const UPDATE_URL = 'https://raw.githubusercontent.com/tuanleanh89/timbus_promax/main/version.json';
const KEY = {
    defaultRoute: 'bus_hanoi_default_route',
    favs: code => 'bus_fav_stations_' + String(code).trim(),
    legacyFav: code => 'bus_fav_station_' + String(code).trim(),
    updateUrl: 'custom_bus_update_url',
    dismissedUpdate: 'bus_update_dismissed',
    ringTested: 'bus_ring_tested'
};
const BUS_SIZE = [18, 18];
const BUS_SIZE_NEAREST = [24, 24];

const $ = id => document.getElementById(id);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
const isDesktop = () => window.innerWidth >= 900;
const dirOfBus = b => (b.isGo === false ? 'ret' : 'go');
const dirLabel = dir => (dir === 'ret' ? 'Chiều về' : 'Chiều đi');

function fmtDist(m) {
    m = Math.max(0, Math.round(m || 0));
    return m >= 1000 ? (m / 1000).toFixed(1).replace('.', ',') + ' km' : m + ' m';
}

function etaMinutes(meters, speedKmh) {
    const mps = Math.max(3.5, ((speedKmh > 5 ? speedKmh : 25) * 1000) / 3600);
    return Math.max(1, Math.round(meters / mps / 60));
}

function formatCost(cost) {
    const num = parseInt(String(cost || '').replace(/\D/g, ''), 10);
    return (num || 7000).toLocaleString('vi-VN') + 'đ';
}

// "0|T2 - T6|05:00,21:00;0|T7|05:00,21:00;###1|..." -> "05:00 – 21:00 (hằng ngày)"
function formatOperationsTime(raw) {
    if (!raw) return 'Đang cập nhật';
    if (!raw.includes('|')) return raw;
    const parts = raw.split('###')[0].split(';').filter(Boolean).map(p => {
        const [, days, times] = p.split('|');
        return { days, times: (times || '').replace(',', ' – ') };
    });
    const uniqueTimes = [...new Set(parts.map(p => p.times))];
    if (uniqueTimes.length === 1) return `${uniqueTimes[0]} (hằng ngày)`;
    return parts.map(p => `${p.days}: ${p.times}`).join(' · ');
}

let toastTimer = null;
function toast(msg, ms = 2800) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function showLoading(show) { $('loading').hidden = !show; }

async function getJson(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok && res.status !== 404) throw new Error('HTTP ' + res.status);
    return res.json();
}

// ==========================================
// 1. TRẠNG THÁI
// ==========================================
const state = {
    map: null,
    layers: {},
    route: null,
    geo: { go: null, ret: null },          // lộ trình đã tính quãng đường tích luỹ
    orders: { go: new Map(), ret: new Map() }, // stationId -> số thứ tự trạm
    dir: 'go',
    station: null,                         // trạm đang chọn
    stopMarkers: new Map(),                // stationId -> marker của chiều hiện tại
    tempStopMarker: null,
    buses: new Map(),                      // biển số -> xe
    nearestPlate: null,
    alert: null,                           // canh xe đến trạm
    departure: null,                       // canh xe xuất bến
    modal: null,                           // { mode: 'station'|'departure', target }
    searchResults: [],
    picking: false,
    userMarker: null,
    userCircle: null,
    version: null
};

// ==========================================
// 2. LƯU TRỮ (tuyến mặc định, trạm đã lưu)
// ==========================================
const getDefaultRoute = () => localStorage.getItem(KEY.defaultRoute) || DEFAULT_ROUTE;

function getFavs(code) {
    try {
        const raw = localStorage.getItem(KEY.favs(code));
        if (raw) { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; }
        const legacy = localStorage.getItem(KEY.legacyFav(code));
        return legacy ? [JSON.parse(legacy)].filter(Boolean) : [];
    } catch { return []; }
}

const saveFavs = (code, list) => localStorage.setItem(KEY.favs(code), JSON.stringify(list));

// Trạm đã lưu có thuộc chiều `dir` không (bản ghi cũ không có `direction` thì suy ra từ danh sách trạm)
function favMatches(f, stationId, dir) {
    if (f.stationId !== stationId) return false;
    return f.direction ? f.direction === dir : state.orders[dir].has(stationId);
}

function isFav(stationId, dir) {
    return !!state.route && getFavs(state.route.code).some(f => favMatches(f, stationId, dir));
}

function toggleFav(st) {
    if (!state.route || !st) return;
    const dir = st.dir || state.dir;
    const list = getFavs(state.route.code);
    const i = list.findIndex(f => favMatches(f, st.stationId, dir));
    if (i >= 0) list.splice(i, 1);
    else list.push({ stationId: st.stationId, name: st.name, lat: st.lat, lng: st.lng, direction: dir });
    saveFavs(state.route.code, list);
    renderSavedChips();
    renderStationList();
    renderFocusStatic();
}

function currentDirFavs() {
    if (!state.route) return [];
    return getFavs(state.route.code).filter(f => favMatches(f, f.stationId, state.dir));
}

// ==========================================
// 3. BẢN ĐỒ
// ==========================================
function initMap() {
    const map = L.map('map', {
        zoomControl: false,
        attributionControl: false,
        preferCanvas: true,      // vẽ lộ trình bằng canvas: nhẹ hơn SVG khi kéo/zoom
        zoomSnap: 0.5
    }).setView([21.0285, 105.8542], 13);
    // Google Maps đường phố, ẩn địa điểm (POI) và icon giao thông công cộng của Google
    // để bản đồ thoáng, không lẫn với chấm trạm của app. Ô bản đồ ~15 KB, được sw.js cache lâu dài.
    L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&hl=vi&x={x}&y={y}&z={z}&apistyle=s.t%3A2%7Cp.v%3Aoff%2Cs.t%3A4%7Cp.v%3Aoff', {
        maxZoom: 20,
        subdomains: ['0', '1', '2', '3'],
        crossOrigin: 'anonymous',
        keepBuffer: 4,           // giữ thêm ô xung quanh để kéo bản đồ không bị trắng
        updateWhenZooming: false
    }).addTo(map);

    state.map = map;
    state.layers = {
        route: L.layerGroup().addTo(map),
        stops: L.layerGroup().addTo(map),
        buses: L.layerGroup().addTo(map)
    };

    const el = map.getContainer();
    const syncLabels = () => el.classList.toggle('show-labels', map.getZoom() >= 16);
    // Tắt hiệu ứng trượt của xe khi đang zoom để xe không "bay" qua màn hình
    map.on('zoomstart', () => el.classList.add('zooming'));
    map.on('zoomend', () => { syncLabels(); setTimeout(() => el.classList.remove('zooming'), 50); });
    syncLabels();

    map.on('click', e => {
        if (!state.picking) return;
        state.picking = false;
        setUserPosition(e.latlng.lat, e.latlng.lng, 20);
    });
}

function fitRoute() {
    const line = state.layers.route.getLayers()[0];
    if (line) state.map.fitBounds(line.getBounds(), { paddingTopLeft: [20, 130], paddingBottomRight: [20, 40] });
}

// ==========================================
// 4. TUYẾN XE
// ==========================================
async function selectRoute(code) {
    showLoading(true);
    let json;
    try {
        json = await getJson(`/api/route/${encodeURIComponent(code)}`);
    } catch (e) {
        showLoading(false);
        return toast('Lỗi tải dữ liệu tuyến: ' + e.message);
    }
    showLoading(false);
    if (!json.success) return toast(`Không tìm thấy tuyến ${code}`);

    const route = json.data;
    state.route = route;
    state.geo = { go: Geo.buildGeo(route.go.path), ret: Geo.buildGeo(route.ret.path) };
    state.orders = {
        go: new Map(route.go.stations.map((s, i) => [s.stationId, s.order || i + 1])),
        ret: new Map(route.ret.stations.map((s, i) => [s.stationId, s.order || i + 1]))
    };
    state.dir = 'go';
    clearStation();
    clearBuses();

    $('route-row').hidden = false;
    $('route-code').textContent = route.code;
    $('route-title').textContent = route.name;
    renderDefaultStar();
    renderDirection(true);
    renderRouteInfo();
    startPolling();
}

function setDirection(dir, fit = true) {
    if (state.dir === dir) return;
    state.dir = dir;
    renderDirection(fit);
    refreshBuses();
}

function renderDirection(fit) {
    $('btn-dir-go').classList.toggle('active', state.dir === 'go');
    $('btn-dir-ret').classList.toggle('active', state.dir === 'ret');
    renderRouteLayers();
    renderSavedChips();
    renderStationList();
    if (fit) fitRoute();
}

function renderRouteLayers() {
    const { route, dir, layers } = state;
    const data = route[dir];
    const color = dir === 'go' ? '#2563eb' : '#ea580c';

    layers.route.clearLayers();
    if (data.path.length) {
        L.polyline(data.path, { color, weight: 5, opacity: 0.85, lineJoin: 'round' }).addTo(layers.route);
    }

    layers.stops.clearLayers();
    state.stopMarkers.clear();
    state.tempStopMarker = null;
    const last = data.stations.length - 1;
    data.stations.forEach((st, i) => {
        if (!st.lat || !st.lng) return;
        const terminal = i === 0 || i === last;
        const icon = L.divIcon({
            className: `stop-icon ${dir}${terminal ? ' terminal' : ''}`,
            html: `<div class="stop-dot"></div><div class="stop-label">${esc(st.name)}</div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        const m = L.marker([st.lat, st.lng], { icon, title: st.name, zIndexOffset: terminal ? 100 : 0 })
            .on('click', () => selectStation({ ...st, dir }))
            .addTo(layers.stops);
        state.stopMarkers.set(st.stationId, m);
    });
    highlightStopMarker();
}

function renderDefaultStar() {
    const btn = $('btn-set-default');
    const on = state.route && String(state.route.code) === getDefaultRoute();
    btn.classList.toggle('on', on);
    btn.textContent = on ? '★' : '☆';
    btn.title = on ? 'Đây là tuyến mặc định khi mở app' : 'Đặt làm tuyến mặc định';
}

function renderSavedChips() {
    const row = $('saved-row');
    const favs = currentDirFavs();
    row.hidden = favs.length === 0;
    row.innerHTML = favs.map((f, i) => `
        <div class="chip" data-action="chip" data-idx="${i}" title="${esc(f.name)}">
            <span class="chip-name">★ ${esc(f.name)}</span>
            <button class="chip-del" data-action="chip-del" data-idx="${i}" aria-label="Bỏ lưu">✕</button>
        </div>`).join('');
}

function renderStationList() {
    if (!state.route) return;
    const stations = state.route[state.dir].stations;
    $('station-count').textContent = stations.length;
    $('pane-stations').innerHTML = stations.length ? stations.map((st, i) => {
        const fav = isFav(st.stationId, state.dir);
        const sub = st.address && st.address !== st.name ? st.address : '';
        const sel = state.station && state.station.stationId === st.stationId;
        return `
        <div class="row${sel ? ' hl' : ''}" id="stop-row-${st.stationId}" data-action="select-stop" data-idx="${i}">
            <div class="order">${st.order || i + 1}</div>
            <div class="row-main">
                <div class="row-title">${esc(st.name)}</div>
                ${sub ? `<div class="row-sub">${esc(sub)}</div>` : ''}
            </div>
            <button class="icon-btn star${fav ? ' on' : ''}" data-action="fav-stop" data-idx="${i}" aria-label="Lưu trạm">${fav ? '★' : '☆'}</button>
        </div>`;
    }).join('') : '<div class="empty">Chưa có thông tin điểm dừng.</div>';
}

function renderRouteInfo() {
    const r = state.route;
    $('route-info').innerHTML = `
        <div class="info">
            <dl>
                <dt>Tuyến</dt><dd>${esc(r.code)} · ${esc(r.name)}</dd>
                <dt>Tần suất</dt><dd>${esc(r.frequence || 'Đang cập nhật')}</dd>
                <dt>Giá vé</dt><dd>${formatCost(r.cost)}</dd>
                <dt>Hoạt động</dt><dd>${esc(formatOperationsTime(r.operationsTime))}</dd>
            </dl>
            <h4>Lộ trình chiều đi</h4><p>${esc(r.trajectoryGo || 'Đang cập nhật')}</p>
            <h4>Lộ trình chiều về</h4><p>${esc(r.trajectoryReturn || 'Đang cập nhật')}</p>
        </div>`;
}

// ==========================================
// 5. ĐIỂM DỪNG ĐANG CHỌN
// ==========================================
// Xác định trạm thuộc chiều nào của tuyến hiện tại (null nếu không thuộc tuyến)
function resolveStationDir(st, preferred) {
    const inGo = state.orders.go.has(st.stationId);
    const inRet = state.orders.ret.has(st.stationId);
    if (inGo && inRet) return preferred || state.dir;
    return inGo ? 'go' : inRet ? 'ret' : null;
}

async function selectStation(st) {
    // Trạm từ ô tìm kiếm không thuộc tuyến đang xem -> chuyển sang tuyến đầu tiên đi qua trạm
    if (!state.route || !resolveStationDir(st)) {
        const fleets = String(st.fleetOver || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!state.route || (fleets.length && !fleets.includes(String(state.route.code)))) {
            await selectRoute(fleets[0] || getDefaultRoute());
        }
    }
    if (!state.route) return;

    const dir = resolveStationDir(st, st.dir);
    if (dir && dir !== state.dir) setDirection(dir, false);
    const routeSt = dir && state.route[dir].stations.find(s => s.stationId === st.stationId);
    state.station = { ...st, ...(routeSt || {}), dir, order: dir ? state.orders[dir].get(st.stationId) : null };

    document.body.classList.add('has-focus');
    $('focus-card').hidden = false;
    highlightStopMarker();
    if (st.lat && st.lng) state.map.setView([st.lat, st.lng], 16);
    renderFocusStatic();
    updateFocus();
    renderStationList();
}

function clearStation() {
    state.station = null;
    state.nearestPlate = null;
    document.body.classList.remove('has-focus');
    $('focus-card').hidden = true;
    highlightStopMarker();
    for (const b of state.buses.values()) setBusIcon(b, false);
    renderBusList();
}

function highlightStopMarker() {
    for (const m of state.stopMarkers.values()) m.getElement()?.classList.remove('selected');
    if (state.tempStopMarker) { state.layers.stops.removeLayer(state.tempStopMarker); state.tempStopMarker = null; }
    const st = state.station;
    if (!st) return;
    const m = state.stopMarkers.get(st.stationId);
    if (m) { m.getElement()?.classList.add('selected'); return; }
    if (!st.lat || !st.lng) return;
    // Trạm không thuộc tuyến: vẽ marker tạm
    state.tempStopMarker = L.marker([st.lat, st.lng], {
        icon: L.divIcon({
            className: 'stop-icon selected',
            html: `<div class="stop-dot"></div><div class="stop-label">${esc(st.name)}</div>`,
            iconSize: [20, 20], iconAnchor: [10, 10]
        }),
        zIndexOffset: 500
    }).addTo(state.layers.stops);
}

// Phần tĩnh của thẻ trạm (tên, chiều, nút) — chỉ đổi khi chọn trạm / đổi trạng thái
function renderFocusStatic() {
    const st = state.station;
    if (!st) return;
    $('focus-name').textContent = st.name || 'Điểm dừng';
    $('focus-name').title = st.name || '';
    const dirEl = $('focus-dir');
    dirEl.className = 'dir-tag ' + (st.dir || '');
    dirEl.textContent = st.dir ? dirLabel(st.dir) : '';
    $('focus-route').textContent = st.dir ? `· Tuyến ${state.route.code}` : `Không thuộc tuyến ${state.route.code}`;

    const fav = st.dir && isFav(st.stationId, st.dir);
    const favBtn = $('btn-focus-fav');
    favBtn.hidden = !st.dir;
    favBtn.classList.toggle('on', !!fav);
    favBtn.textContent = fav ? '★' : '☆';

    const alerting = isAlertingStation(st);
    const alertBtn = $('btn-focus-alert');
    alertBtn.hidden = !st.dir;
    alertBtn.textContent = alerting ? 'Tắt báo' : 'Báo xe đến';
    alertBtn.classList.toggle('btn-primary', !alerting);
}

const isAlertingStation = st => !!(state.alert && st && state.alert.station.stationId === st.stationId);

// Phần động (ETA) — cập nhật mỗi giây, chỉ đổi text nên không làm mất thao tác chạm
function updateFocus() {
    const st = state.station;
    if (!st) return;
    const approaching = [];
    for (const b of state.buses.values()) {
        const rel = relToStation(b, st);
        b.rel = rel;
        if (rel && !rel.passed) approaching.push(b);
    }
    approaching.sort((a, b) => a.rel.meters - b.rel.meters);
    const nearest = approaching[0];

    if (!st.dir) {
        $('focus-eta').textContent = '—';
        $('focus-detail').textContent = 'Chọn tuyến đi qua trạm này để xem xe';
    } else if (nearest) {
        const { meters } = nearest.rel;
        $('focus-eta').textContent = meters <= 50 ? 'Đang tới' : `${etaMinutes(meters, nearest.speed)} phút`;
        $('focus-detail').textContent = `${nearest.plate} · cách ${fmtDist(meters)}`;
    } else {
        $('focus-eta').textContent = 'Chưa có xe';
        $('focus-detail').textContent = `Chưa thấy xe ${dirLabel(st.dir).toLowerCase()} đang tới`;
    }
    $('btn-focus-bus').hidden = !nearest;

    const next = approaching[1];
    $('focus-next').hidden = !next;
    if (next) $('focus-next').textContent = `Xe sau: ${next.plate} · ${fmtDist(next.rel.meters)} · ~${etaMinutes(next.rel.meters, next.speed)} phút`;

    const plate = nearest ? nearest.plate : null;
    if (plate !== state.nearestPlate) {
        const prev = state.buses.get(state.nearestPlate);
        if (prev) setBusIcon(prev, false);
        if (nearest) setBusIcon(nearest, true);
        state.nearestPlate = plate;
    }
}

// ==========================================
// 6. XE ĐANG CHẠY
// ==========================================
// Quan hệ giữa xe và trạm: null nếu khác chiều; { passed, meters } nếu cùng chiều
function relToStation(b, st) {
    if (!st || !st.dir || dirOfBus(b) !== st.dir) return null;
    const order = state.orders[st.dir];
    const nextOrder = order.get(b.nextStationId);
    if (nextOrder && st.order && nextOrder > st.order) return { passed: true, meters: 0 };

    const geo = state.geo[st.dir];
    if (geo.path.length && b.s != null) {
        const stS = Geo.along(geo, st.lat, st.lng);
        const d = stS - b.s;
        return d < -20 ? { passed: true, meters: 0 } : { passed: false, meters: Math.max(10, d) };
    }
    return { passed: false, meters: Geo.distance(b.lat, b.lng, st.lat, st.lng) };
}

// Đặt vị trí xe theo quãng đường còn lại tới trạm kế tiếp, nội suy dọc lộ trình
function positionBus(b) {
    const geo = state.geo[dirOfBus(b)];
    if (!geo || !geo.path.length || !b.targetLat) { b.s = null; return; }
    const targetS = Geo.along(geo, b.targetLat, b.targetLng);
    b.s = targetS - (b.partRemained || 0);
    const p = Geo.pointAt(geo, b.s);
    if (p) { b.lat = p.lat; b.lng = p.lng; }
    const a = Geo.pointAt(geo, b.s - 10), z = Geo.pointAt(geo, b.s + 10);
    if (a && z && (a.lat !== z.lat || a.lng !== z.lng)) b.heading = Geo.bearing(a.lat, a.lng, z.lat, z.lng);
}

// Xoay đầu xe theo hướng chạy (cộng dồn góc để xoay theo đường ngắn nhất, không quay vòng)
function applyHeading(b) {
    if (b.heading == null) return;
    const prev = b.rot == null ? b.heading : b.rot;
    const d = ((b.heading - prev) % 360 + 540) % 360 - 180;
    b.rot = prev + d;
    const el = b.marker?.getElement()?.firstElementChild;
    if (el) el.style.transform = `rotate(${b.rot}deg)`;
}

function busIcon(b, nearest) {
    const [w, h] = nearest ? BUS_SIZE_NEAREST : BUS_SIZE;
    const color = b.isGo === false ? '#ea580c' : '#2563eb';
    const rot = b.rot == null ? (b.heading || 0) : b.rot;
    // Xe nhìn từ trên xuống, đầu xe hướng lên (Bắc) rồi xoay theo hướng chạy
    const svg = `<svg viewBox="0 0 20 20" width="${w}" height="${h}"><rect x="6.5" y="1.5" width="7" height="17" rx="2.4" fill="${color}" stroke="#fff" stroke-width="1.2"/><rect x="7.8" y="3" width="4.4" height="3" rx="1" fill="#fff"/></svg>`;
    return L.divIcon({
        className: `bus-icon${nearest ? ' nearest' : ''}`,
        html: `<div class="bus-rot" style="transform:rotate(${rot}deg)">${svg}</div>`,
        iconSize: [w, h],
        iconAnchor: [w / 2, h / 2]
    });
}

function setBusIcon(b, nearest) {
    if (!b.marker || b.nearest === nearest) return;
    b.nearest = nearest;
    b.marker.setIcon(busIcon(b, nearest));
    b.marker.setZIndexOffset(nearest ? 1000 : 0);
}

function busPopupHtml(b) {
    const rel = state.station && relToStation(b, state.station);
    let relLine = '';
    if (rel) {
        relLine = rel.passed
            ? `<div class="popup-line">Đã qua ${esc(state.station.name)}</div>`
            : `<div class="popup-line">Tới ${esc(state.station.name)}: <b>${fmtDist(rel.meters)}</b> (~${etaMinutes(rel.meters, b.speed)} phút)</div>`;
    }
    return `
        <div class="popup">
            <div class="popup-title">${esc(b.plate)}</div>
            <div class="popup-line"><span class="dir-tag ${dirOfBus(b)}">${esc(b.directionText || dirLabel(dirOfBus(b)))}</span></div>
            <div class="popup-line">Trạm kế: ${esc(b.nextStation || '—')} · ${fmtDist(b.partRemained)}</div>
            ${relLine}
            <button class="btn" data-action="departure" data-plate="${esc(b.plate)}">Canh xe này xuất bến</button>
        </div>`;
}

function clearBuses() {
    state.layers.buses.clearLayers();
    state.buses.clear();
    state.nearestPlate = null;
    updateBusCount(0);
}

function updateBusCount(n) {
    $('bus-count').textContent = n;
    $('fab-bus-count').textContent = n;
    $('fab-bus-count').hidden = n === 0;
}

let pollTimer = null;
let tickTimer = null;
function startPolling() {
    clearInterval(pollTimer);
    clearInterval(tickTimer);
    refreshBuses();
    pollTimer = setInterval(refreshBuses, POLL_MS);
    tickTimer = setInterval(tick, 1000);
}

let refreshing = false;
async function refreshBuses() {
    if (!state.route || refreshing) return;
    refreshing = true;
    const code = state.route.code;
    try {
        const json = await getJson(`/api/realtime/route/${encodeURIComponent(code)}`);
        if (!json.success || !state.route || state.route.code !== code) return;
        applyBuses(json.buses || []);
    } catch (e) {
        console.warn('Realtime fetch failed:', e);
    } finally {
        refreshing = false;
    }
}

function applyBuses(list) {
    const seen = new Set();
    for (const data of list) {
        if (!data.lat || !data.lng || !data.plate) continue;
        seen.add(data.plate);
        let b = state.buses.get(data.plate);
        const dirChanged = b && b.isGo !== data.isGo;
        if (!b) {
            b = { ...data };
            state.buses.set(b.plate, b);
        } else {
            Object.assign(b, data);
        }
        positionBus(b);
        if (!b.marker) {
            b.nearest = false;
            b.marker = L.marker([b.lat, b.lng], { icon: busIcon(b, false) })
                .bindPopup(() => busPopupHtml(b), { offset: [0, -10] })
                .addTo(state.layers.buses);
        } else {
            b.marker.setLatLng([b.lat, b.lng]);
            applyHeading(b);
            if (dirChanged) { b.nearest = null; setBusIcon(b, b.plate === state.nearestPlate); }
        }
        checkDeparture(b);
    }
    for (const [plate, b] of state.buses) {
        if (seen.has(plate)) continue;
        state.layers.buses.removeLayer(b.marker);
        state.buses.delete(plate);
        if (state.nearestPlate === plate) state.nearestPlate = null;
    }
    updateBusCount(state.buses.size);
    updateFocus();
    checkAlertLocal();
    renderBusList();
}

// Mỗi giây: cho xe đang chạy tiến dần theo vận tốc báo về (xe đứng yên thì giữ nguyên)
function tick() {
    for (const b of state.buses.values()) {
        if (!(b.speed > 3) || !(b.partRemained > 15) || b.s == null) continue;
        b.partRemained = Math.max(0, b.partRemained - Math.min(14, (b.speed * 1000) / 3600));
        if (b.timeRemained > 0) b.timeRemained--;
        positionBus(b);
        b.marker.setLatLng([b.lat, b.lng]);
        applyHeading(b);
    }
    updateFocus();
    checkAlertLocal();
}

function renderBusList() {
    if (!$('sheet').classList.contains('open') || !$('pane-buses').classList.contains('active')) return;
    const st = state.station;
    const buses = [...state.buses.values()].map(b => ({ b, rel: st ? relToStation(b, st) : null }));
    const rank = x => (x.rel && !x.rel.passed ? 0 : x.rel ? 1 : 2);
    buses.sort((x, y) => rank(x) - rank(y) || (x.rel?.meters || 0) - (y.rel?.meters || 0));

    $('pane-buses').innerHTML = buses.length ? buses.map(({ b, rel }) => {
        let side = `<b>${fmtDist(b.partRemained)}</b><small>tới trạm kế</small>`;
        if (st) {
            if (!rel) side = '<small>Ngược chiều</small>';
            else if (rel.passed) side = '<small>Đã qua trạm</small>';
            else side = `<b>${etaMinutes(rel.meters, b.speed)} phút</b><small>${fmtDist(rel.meters)}</small>`;
        }
        return `
        <div class="row${b.plate === state.nearestPlate ? ' hl' : ''}" data-action="bus" data-plate="${esc(b.plate)}">
            <span class="dot ${dirOfBus(b)}"></span>
            <div class="row-main">
                <div class="row-title">${esc(b.plate)}</div>
                <div class="row-sub">→ ${esc(b.nextStation || 'Dọc tuyến')}</div>
            </div>
            <div class="row-side">${side}</div>
        </div>`;
    }).join('') : '<div class="empty">Chưa thấy xe nào đang chạy. Tự động cập nhật mỗi 4 giây.</div>';
}

function focusBus(plate) {
    const b = state.buses.get(plate);
    if (!b) return;
    if (!isDesktop()) closeSheet();
    state.map.setView([b.lat, b.lng], 16);
    setTimeout(() => b.marker.openPopup(), 250);
}

// ==========================================
// 7. ÂM THANH, RUNG, THÔNG BÁO, CUỘC GỌI MÔ PHỎNG
// ==========================================
let audioCtx = null;
let ringTimer = null;
let ringStopTimer = null;

function ensureAudio() {
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch { audioCtx = null; }
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}

function startRingtone(maxMs = 30000) {
    stopRingtone();
    ensureAudio();
    if (!audioCtx) return;
    const burst = () => {
        const t = audioCtx.currentTime;
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.35, t + 0.05);
        gain.gain.setValueAtTime(0.35, t + 1.6);
        gain.gain.linearRampToValueAtTime(0.001, t + 1.8);
        gain.connect(audioCtx.destination);
        for (const f of [440, 480]) {
            const o = audioCtx.createOscillator();
            o.frequency.value = f;
            o.connect(gain);
            o.start(t);
            o.stop(t + 1.8);
        }
    };
    burst();
    ringTimer = setInterval(burst, 2800);
    ringStopTimer = setTimeout(stopRingtone, maxMs);
}

function stopRingtone() {
    clearInterval(ringTimer);
    clearTimeout(ringStopTimer);
    ringTimer = ringStopTimer = null;
}

function vibrate() {
    try { navigator.vibrate?.([500, 200, 500, 200, 500]); } catch { /* không hỗ trợ */ }
}

async function notify(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = { body, icon: 'icon.png', tag: 'timbus', renotify: true, vibrate: [500, 200, 500] };
    try {
        // Android chỉ cho hiện thông báo qua service worker
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) return reg.showNotification(title, opts);
        new Notification(title, opts);
    } catch { /* trình duyệt không hỗ trợ */ }
}

function speak(text) {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'vi-VN';
    const vi = speechSynthesis.getVoices().find(v => /vi/i.test(v.lang));
    if (vi) u.voice = vi;
    speechSynthesis.speak(u);
}

let callVoice = '';
function showCall(plate, sub, voice) {
    callVoice = voice;
    $('call-name').textContent = `Xe ${plate}`;
    $('call-sub').textContent = sub;
    $('call-status').textContent = 'Đang đổ chuông...';
    $('call-overlay').classList.remove('active');
    $('call-overlay').hidden = false;
}

function answerCall() {
    stopRingtone();
    $('call-overlay').classList.add('active');
    $('call-status').textContent = 'Đang nghe...';
    speak(callVoice);
}

function endCall() {
    stopRingtone();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    $('call-overlay').hidden = true;
}

// Phát cảnh báo theo cấu hình người dùng chọn
function fireAlert(opts, { plate, title, body, sub, voice }) {
    if (opts.sound) startRingtone();
    if (opts.vibrate) vibrate();
    notify(title, body);
    if (opts.call) showCall(plate, sub, voice);
    else toast(`🔔 ${title}`, 8000);
}

// ==========================================
// 8. CẢNH BÁO: XE SẮP ĐẾN TRẠM & XE XUẤT BẾN
// ==========================================
function openAlertModal(mode, target) {
    state.modal = { mode, target };
    const isStation = mode === 'station';
    $('alert-modal-title').textContent = isStation ? 'Báo khi xe sắp đến' : 'Canh xe xuất bến';
    $('alert-modal-target').textContent = isStation
        ? `${target.name} · Tuyến ${state.route.code} · ${dirLabel(target.dir)}`
        : `Xe ${target.plate} · Tuyến ${target.fleet}. Báo ngay khi xe bắt đầu chạy.`;
    $('distance-field').hidden = !isStation;
    $('btn-test-alert').hidden = !!localStorage.getItem(KEY.ringTested); // chỉ cần thử lần đầu
    $('alert-modal').hidden = false;
    ensureAudio();
}

function closeAlertModal() {
    $('alert-modal').hidden = true;
    state.modal = null;
}

function activateAlert() {
    const m = state.modal;
    if (!m) return;
    const opts = { call: $('chk-call').checked, sound: $('chk-sound').checked, vibrate: $('chk-vibrate').checked };
    closeAlertModal();

    if (m.mode === 'station') {
        state.alert = { ...opts, routeCode: state.route.code, station: m.target, maxDistance: +$('alert-distance').value, notifiedPlate: null };
        setAlertStatus();
        renderFocusStatic();
        checkAlertLocal();
        pollAlertStation();
    } else {
        const b = m.target;
        state.departure = { ...opts, plate: b.plate, fleet: b.fleet, lat: b.lat, lng: b.lng };
        $('status-departure-text').textContent = `🚀 Đang canh xe ${b.plate} xuất bến`;
        $('status-departure').classList.remove('hot');
        $('status-departure').hidden = false;
        toast('Sẽ báo ngay khi xe bắt đầu chạy');
    }
}

function setAlertStatus(hotText) {
    const a = state.alert;
    const el = $('status-alert');
    el.hidden = !a;
    if (!a) return;
    el.classList.toggle('hot', !!hotText);
    $('status-alert-text').textContent = hotText || `🔔 ${a.station.name} · báo khi < ${fmtDist(a.maxDistance)}`;
}

function stopAlert() {
    state.alert = null;
    stopRingtone();
    setAlertStatus();
    renderFocusStatic();
}

function stopDeparture() {
    state.departure = null;
    stopRingtone();
    $('status-departure').hidden = true;
}

// Kiểm tra trên client (mỗi giây) với các xe đang hiển thị
function checkAlertLocal() {
    const a = state.alert;
    if (!a || !state.route || String(state.route.code) !== String(a.routeCode)) return;
    let best = null;
    for (const b of state.buses.values()) {
        const rel = relToStation(b, a.station);
        if (b.plate === a.notifiedPlate && rel && rel.passed) {
            a.notifiedPlate = null; // xe đã báo đã qua trạm -> canh xe tiếp theo
            setAlertStatus();
        }
        if (rel && !rel.passed && rel.meters <= a.maxDistance && (!best || rel.meters < best.meters)) {
            best = { plate: b.plate, meters: rel.meters, speed: b.speed };
        }
    }
    if (best) triggerStationAlert(best.plate, best.meters, etaMinutes(best.meters, best.speed));
}

// Kiểm tra định kỳ với API trạm (chính xác hơn, cả khi đang xem tuyến khác)
async function pollAlertStation() {
    const a = state.alert;
    if (!a) return;
    try {
        const json = await getJson(`/api/realtime/station/${a.station.stationId}?fleet=${encodeURIComponent(a.routeCode)}`);
        if (state.alert !== a || !json.success) return;
        const wantGo = a.station.dir === 'go';
        const hit = (json.buses || []).find(b =>
            String(b.fleet).trim().toLowerCase() === String(a.routeCode).toLowerCase() &&
            b.isGo === wantGo && typeof b.partRemained === 'number' && b.partRemained <= a.maxDistance);
        if (hit) triggerStationAlert(hit.plate, hit.partRemained, Math.max(1, Math.round((hit.timeRemained || 60) / 60)));
    } catch (e) {
        console.warn('Alert check failed:', e);
    }
}

function triggerStationAlert(plate, meters, eta) {
    const a = state.alert;
    setAlertStatus(`⚠️ Xe ${plate} cách ${fmtDist(meters)} (~${eta} phút)`);
    if (a.notifiedPlate === plate) return;
    a.notifiedPlate = plate;
    fireAlert(a, {
        plate,
        title: `Xe tuyến ${a.routeCode} sắp đến ${a.station.name}`,
        body: `Xe ${plate} còn cách ${fmtDist(meters)} (~${eta} phút).`,
        sub: `Cách trạm ${fmtDist(meters)} · ~${eta} phút`,
        voice: `Xe buýt biển số ${plate} tuyến ${a.routeCode} còn cách điểm dừng ${a.station.name} khoảng ${Math.round(meters)} mét, khoảng ${eta} phút nữa sẽ tới. Quý khách vui lòng chuẩn bị đón xe.`
    });
}

// Xe được coi là xuất bến khi báo vận tốc >= 5 km/h hoặc đã dịch chuyển >= 60 m
function checkDeparture(b) {
    const d = state.departure;
    if (!d || b.plate !== d.plate) return;
    const moved = Geo.distance(b.lat, b.lng, d.lat, d.lng);
    if (!(b.speed >= 5 || moved >= 60)) return;
    state.departure = null;
    $('status-departure-text').textContent = `⚠️ Xe ${d.plate} đã xuất bến!`;
    $('status-departure').classList.add('hot');
    fireAlert(d, {
        plate: d.plate,
        title: `Xe ${d.plate} đã xuất bến`,
        body: `Xe tuyến ${d.fleet} vừa bắt đầu chạy.`,
        sub: `Tuyến ${d.fleet} · Đã xuất bến`,
        voice: `Xe buýt biển số ${d.plate} tuyến ${d.fleet} đã xuất bến và đang di chuyển. Bạn hãy chuẩn bị ra đón xe nhé.`
    });
}

setInterval(pollAlertStation, ALERT_POLL_MS);

// ==========================================
// 9. TÌM KIẾM
// ==========================================
let searchTimer = null;
let searchSeq = 0;

function onSearchInput() {
    const q = $('search-input').value.trim();
    $('btn-clear-search').hidden = !q;
    clearTimeout(searchTimer);
    if (!q) return hideDropdown();
    searchTimer = setTimeout(() => runSearch(q), 250);
}

async function runSearch(q) {
    const seq = ++searchSeq;
    let json;
    try { json = await getJson(`/api/search?q=${encodeURIComponent(q)}`); } catch { return; }
    if (seq !== searchSeq || !json.success) return; // bỏ kết quả cũ

    const routes = json.routes || [];
    const stations = json.stations || [];
    state.searchResults = stations;
    const dd = $('search-dropdown');
    if (!routes.length && !stations.length) {
        dd.innerHTML = `<div class="dd-empty">Không tìm thấy "${esc(q)}"</div>`;
    } else {
        dd.innerHTML =
            (routes.length ? '<div class="dd-header">Tuyến xe</div>' + routes.map(r => `
                <div class="dd-item" data-action="search-route" data-code="${esc(r.code)}">
                    <div class="dd-badge">${esc(r.code)}</div>
                    <div class="dd-info">
                        <div class="dd-name">${esc(r.name)}</div>
                        <div class="dd-desc">${esc(r.frequence || '')} · ${formatCost(r.cost)}</div>
                    </div>
                </div>`).join('') : '') +
            (stations.length ? '<div class="dd-header">Điểm dừng</div>' + stations.map((s, i) => {
                const dir = s.isGo === true ? 'go' : s.isGo === false ? 'ret' : '';
                return `
                <div class="dd-item" data-action="search-station" data-idx="${i}">
                    <div class="dd-info">
                        <div class="dd-name">${esc(s.name)}</div>
                        <div class="dd-desc">${dir ? `<span class="dir-tag ${dir}">${dirLabel(dir)}</span> · ` : ''}Tuyến: ${esc(s.fleetOver || '—')}</div>
                    </div>
                </div>`;
            }).join('') : '');
    }
    dd.hidden = false;
}

function hideDropdown() { $('search-dropdown').hidden = true; }

function clearSearch() {
    $('search-input').value = '';
    $('btn-clear-search').hidden = true;
    hideDropdown();
}

// ==========================================
// 10. DANH SÁCH (SHEET)
// ==========================================
function openSheet(tab) {
    if (tab) switchTab(tab);
    $('sheet').classList.add('open');
    $('sheet').setAttribute('aria-hidden', 'false');
    document.body.classList.add('sheet-open');
    $('sheet-backdrop').hidden = false;
    renderBusList();
}

function closeSheet() {
    $('sheet').classList.remove('open');
    $('sheet').setAttribute('aria-hidden', 'true');
    document.body.classList.remove('sheet-open');
    $('sheet-backdrop').hidden = true;
}

function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + tab));
    if (tab === 'buses') renderBusList();
}

function scrollToStopRow(stationId) {
    const el = stationId && $('stop-row-' + stationId);
    if (el) setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 260);
}

// ==========================================
// 11. VỊ TRÍ NGƯỜI DÙNG
// ==========================================
function startPicking(msg) {
    state.picking = true;
    toast(msg || 'Chạm vào bản đồ để chọn vị trí của bạn', 5000);
}

function locate() {
    if (!navigator.geolocation) return startPicking('Thiết bị không hỗ trợ định vị. Chạm vào bản đồ để chọn vị trí.');
    showLoading(true);
    navigator.geolocation.getCurrentPosition(pos => {
        showLoading(false);
        const { latitude, longitude, accuracy } = pos.coords;
        setUserPosition(latitude, longitude, accuracy);
        if (accuracy > 800) startPicking('Vị trí chưa chính xác. Chạm vào bản đồ để chọn lại.');
    }, () => {
        showLoading(false);
        startPicking('Không lấy được GPS. Chạm vào bản đồ để chọn vị trí của bạn.');
    }, { enableHighAccuracy: true, timeout: 8000 });
}

function setUserPosition(lat, lng, accuracy = 20) {
    const map = state.map;
    if (state.userMarker) map.removeLayer(state.userMarker);
    if (state.userCircle) map.removeLayer(state.userCircle);
    state.userCircle = L.circle([lat, lng], { radius: Math.min(accuracy, 2000), color: '#2563eb', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(map);
    state.userMarker = L.circleMarker([lat, lng], { radius: 8, fillColor: '#2563eb', color: '#fff', weight: 3, fillOpacity: 1 }).addTo(map);
    map.setView([lat, lng], 16);

    // Gợi ý trạm gần nhất của chiều đang xem
    if (!state.route) return;
    let best = null;
    for (const st of state.route[state.dir].stations) {
        const d = Geo.distance(lat, lng, st.lat, st.lng);
        if (!best || d < best.d) best = { st, d };
    }
    if (best && best.d < 1500) toast(`Trạm gần nhất: ${best.st.name} (${fmtDist(best.d)})`, 4000);
}

// ==========================================
// 12. CẬP NHẬT ỨNG DỤNG
// ==========================================
function isNewer(remote, current) {
    const a = String(remote || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    const b = String(current || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
    }
    return false;
}

async function loadLocalVersion() {
    try {
        const v = await getJson('/api/version');
        state.version = v.version || null;
    } catch { /* bỏ qua */ }
    $('app-version').textContent = state.version ? 'v' + state.version : '';
}

async function checkUpdate(manual) {
    let remote = null;
    try {
        const url = localStorage.getItem(KEY.updateUrl) || UPDATE_URL;
        remote = await getJson(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { signal: AbortSignal.timeout?.(5000) });
    } catch { /* mạng lỗi */ }

    if (!remote || !remote.version || !state.version) {
        if (manual) toast('Không kết nối được máy chủ cập nhật');
        return;
    }
    const hasUpdate = isNewer(remote.version, state.version);
    if (!hasUpdate) {
        if (manual) toast(`Bạn đang dùng bản mới nhất (v${state.version})`);
        return;
    }
    $('app-version').textContent = `v${state.version} · có bản v${remote.version}`;
    if (!manual && localStorage.getItem(KEY.dismissedUpdate) === remote.version) return;

    $('update-title').textContent = `Có phiên bản mới v${remote.version}`;
    const log = Array.isArray(remote.changelog) ? remote.changelog : [];
    $('update-body').innerHTML = `
        <p class="muted">Đang dùng v${esc(state.version)}${remote.release_date ? ' · phát hành ' + esc(remote.release_date) : ''}</p>
        ${log.length ? `<ul>${log.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
        <p class="muted" style="margin-top:8px">Trạm đã lưu và tuyến mặc định được giữ nguyên.</p>`;
    $('update-modal').dataset.version = remote.version;
    $('update-modal').hidden = false;
}

async function performUpdate() {
    $('update-modal').hidden = true;
    showLoading(true);
    try {
        // Xoá cache giao diện, giữ cache ô bản đồ
        if ('caches' in window) await Promise.all((await caches.keys()).filter(k => !k.startsWith('tiles')).map(k => caches.delete(k)));
        if ('serviceWorker' in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) await r.update();
    } catch (e) { console.warn('Cache clear error:', e); }
    location.href = location.pathname + '?_v=' + Date.now();
}

// ==========================================
// 13. SỰ KIỆN
// ==========================================
// Về màn hình chính: tuyến mặc định + mở luôn trạm đã lưu đầu tiên (nếu có)
// để vừa mở app là thấy ngay "xe tiếp theo còn mấy phút".
async function goHome() {
    clearSearch();
    closeSheet();
    switchTab('buses');
    await selectRoute(getDefaultRoute());
    if (!state.route) return;
    const fav = getFavs(state.route.code)[0];
    if (!fav) return;
    const dir = fav.direction || resolveStationDir(fav) || 'go';
    const st = state.route[dir].stations.find(s => s.stationId === fav.stationId) || fav;
    selectStation({ ...st, dir });
}

// Hành động trên các phần tử sinh động (dropdown, danh sách, popup, chip)
const actions = {
    'search-route': el => {
        hideDropdown();
        $('search-input').value = `Tuyến ${el.dataset.code}`;
        selectRoute(el.dataset.code);
    },
    'search-station': el => {
        const s = state.searchResults[+el.dataset.idx];
        if (!s) return;
        hideDropdown();
        $('search-input').value = s.name;
        selectStation({ ...s, dir: s.isGo === true ? 'go' : s.isGo === false ? 'ret' : null });
    },
    'select-stop': el => {
        const st = state.route[state.dir].stations[+el.dataset.idx];
        if (!isDesktop()) closeSheet();
        selectStation({ ...st, dir: state.dir });
    },
    'fav-stop': el => toggleFav({ ...state.route[state.dir].stations[+el.dataset.idx], dir: state.dir }),
    'chip': el => {
        const f = currentDirFavs()[+el.dataset.idx];
        if (f) selectStation({ ...f, dir: state.dir });
    },
    'chip-del': el => {
        const f = currentDirFavs()[+el.dataset.idx];
        if (f) toggleFav({ ...f, dir: state.dir });
    },
    'bus': el => focusBus(el.dataset.plate),
    'departure': el => {
        const b = state.buses.get(el.dataset.plate);
        if (!b) return;
        state.map.closePopup();
        openAlertModal('departure', { plate: b.plate, fleet: b.fleet || state.route.code, lat: b.lat, lng: b.lng });
    }
};

document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (el && actions[el.dataset.action]) {
        e.stopPropagation();
        actions[el.dataset.action](el);
        return;
    }
    if (!e.target.closest('#search-dropdown, .search-card')) hideDropdown();
});

document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    hideDropdown();
    closeAlertModal();
    $('update-modal').hidden = true;
    closeSheet();
});

const on = (id, fn) => $(id).addEventListener('click', fn);

$('search-input').addEventListener('input', onSearchInput);
$('search-input').addEventListener('focus', () => { if ($('search-input').value.trim() && $('search-dropdown').innerHTML) $('search-dropdown').hidden = false; });
on('btn-clear-search', () => { clearSearch(); $('search-input').focus(); });
on('btn-home', goHome);

on('btn-dir-go', () => setDirection('go'));
on('btn-dir-ret', () => setDirection('ret'));
on('btn-route-info', () => {
    openSheet('stations');
    scrollToStopRow(state.station?.stationId || currentDirFavs()[0]?.stationId);
});
on('btn-set-default', () => {
    if (!state.route) return;
    localStorage.setItem(KEY.defaultRoute, state.route.code);
    renderDefaultStar();
    toast(`Đã đặt tuyến ${state.route.code} làm mặc định`);
});

on('btn-focus-close', clearStation);
on('btn-focus-fav', () => toggleFav(state.station));
on('btn-focus-bus', () => state.nearestPlate && focusBus(state.nearestPlate));
on('btn-focus-alert', () => {
    if (isAlertingStation(state.station)) stopAlert();
    else openAlertModal('station', state.station);
});

on('btn-locate', locate);
on('btn-open-sheet', () => ($('sheet').classList.contains('open') ? closeSheet() : openSheet()));
on('btn-close-sheet', closeSheet);
on('sheet-backdrop', closeSheet);
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

on('btn-cancel-alert', closeAlertModal);
on('alert-modal', e => { if (e.target.id === 'alert-modal') closeAlertModal(); });
on('btn-activate-alert', activateAlert);
on('btn-test-alert', () => {
    const plate = state.modal?.target?.plate || '29E-12345';
    localStorage.setItem(KEY.ringTested, '1');
    $('btn-test-alert').hidden = true;
    startRingtone(10000);
    vibrate();
    showCall(plate, 'Thử chuông cảnh báo', `Đây là cuộc gọi thử. Xe buýt biển số ${plate} sắp tới, quý khách vui lòng chuẩn bị đón xe.`);
});
on('btn-stop-alert', stopAlert);
on('btn-stop-departure', stopDeparture);

on('btn-call-accept', answerCall);
on('btn-call-decline', endCall);

on('btn-check-update', () => checkUpdate(true));
on('btn-cancel-update', () => {
    localStorage.setItem(KEY.dismissedUpdate, $('update-modal').dataset.version || '');
    $('update-modal').hidden = true;
});
on('btn-confirm-update', performUpdate);

// ==========================================
// 14. KHỞI ĐỘNG
// ==========================================
initMap();
goHome();
loadLocalVersion().then(() => setTimeout(() => checkUpdate(false), 3000));

// Service worker: cache bản đồ/giao diện và cho phép thông báo trên Android.
// Chỉ chạy trên "secure context" (https hoặc localhost).
if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW register failed:', e));
}
