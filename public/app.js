// BUS HANOI PRO - Core Application Logic
// Optimized for modern Android & Desktop (Universal Search, Station Realtime, Proximity Alerts, Manual Location Pick)

let map = null;
let currentRoute = null;
let currentStation = null;
let currentDirection = 'go'; // 'go' or 'ret'
let polylineLayer = null;
let corridorLayer = null;
let arrowMarkersLayer = null;
let stationMarkersLayer = null;
let busMarkersLayer = null;
let userLocationMarker = null;
let userAccuracyCircle = null;

let liveActiveBuses = new Map(); // plate -> bus object with marker, partRemained, etc.
let busSecondTimer = null;
let realtimeInterval = null;
let activeAlert = null;

// Audio Context for Proximity Chime
let audioCtx = null;
function playAlertChime() {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const now = audioCtx.currentTime;
        const osc1 = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(587.33, now);
        osc1.frequency.setValueAtTime(880.00, now + 0.15);

        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.7, now + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

        osc1.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        osc1.start(now);
        osc1.stop(now + 0.9);
    } catch (e) {
        console.warn('Audio play error:', e);
    }
}

// Realistic Telephone Ringtone Generator via Web Audio API
let ringtoneAudioCtx = null;
let ringtoneInterval = null;

function startPhoneRingtone() {
    try {
        if (!ringtoneAudioCtx) {
            ringtoneAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (ringtoneAudioCtx.state === 'suspended') {
            ringtoneAudioCtx.resume();
        }
        stopPhoneRingtone();

        function playBurst() {
            if (!ringtoneAudioCtx) return;
            const now = ringtoneAudioCtx.currentTime;
            const osc1 = ringtoneAudioCtx.createOscillator();
            const osc2 = ringtoneAudioCtx.createOscillator();
            const gain = ringtoneAudioCtx.createGain();

            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(440, now);
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(480, now);

            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.35, now + 0.05);
            gain.gain.setValueAtTime(0.35, now + 1.6);
            gain.gain.linearRampToValueAtTime(0.001, now + 1.8);

            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(ringtoneAudioCtx.destination);

            osc1.start(now);
            osc2.start(now);
            osc1.stop(now + 1.8);
            osc2.stop(now + 1.8);
        }

        playBurst();
        ringtoneInterval = setInterval(playBurst, 2800);
    } catch (e) {
        console.warn('Ringtone error:', e);
    }
}

function stopPhoneRingtone() {
    if (ringtoneInterval) {
        clearInterval(ringtoneInterval);
        ringtoneInterval = null;
    }
}

// Vietnamese Text-To-Speech
function speakVietnamese(text) {
    if (!('speechSynthesis' in window)) return;
    try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'vi-VN';
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        const voices = window.speechSynthesis.getVoices();
        const viVoice = voices.find(v => v.lang.includes('vi') || v.lang.includes('VN'));
        if (viVoice) utterance.voice = viVoice;

        window.speechSynthesis.speak(utterance);
    } catch (e) {
        console.warn('Speech error:', e);
    }
}

function triggerVibration() {
    if ('vibrate' in navigator) {
        try {
            navigator.vibrate([500, 200, 500, 200, 500]);
        } catch (e) {
            console.warn('Vibration error:', e);
        }
    }
}

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// DOM Elements
const searchInput = document.getElementById('route-search-input');
const clearSearchBtn = document.getElementById('clear-search-btn');
const searchDropdown = document.getElementById('search-dropdown');
const activeRouteBar = document.getElementById('active-route-bar');
const routeCodeBadge = document.getElementById('route-code-badge');
const routeTitle = document.getElementById('route-title');
const routeMeta = document.getElementById('route-meta');
const directionSwitchBox = document.getElementById('direction-switch-box');
const btnDirGo = document.getElementById('btn-dir-go');
const btnDirRet = document.getElementById('btn-dir-ret');
const btnSetDefault = document.getElementById('btn-set-default');
const routeBadgeBox = document.getElementById('route-badge-box');
const routeExpandHint = document.getElementById('route-expand-hint');
const savedStationsBar = document.getElementById('saved-stations-bar');
const savedStationsList = document.getElementById('saved-stations-list');

// Collapsible Top Controls Toggle
const btnToggleTopControls = document.getElementById('btn-toggle-top-controls');
const toggleTopIcon = document.getElementById('toggle-top-icon');
const toggleTopText = document.getElementById('toggle-top-text');

const alertBanner = document.getElementById('alert-banner');
const alertBannerStation = document.getElementById('alert-banner-station');
const alertBannerStatus = document.getElementById('alert-banner-status');
const btnStopAlert = document.getElementById('btn-stop-alert');

// Departure Alert Elements
const departureBanner = document.getElementById('departure-banner');
const departureBannerTitle = document.getElementById('departure-banner-title');
const departureBannerStatus = document.getElementById('departure-banner-status');
const btnStopDeparture = document.getElementById('btn-stop-departure');

const departureModal = document.getElementById('departure-modal');
const modalDepartureCloseBtn = document.getElementById('modal-departure-close-btn');
const btnCancelDepartureModal = document.getElementById('btn-cancel-departure-modal');
const btnActivateDeparture = document.getElementById('btn-activate-departure');
const depModalPlate = document.getElementById('dep-modal-plate');
const depModalStatus = document.getElementById('dep-modal-status');
const chkDepCall = document.getElementById('chk-dep-call');
const chkDepSound = document.getElementById('chk-dep-sound');
const chkDepVibrate = document.getElementById('chk-dep-vibrate');
const chkDepNotify = document.getElementById('chk-dep-notify');
const btnTestDepCall = document.getElementById('btn-test-dep-call');

// Simulated Incoming Call Overlay Elements
const incomingCallOverlay = document.getElementById('incoming-call-overlay');
const callCallerName = document.getElementById('call-caller-name');
const callCallerSub = document.getElementById('call-caller-sub');
const callStatusLabel = document.getElementById('call-status-label');
const callTimer = document.getElementById('call-timer');
const callRingingActions = document.getElementById('call-ringing-actions');
const callActiveActions = document.getElementById('call-active-actions');
const btnAcceptCall = document.getElementById('btn-accept-call');
const btnDeclineCall = document.getElementById('btn-decline-call');
const btnHangupCall = document.getElementById('btn-hangup-call');

const locationHintToast = document.getElementById('location-hint-toast');
const btnCloseToast = document.getElementById('btn-close-toast');

const bottomSheet = document.getElementById('bottom-sheet');
const sheetHandle = document.getElementById('sheet-handle');
const sheetTabs = document.querySelectorAll('.sheet-tab');
const tabBuses = document.getElementById('tab-buses');
const tabStations = document.getElementById('tab-stations');
const tabInfo = document.getElementById('tab-info');
const tabBtnStations = document.getElementById('tab-btn-stations');
const tabBtnInfo = document.getElementById('tab-btn-info');
const realtimeBusList = document.getElementById('realtime-bus-list');
const stationList = document.getElementById('station-list');
const routeDetailsInfo = document.getElementById('route-details-info');
const busCountSpan = document.getElementById('bus-count');
const stationCountSpan = document.getElementById('station-count');
const loadingSpinner = document.getElementById('loading-spinner');

// Alert Modal Elements
const alertModal = document.getElementById('alert-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const btnCancelModal = document.getElementById('btn-cancel-modal');
const btnActivateAlert = document.getElementById('btn-activate-alert');
const modalRouteName = document.getElementById('modal-route-name');
const modalStationName = document.getElementById('modal-station-name');
const alertDistanceSelect = document.getElementById('alert-distance-select');
const chkCall = document.getElementById('chk-call');
const chkSound = document.getElementById('chk-sound');
const chkVibrate = document.getElementById('chk-vibrate');
const chkNotification = document.getElementById('chk-notification');
const btnTestAlertSound = document.getElementById('btn-test-alert-sound');

let pendingAlert = null;
let searchDebounce = null;

// Initialize Map
function initMap() {
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([21.028511, 105.854167], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        subdomains: ['a', 'b', 'c']
    }).addTo(map);

    stationMarkersLayer = L.layerGroup().addTo(map);
    arrowMarkersLayer = L.layerGroup().addTo(map);
    busMarkersLayer = L.layerGroup().addTo(map);

    // Click map to pick manual location (Chỉ kích hoạt khi người dùng bấm nút Chọn vị trí thủ công)
    map.on('click', (e) => {
        if (isPickingLocationMode) {
            handleManualLocationPick(e.latlng.lat, e.latlng.lng);
            isPickingLocationMode = false;
        }
    });
}

// Universal Search (Routes + Stations)
searchInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    clearSearchBtn.style.display = val ? 'flex' : 'none';

    if (!val) {
        searchDropdown.style.display = 'none';
        return;
    }

    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
        executeSearch(val);
    }, 250);
});

async function executeSearch(query) {
    try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const json = await res.json();
        if (!json.success) return;

        const routes = json.routes || [];
        const stations = json.stations || [];

        if (routes.length === 0 && stations.length === 0) {
            searchDropdown.innerHTML = `<div class="empty-hint" style="padding: 16px;">Không tìm thấy tuyến hoặc điểm dừng nào với từ khóa "${query}"</div>`;
            searchDropdown.style.display = 'block';
            return;
        }

        let html = '';

        // 1. Phân nhóm Tuyến xe buýt
        if (routes.length > 0) {
            html += `<div class="dropdown-header">🚌 TUYẾN XE BUÝT (${routes.length})</div>`;
            html += routes.map(r => `
                <div class="dropdown-item" data-type="route" data-code="${r.code}">
                    <div class="dropdown-badge">${r.code}</div>
                    <div class="dropdown-info">
                        <div class="dropdown-name">${r.name}</div>
                        <div class="dropdown-desc">${r.frequence || ''} • Giá vé: ${r.cost ? Number(r.cost).toLocaleString('vi-VN') : 7000}đ</div>
                    </div>
                </div>
            `).join('');
        }

        // 2. Phân nhóm Điểm dừng / Trạm xe buýt (Phân biệt rõ Chiều đi và Chiều về)
        if (stations.length > 0) {
            const currentRouteCode = currentRoute ? currentRoute.code : '83';
            const curFavList = getSavedFavStations(currentRouteCode);

            html += `<div class="dropdown-header">🚏 ĐIỂM DỪNG / TRẠM BUÝT (${stations.length})</div>`;
            html += stations.map(s => {
                const isGo = s.isGo === true;
                const isRet = s.isGo === false;
                const badgeClass = isGo ? 'badge-go' : (isRet ? 'badge-ret' : '');
                const badgeText = isGo ? 'Chiều đi' : (isRet ? 'Chiều về' : 'Trạm');
                const pillClass = isGo ? 'pill-go' : (isRet ? 'pill-ret' : '');
                const pillText = s.directionText || (isGo ? 'Chiều đi' : (isRet ? 'Chiều về' : ''));
                const dirVal = isGo ? 'go' : (isRet ? 'ret' : (currentDirection || 'go'));

                const isFav = curFavList.some(fav => fav.stationId === s.stationId && (fav.direction ? fav.direction === dirVal : true));

                return `
                <div class="dropdown-item" data-type="station" data-id="${s.stationId}" data-name="${encodeURIComponent(s.name)}" data-lat="${s.lat}" data-lng="${s.lng}" data-fleet="${encodeURIComponent(s.fleetOver || '')}" data-dir="${dirVal}">
                    <div class="dropdown-badge station-badge ${badgeClass}">${badgeText}</div>
                    <div class="dropdown-info">
                        <div class="dropdown-name">
                            ${s.name}
                            ${pillText ? `<span class="dir-pill ${pillClass}">${pillText}</span>` : ''}
                        </div>
                        <div class="dropdown-desc">Tuyến đi qua: <b>${s.fleetOver || 'Nhiều tuyến'}</b> ${s.address ? '• ' + s.address : ''}</div>
                    </div>
                    <button class="dropdown-fav-btn ${isFav ? 'is-fav' : ''}" 
                            onclick="event.stopPropagation(); toggleFavFromSearch(${s.stationId}, '${s.name.replace(/'/g, "\\'")}', ${s.lat}, ${s.lng}, '${dirVal}', this)" 
                            title="${isFav ? 'Bỏ ghim điểm dừng này' : 'Ghim điểm dừng này'}">
                        ${isFav ? '★' : '☆'}
                    </button>
                </div>
                `;
            }).join('');
        }

        searchDropdown.innerHTML = html;
        searchDropdown.style.display = 'block';

    } catch (e) {
        console.error('Search error:', e);
    }
}

// Helper: Ghim / Bỏ ghim nhanh từ kết quả tìm kiếm (hiển thị ngôi sao vàng)
window.toggleFavFromSearch = function(stationId, stationName, lat, lng, direction, btnEl) {
    const routeCode = currentRoute ? currentRoute.code : '83';
    let favList = getSavedFavStations(routeCode);

    const existingIdx = favList.findIndex(s => s.stationId === stationId && (s.direction ? s.direction === direction : true));
    if (existingIdx !== -1) {
        favList.splice(existingIdx, 1);
        if (btnEl) {
            btnEl.classList.remove('is-fav');
            btnEl.innerText = '☆';
            btnEl.title = 'Ghim điểm dừng này';
        }
    } else {
        favList.push({
            stationId,
            name: stationName,
            lat,
            lng,
            direction: direction
        });
        if (btnEl) {
            btnEl.classList.add('is-fav');
            btnEl.innerText = '★';
            btnEl.title = 'Bỏ ghim điểm dừng này';
        }
    }

    saveFavStations(routeCode, favList);
    renderCurrentDirection();
    updateSavedStationsBar();
};

clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearSearchBtn.style.display = 'none';
    searchDropdown.style.display = 'none';
    searchInput.focus();
});

// Dropdown click handler
searchDropdown.addEventListener('click', (e) => {
    // Nếu bấm vào nút ngôi sao thì không chọn trạm
    if (e.target.closest('.dropdown-fav-btn')) return;

    const item = e.target.closest('.dropdown-item');
    if (!item) return;

    const type = item.getAttribute('data-type');
    searchDropdown.style.display = 'none';

    if (type === 'route') {
        const code = item.getAttribute('data-code');
        searchInput.value = `Tuyến ${code}`;
        selectRoute(code);
    } else if (type === 'station') {
        const stationId = parseInt(item.getAttribute('data-id'), 10);
        const name = decodeURIComponent(item.getAttribute('data-name'));
        const lat = parseFloat(item.getAttribute('data-lat'));
        const lng = parseFloat(item.getAttribute('data-lng'));
        const fleetOver = decodeURIComponent(item.getAttribute('data-fleet'));
        const dir = item.getAttribute('data-dir');

        searchInput.value = name;
        selectStation({ stationId, name, lat, lng, fleetOver, direction: dir });
    }
});

// ==========================================
// 1. SELECT & DISPLAY A BUS ROUTE
// ==========================================
async function selectRoute(code) {
    showLoading(true, `Đang tải tuyến ${code}...`);
    currentStation = null;

    try {
        const res = await fetch(`/api/route/${encodeURIComponent(code)}`);
        const json = await res.json();
        showLoading(false);

        if (!json.success) {
            alert('Không tìm thấy thông tin tuyến ' + code);
            return;
        }

        currentRoute = json.data;
        currentDirection = 'go';

        // Clear previous buses from memory & map
        liveActiveBuses.forEach(b => { if (b.marker) busMarkersLayer.removeLayer(b.marker); });
        liveActiveBuses.clear();
        busMarkersLayer.clearLayers();

        // Update Top Active Bar
        activeRouteBar.style.display = 'flex';
        directionSwitchBox.style.display = 'flex';
        tabBtnStations.style.display = 'block';
        tabBtnInfo.style.display = 'block';

        const totalStations = (currentRoute.go.stations || []).length;
        routeCodeBadge.innerText = currentRoute.code;
        routeTitle.innerText = currentRoute.name;
        if (routeExpandHint) {
            routeExpandHint.innerText = `🚏 ${totalStations} điểm dừng ▼`;
        }
        routeMeta.innerText = `${currentRoute.frequence || '15-20 phút/chuyến'} • Giá vé: ${formatCost(currentRoute.cost)}`;

        btnDirGo.classList.add('active');
        btnDirRet.classList.remove('active');

        // Update Default Route Button State & Saved Stations Bar
        updateDefaultRouteButtonState();
        updateSavedStationsBar();

        // Render map & UI
        renderCurrentDirection();

        // Start Realtime Tracking Polling for route
        startRealtimeTracking('route');

        // Mặc định ban đầu KHÔNG mở rộng bottom sheet để người dùng nhìn trọn bản đồ
        bottomSheet.classList.add('collapsed');
        bottomSheet.classList.remove('expanded');

    } catch (e) {
        showLoading(false);
        console.error('Error selecting route:', e);
        alert('Lỗi tải dữ liệu: ' + e.message);
    }
}

// Cost Formatter (Tránh lỗi hiển thị NaNđ)
function formatCost(cost) {
    if (!cost) return '7.000đ';
    const digits = String(cost).replace(/[^0-9]/g, '');
    const num = parseInt(digits, 10);
    if (!num || isNaN(num) || num === 0) return '9.000đ';
    return Number(num).toLocaleString('vi-VN') + 'đ';
}

// Default Route Persistence
function updateDefaultRouteButtonState() {
    if (!btnSetDefault) return;
    if (!currentRoute) {
        btnSetDefault.style.display = 'none';
        return;
    }
    btnSetDefault.style.display = 'flex';
    const defaultRoute = localStorage.getItem('bus_hanoi_default_route') || '83';
    if (String(currentRoute.code).trim() === String(defaultRoute).trim()) {
        btnSetDefault.classList.add('is-default');
        btnSetDefault.innerHTML = '★ Tuyến mặc định';
        btnSetDefault.title = 'Tuyến này đã được đặt làm mặc định khi mở app';
    } else {
        btnSetDefault.classList.remove('is-default');
        btnSetDefault.innerHTML = '☆ Đặt làm mặc định';
        btnSetDefault.title = `Bấm để đặt Tuyến ${currentRoute.code} làm tuyến mặc định khi mở app`;
    }
}

if (btnSetDefault) {
    btnSetDefault.addEventListener('click', () => {
        if (!currentRoute) return;
        localStorage.setItem('bus_hanoi_default_route', currentRoute.code);
        updateDefaultRouteButtonState();
        alert(`⭐ Đã đặt Tuyến ${currentRoute.code} làm tuyến mặc định!\nLần sau khi mở app, hệ thống sẽ tự động hiển thị Tuyến ${currentRoute.code}.`);
    });
}

// Event Listener: Thu gọn / Hiện thanh tìm kiếm & thông tin tuyến để mở rộng bản đồ
if (btnToggleTopControls) {
    btnToggleTopControls.addEventListener('click', () => {
        const isCollapsed = document.body.classList.toggle('top-controls-collapsed');
        btnToggleTopControls.classList.toggle('is-collapsed', isCollapsed);
        if (toggleTopIcon) toggleTopIcon.innerText = isCollapsed ? '▼' : '▲';
        if (toggleTopText) toggleTopText.innerText = isCollapsed ? 'Hiện tuyến' : 'Thu gọn';
    });
}

// Multiple Saved Stations Management per Route
function getSavedFavStations(routeCode) {
    if (!routeCode) return [];
    try {
        const raw = localStorage.getItem('bus_fav_stations_' + String(routeCode).trim());
        if (!raw) {
            // Tương thích ngược với key cũ đơn điểm nếu có
            const oldSingle = localStorage.getItem('bus_fav_station_' + String(routeCode).trim());
            if (oldSingle) {
                const parsed = JSON.parse(oldSingle);
                return parsed ? [parsed] : [];
            }
            return [];
        }
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function saveFavStations(routeCode, stationsList) {
    if (!routeCode) return;
    localStorage.setItem('bus_fav_stations_' + String(routeCode).trim(), JSON.stringify(stationsList));
}

window.toggleFavStation = function(stationId, stationName, lat, lng) {
    if (!currentRoute) return;
    const routeCode = currentRoute.code;
    let favList = getSavedFavStations(routeCode);

    const existingIdx = favList.findIndex(s => s.stationId === stationId && (s.direction ? s.direction === currentDirection : true));
    if (existingIdx !== -1) {
        favList.splice(existingIdx, 1);
    } else {
        favList.push({
            stationId,
            name: stationName,
            lat,
            lng,
            direction: currentDirection
        });
    }

    saveFavStations(routeCode, favList);
    renderCurrentDirection();
    updateSavedStationsBar();
};

window.removeFavStation = function(stationId) {
    if (!currentRoute) return;
    const routeCode = currentRoute.code;
    let favList = getSavedFavStations(routeCode);
    favList = favList.filter(s => !(s.stationId === stationId && (s.direction ? s.direction === currentDirection : true)));
    saveFavStations(routeCode, favList);
    renderCurrentDirection();
    updateSavedStationsBar();
};

window.panToSavedStation = function(stationId, lat, lng) {
    panToStation(lat, lng);
    switchTab('tab-stations');
    bottomSheet.classList.remove('collapsed');
    bottomSheet.classList.add('expanded');

    setTimeout(() => {
        const el = document.getElementById(`station-item-${stationId}`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('highlight-target');
            setTimeout(() => el.classList.remove('highlight-target'), 2500);
        }
    }, 300);
};

function updateSavedStationsBar() {
    if (!savedStationsBar || !savedStationsList) return;
    if (!currentRoute) {
        savedStationsBar.style.display = 'none';
        return;
    }

    const allFavList = getSavedFavStations(currentRoute.code);
    if (!allFavList || allFavList.length === 0) {
        savedStationsBar.style.display = 'none';
        return;
    }

    // Lấy danh sách trạm thuộc chiều hiện tại
    const curStations = (currentDirection === 'go' ? currentRoute.go.stations : currentRoute.ret.stations) || [];
    const curStationIds = new Set(curStations.map(s => s.stationId));

    const otherStations = (currentDirection === 'go' ? currentRoute.ret.stations : currentRoute.go.stations) || [];
    const otherStationIds = new Set(otherStations.map(s => s.stationId));

    // LỌC CHUẨN XÁC: Chiều đi chỉ hiện điểm ở chiều đi, Chiều về chỉ hiện điểm ở chiều về
    const dirFavList = allFavList.filter(s => {
        if (s.direction) {
            return s.direction === currentDirection;
        }
        if (curStationIds.has(s.stationId)) {
            return true;
        }
        if (otherStationIds.has(s.stationId)) {
            return false;
        }
        return false;
    });

    if (dirFavList.length === 0) {
        savedStationsBar.style.display = 'none';
        return;
    }

    const isGo = currentDirection === 'go';
    const dirLabel = isGo ? 'Chiều đi' : 'Chiều về';
    const dirChipClass = isGo ? 'chip-dir-go' : 'chip-dir-ret';

    const headerTitle = document.getElementById('saved-title-text');
    if (headerTitle) {
        headerTitle.innerText = `Đã lưu (${dirLabel}):`;
    }

    savedStationsList.innerHTML = dirFavList.map(s => {
        const cleanName = s.name.replace(/^[0-9A-Z\(\)\s,-]+ - /, '') || s.name;
        return `
            <div class="saved-station-chip ${dirChipClass}" onclick="panToSavedStation(${s.stationId}, ${s.lat}, ${s.lng})" title="Bấm để xem trạm ${s.name} (${dirLabel})">
                <span class="chip-name">⭐ ${cleanName}</span>
                <button class="chip-del-btn" onclick="event.stopPropagation(); removeFavStation(${s.stationId})" title="Bỏ lưu trạm này">✕</button>
            </div>
        `;
    }).join('');

    savedStationsBar.style.display = 'flex';
}

// Click on Route Title / Badge -> Automatically Open Stations List Tab
if (routeBadgeBox) {
    routeBadgeBox.addEventListener('click', () => {
        if (!currentRoute) return;
        // Xổ ngay danh sách các điểm dừng ở Bottom Sheet
        switchTab('tab-stations');
        bottomSheet.classList.remove('collapsed');
        bottomSheet.classList.add('expanded');

        // Nếu người dùng đã lưu trạm hay đi, cuộn mượt tới trạm đầu tiên đã lưu của chiều hiện tại
        const curStations = (currentDirection === 'go' ? currentRoute.go.stations : currentRoute.ret.stations) || [];
        const curStationIds = new Set(curStations.map(s => s.stationId));
        const allFav = getSavedFavStations(currentRoute.code);
        const curFav = allFav.filter(s => (s.direction ? s.direction === currentDirection : curStationIds.has(s.stationId)));

        if (curFav && curFav.length > 0) {
            const firstFav = curFav[0];
            setTimeout(() => {
                const el = document.getElementById(`station-item-${firstFav.stationId}`);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.classList.add('highlight-target');
                    setTimeout(() => el.classList.remove('highlight-target'), 2500);
                }
            }, 300);
        }
    });
}

// Direction Switch Buttons
btnDirGo.addEventListener('click', () => {
    if (currentDirection === 'go') return;
    currentDirection = 'go';
    btnDirGo.classList.add('active');
    btnDirRet.classList.remove('active');
    renderCurrentDirection();
    updateSavedStationsBar();
    fetchRealtimeBuses();
});

btnDirRet.addEventListener('click', () => {
    if (currentDirection === 'ret') return;
    currentDirection = 'ret';
    btnDirRet.classList.add('active');
    btnDirGo.classList.remove('active');
    renderCurrentDirection();
    updateSavedStationsBar();
    fetchRealtimeBuses();
});

// Helper: Calculate distance in meters between two coordinates
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Helper: Find closest point index in path polyline
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

// Helper: Interpolate exact position backwards along route path
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

// Helper: Calculate bearing angle between two coords
function calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
    const brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
}

// Helper: Update Popup Content for live bus
function updateBusPopup(marker, b) {
    const rawPlate = String(b.plate || '').trim();
    const isGo = b.isGo !== false;
    const dirTag = isGo ? '➜ Chiều đi' : '⬅ Chiều về';
    const dirColor = isGo ? '#0284c7' : '#ea580c';
    const dirBg = isGo ? '#e0f2fe' : '#ffedd5';

    marker.setPopupContent(`
        <div style="font-family: inherit; font-size: 13.5px; min-width: 215px;">
            <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
                <span style="font-weight: 800; font-size: 16px; color: #0f172a;">🚌 ${rawPlate}</span>
                <span style="background: ${dirBg}; color: ${dirColor}; font-size: 11.5px; font-weight: 800; padding: 2px 7px; border-radius: 6px;">${dirTag}</span>
            </div>
            <div style="margin-top: 6px; color: #475569; font-size: 12.5px;">Hướng đi: <b style="color: #0f172a;">${b.directionText || b.fleetCode || 'Đang lưu thông'}</b></div>
            <div style="margin-top: 3px; color: #475569; font-size: 12.5px;">Trạm sắp tới: <b style="color: #0f172a;">${b.nextStation || 'Dọc tuyến'}</b></div>
            <div style="margin-top: 8px; padding: 6px 10px; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; font-weight: 700; color: #ea580c; display: flex; justify-content: space-between;">
                <span>Cách: ${b.partRemained >= 1000 ? (b.partRemained/1000).toFixed(1) + ' km' : Math.round(b.partRemained || 0) + ' m'}</span>
                <span>còn ~${Math.max(1, Math.round((b.timeRemained || 0)/60))} phút</span>
            </div>
            <button onclick="openDepartureModal('${rawPlate}', '${b.fleet || (currentRoute ? currentRoute.code : '')}', '${(b.nextStation || '').replace(/'/g, "\\'")}', ${b.partRemained || 0}, ${b.lat}, ${b.lng})" 
                    style="width: 100%; margin-top: 8px; background: #2563eb; color: #fff; border: none; padding: 7px 10px; border-radius: 6px; font-weight: 700; font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;">
                🚀 Canh xe này khi xuất bến
            </button>
        </div>
    `);
}

// Helper: Vector SVG Bus Icon for authentic vehicle representation
function getBusSvgIcon(color = 'currentColor', size = 16) {
    return `<svg class="bus-badge-svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="${color}" style="vertical-align: middle; display: inline-block;">
        <path d="M4 16c0 .55.45 1 1 1h1v1.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V17h6v1.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V17h1c.55 0 1-.45 1-1V6c0-1.66-1.34-3-3-3H7C5.34 3 4 4.34 4 6v10zm2-10h12v4H6V6zm1.5 7.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm9 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/>
    </svg>`;
}

// Helper: Create authentic Bus Marker Pill (Chuẩn giao diện App gốc Tìm Buýt có phân biệt chiều đi/về)
function createBusMarker(b) {
    const rawPlate = String(b.plate || '').trim();
    const numMatch = rawPlate.match(/[0-9]{4,5}$/);
    const plateNum = numMatch ? numMatch[0] : (rawPlate.replace(/[^0-9]/g, '').slice(-5) || rawPlate);
    const isGo = b.isGo !== false;
    const dirClass = isGo ? 'bus-dir-go' : 'bus-dir-ret';
    const dirTag = isGo ? '➜ Đi' : '⬅ Về';
    const busSvgColor = isGo ? '#38bdf8' : '#fb923c';

    const iconHtml = `
        <div class="bus-marker-badge ${dirClass}" title="${rawPlate} (${b.directionText || b.fleetCode || ''})">
            <span class="bus-icon-graphic">${getBusSvgIcon(busSvgColor, 16)}</span>
            <span class="bus-status-dot"></span>
            <span class="bus-plate-num">${plateNum}</span>
            <span class="bus-dir-tag">${dirTag}</span>
        </div>
    `;

    const busIcon = L.divIcon({
        className: 'bus-smooth-marker',
        html: iconHtml,
        iconSize: [115, 30],
        iconAnchor: [57, 15]
    });

    const m = L.marker([b.lat, b.lng], { icon: busIcon, zIndexOffset: 2500 });
    m.on('click', (e) => {
        if (e && e.originalEvent) {
            e.originalEvent.stopPropagation();
        }
        L.DomEvent.stopPropagation(e);
        m.openPopup();
    });
    updateBusPopup(m, b);
    return m;
}

// Render Polyline & Stations for current direction
function renderCurrentDirection() {
    if (!currentRoute) return;

    const dirData = currentDirection === 'go' ? currentRoute.go : currentRoute.ret;
    const path = dirData ? (dirData.path || []) : [];
    const stations = dirData ? (dirData.stations || []) : [];

    if (corridorLayer) {
        map.removeLayer(corridorLayer);
        corridorLayer = null;
    }
    if (polylineLayer) {
        map.removeLayer(polylineLayer);
        polylineLayer = null;
    }
    if (arrowMarkersLayer) {
        arrowMarkersLayer.clearLayers();
    }

    const isGo = currentDirection === 'go';
    // Làn đường corridor màu hồng đào/salmon y hệt app gốc
    const corridorColor = isGo ? '#93c5fd' : '#fca5a5';
    const roadColor = isGo ? '#2563eb' : '#ea580c';

    if (path.length > 0) {
        // 1. Dải hành lang làn đường (Road Ribbon)
        corridorLayer = L.polyline(path, {
            color: corridorColor,
            weight: 14,
            opacity: 0.55,
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(map);

        // 2. Vạch tim đường xe chạy chính
        polylineLayer = L.polyline(path, {
            color: roadColor,
            weight: 4.5,
            opacity: 0.95,
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(map);

        // 3. Mũi tên chỉ hướng di chuyển dọc làn đường (↓ / ↑)
        const step = Math.max(3, Math.floor(path.length / 14));
        for (let i = 1; i < path.length; i += step) {
            const p1 = path[i - 1];
            const p2 = path[i];
            const arrowAngle = calculateBearing(p1[0], p1[1], p2[0], p2[1]);
            const arrowIcon = L.divIcon({
                className: '',
                html: `<div class="road-arrow-marker" style="transform: rotate(${arrowAngle - 90}deg); color: ${roadColor};">➤</div>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            });
            arrowMarkersLayer.addLayer(L.marker([p2[0], p2[1]], { icon: arrowIcon, interactive: false }));
        }

        map.fitBounds(polylineLayer.getBounds(), { padding: [60, 60] });
    }

    // Draw Stations (Biển trạm buýt xanh chuẩn app gốc)
    stationMarkersLayer.clearLayers();
    stations.forEach((st, idx) => {
        if (!st.lat || !st.lng) return;

        const displayName = (st.name || '').replace(/^[0-9A-Z\(\)\s,-]+ - /, '') || st.name || 'Điểm dừng';
        const isStart = idx === 0;
        const isEnd = idx === stations.length - 1;

        const stationIcon = L.divIcon({
            className: 'station-marker-pin',
            html: `
                <div class="station-pin-icon" style="${isStart ? 'background:#16a34a;' : (isEnd ? 'background:#dc2626;' : '')}" title="${st.name}">
                    🚏
                </div>
                <div class="station-pin-label">${displayName}</div>
            `,
            iconSize: [120, 48],
            iconAnchor: [60, 11]
        });

        const m = L.marker([st.lat, st.lng], { icon: stationIcon });
        m.bindPopup(`
            <div style="font-family: inherit; min-width: 190px;">
                <div style="font-size: 11px; font-weight: 700; color: #64748b;">Trạm số ${st.order || (idx + 1)}</div>
                <div style="font-size: 14.5px; font-weight: 800; color: #0f172a; margin-top: 2px;">${st.name || 'Điểm dừng xe buýt'}</div>
                <div style="font-size: 12px; color: #475569; margin: 4px 0;">${st.address || ''}</div>
                <button onclick="openAlertModalForStation(${st.stationId}, '${(st.name || st.address || '').replace(/'/g, "\\'")}', '${currentRoute.code}', ${st.lat}, ${st.lng})" 
                        style="width: 100%; margin-top: 8px; background: #ea580c; color: #fff; border: none; padding: 7px 10px; border-radius: 6px; font-weight: 700; font-size: 12.5px; cursor: pointer;">
                    🔔 Đặt cảnh báo xe đến đây
                </button>
            </div>
        `);
        stationMarkersLayer.addLayer(m);
    });

    // Render Stations Tab (Hỗ trợ lưu nhiều điểm dừng)
    const favList = getSavedFavStations(currentRoute.code);
    stationCountSpan.innerText = stations.length;
    stationList.innerHTML = stations.map((st, idx) => {
        const isFav = favList.some(s => s.stationId === st.stationId && (s.direction ? s.direction === currentDirection : true));
        return `
        <div id="station-item-${st.stationId}" class="station-item ${isFav ? 'is-fav' : ''}" onclick="panToStation(${st.lat}, ${st.lng})">
            <div class="station-order">${st.order || (idx + 1)}</div>
            <div class="station-info">
                <div class="station-name">
                    ${st.name || 'Trạm xe buýt'}
                    ${isFav ? '<span style="color:#ca8a04; font-size:11px; margin-left:4px; font-weight:800;">(★ Trạm đã lưu)</span>' : ''}
                </div>
                <div class="station-address">${st.address || ''}</div>
            </div>
            <button class="btn-fav-station ${isFav ? 'is-fav' : ''}" onclick="event.stopPropagation(); toggleFavStation(${st.stationId}, '${(st.name || st.address || '').replace(/'/g, "\\'")}', ${st.lat}, ${st.lng})" title="${isFav ? 'Bỏ lưu trạm này' : 'Lưu làm điểm dừng hay đón xe'}">
                ${isFav ? '★' : '☆'}
            </button>
            <button class="btn-station-alert" onclick="event.stopPropagation(); openAlertModalForStation(${st.stationId}, '${(st.name || st.address || '').replace(/'/g, "\\'")}', '${currentRoute.code}', ${st.lat}, ${st.lng})">
                🔔 Báo xe
            </button>
        </div>
        `;
    }).join('');

    // Render Info Tab
    routeDetailsInfo.innerHTML = `
        <div class="info-card">
            <div class="info-row">
                <span class="info-label">Tuyến số:</span>
                <span class="info-value">Tuyến ${currentRoute.code}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Tần suất:</span>
                <span class="info-value">${currentRoute.frequence || 'Đang cập nhật'}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Giá vé:</span>
                <span class="info-value">${formatCost(currentRoute.cost)}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Giờ hoạt động:</span>
                <span class="info-value">${currentRoute.operationsTime || '05:00 - 21:00'}</span>
            </div>
        </div>
        <div class="info-card info-desc-box">
            <h4>Lộ trình Chiều đi:</h4>
            <p>${currentRoute.trajectoryGo || 'Đang cập nhật'}</p>
            <h4 style="margin-top: 10px;">Lộ trình Chiều về:</h4>
            <p>${currentRoute.trajectoryReturn || 'Đang cập nhật'}</p>
        </div>
    `;
}

// ==========================================
// 2. SELECT & DISPLAY A SPECIFIC STATION (ĐIỂM DỪNG)
// ==========================================
async function selectStation(st) {
    currentStation = st;

    // 1. Giữ nguyên hoặc nạp tuyến xe để LUÔN hiển thị highlight lộ trình và các xe đang chạy
    let targetRouteCode = currentRoute ? currentRoute.code : '83';
    if (!currentRoute) {
        if (st.fleetOver) {
            const fleets = st.fleetOver.split(',').map(f => f.trim()).filter(Boolean);
            if (fleets.length > 0) targetRouteCode = fleets[0];
        }
        await selectRoute(targetRouteCode);
    }

    // 2. Tự động đồng bộ chiều đi / chiều về tương ứng với điểm dừng vừa chọn
    if (currentRoute) {
        const inGo = currentRoute.go && currentRoute.go.stations && currentRoute.go.stations.some(s => s.stationId === st.stationId);
        const inRet = currentRoute.ret && currentRoute.ret.stations && currentRoute.ret.stations.some(s => s.stationId === st.stationId);

        if (st.direction === 'ret' || (inRet && !inGo)) {
            if (currentDirection !== 'ret') {
                currentDirection = 'ret';
                btnDirRet.classList.add('active');
                btnDirGo.classList.remove('active');
                renderCurrentDirection();
                updateSavedStationsBar();
            }
        } else if (st.direction === 'go' || inGo) {
            if (currentDirection !== 'go') {
                currentDirection = 'go';
                btnDirGo.classList.add('active');
                btnDirRet.classList.remove('active');
                renderCurrentDirection();
                updateSavedStationsBar();
            }
        }
    }

    // 3. Pan bản đồ tới điểm dừng và mở popup trạm
    if (st.lat && st.lng) {
        map.setView([st.lat, st.lng], 16, { animate: true });

        setTimeout(() => {
            const allStationMarkers = stationMarkersLayer.getLayers();
            let found = false;
            for (const sm of allStationMarkers) {
                if (sm.getLatLng && Math.abs(sm.getLatLng().lat - st.lat) < 0.0001 && Math.abs(sm.getLatLng().lng - st.lng) < 0.0001) {
                    sm.openPopup();
                    found = true;
                    break;
                }
            }
            if (!found) {
                const stationIcon = L.divIcon({
                    className: 'station-marker-pin',
                    html: `
                        <div class="station-pin-icon" style="background: #0066cc; width: 28px; height: 28px; font-size: 16px;" title="${st.name}">🚏</div>
                        <div class="station-pin-label" style="font-size: 12.5px; font-weight: 800; max-width: 170px;">${st.name}</div>
                    `,
                    iconSize: [170, 52],
                    iconAnchor: [85, 14]
                });
                const tempM = L.marker([st.lat, st.lng], { icon: stationIcon, zIndexOffset: 2000 });
                tempM.bindPopup(`
                    <div style="font-family: inherit; min-width: 190px;">
                        <div style="font-size: 15px; font-weight: 800; color: #0066cc;">🚏 ${st.name}</div>
                        <div style="font-size: 12px; color: #475569; margin: 4px 0;">Tuyến đi qua: <b>${st.fleetOver || (currentRoute ? currentRoute.code : '83')}</b></div>
                        <button onclick="openAlertModalForStation(${st.stationId}, '${st.name.replace(/'/g, "\\'")}', '${currentRoute ? currentRoute.code : ''}', ${st.lat}, ${st.lng})" 
                                style="width: 100%; margin-top: 8px; background: #ea580c; color: #fff; border: none; padding: 7px 10px; border-radius: 6px; font-weight: 700; font-size: 12.5px; cursor: pointer;">
                            🔔 Đặt cảnh báo xe đến đây
                        </button>
                    </div>
                `).openPopup();
                stationMarkersLayer.addLayer(tempM);
            }
        }, 300);
    }

    // 4. Cuộn mượt danh sách điểm dừng tới trạm này và highlight
    switchTab('tab-stations');
    setTimeout(() => {
        const el = document.getElementById(`station-item-${st.stationId}`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('highlight-target');
            setTimeout(() => el.classList.remove('highlight-target'), 2500);
        }
    }, 400);

    // 5. Duy trì realtime xe của tuyến chạy liên tục
    if (currentRoute) {
        fetchRealtimeBuses();
    } else {
        fetchRealtimeStationBuses();
    }
}

window.panToStation = function(lat, lng) {
    if (lat && lng) {
        map.setView([lat, lng], 16, { animate: true });
        bottomSheet.classList.remove('expanded');
        bottomSheet.classList.add('collapsed');
    }
};

// Helper: Render Bus Cards List in Bottom Sheet (Hiển thị phân biệt Chiều đi / Chiều về + Nút Canh xe xuất bến)
function renderBusCardsList(allBuses) {
    if (!allBuses || allBuses.length === 0) {
        realtimeBusList.innerHTML = `<div class="empty-hint">Hiện chưa quét được xe buýt nào đang gửi tín hiệu GPS. Hệ thống đang tiếp tục quét mỗi 4 giây...</div>`;
        return;
    }

    realtimeBusList.innerHTML = allBuses.map(b => {
        const isGo = b.isGo !== false;
        const dirClass = isGo ? 'pill-go' : 'pill-ret';
        const dirLabel = isGo ? '➜ Chiều đi' : '⬅ Chiều về';
        return `
            <div class="bus-card" onclick="panToStation(${b.lat}, ${b.lng})">
                <div class="bus-plate-wrap">
                    <div class="bus-plate-icon">${getBusSvgIcon(isGo ? '#0284c7' : '#ea580c', 22)}</div>
                    <div>
                        <div class="bus-plate-title" style="display:flex; align-items:center; gap:6px;">
                            <span>${b.plate}</span>
                            <span class="dir-pill ${dirClass}">${dirLabel}</span>
                        </div>
                        <div class="bus-route-direction">${b.directionText || b.fleetCode || ('Tuyến ' + b.fleet)}</div>
                        <div style="font-size: 11.5px; color: #64748b; margin-top: 2px;">Trạm: ${b.nextStation || 'Dọc tuyến'}</div>
                    </div>
                </div>
                <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px;">
                    <div class="bus-proximity-stats" style="text-align: right;">
                        <div class="bus-distance">${b.partRemained >= 1000 ? (b.partRemained/1000).toFixed(1) + ' km' : Math.round(b.partRemained || 0) + ' m'}</div>
                        <div class="bus-eta">còn ~${Math.max(1, Math.round((b.timeRemained || 0)/60))} phút</div>
                    </div>
                    <button class="btn-bus-departure" onclick="event.stopPropagation(); openDepartureModal('${b.plate}', '${b.fleet || (currentRoute ? currentRoute.code : '')}', '${(b.nextStation || 'Bến xe').replace(/'/g, "\\'")}', ${b.partRemained || 0}, ${b.lat}, ${b.lng})">
                        🚀 Canh xe chạy
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// 1-Second Smooth Animation Tick Loop (Di chuyển xe mượt mà dọc tuyến mỗi giây)
function tickRealtimeBusesEverySecond() {
    if (liveActiveBuses.size === 0) return;

    for (const b of liveActiveBuses.values()) {
        if (!b.marker) continue;

        // Path to glide along
        const path = (b.path && b.path.length > 1) ? b.path : 
                     (currentRoute ? (b.isGo ? currentRoute.go.path : currentRoute.ret.path) : null);
        if (!path || path.length < 2) continue;

        // Target coordinates to measure distance from
        const targetLat = b.targetLat || (currentStation ? currentStation.lat : b.lat);
        const targetLng = b.targetLng || (currentStation ? currentStation.lng : b.lng);

        // If distance is almost 0, don't overshoot
        if (typeof b.partRemained === 'number' && b.partRemained > 15) {
            // Speed in m/s (default ~28 km/h = 7.7 m/s)
            const speedKmh = (b.speed && b.speed > 5) ? b.speed : 28;
            const metersPerSec = Math.max(3, Math.min(14, speedKmh * 1000 / 3600));

            b.partRemained = Math.max(0, b.partRemained - metersPerSec);
            if (b.timeRemained > 0) {
                b.timeRemained = Math.max(0, b.timeRemained - 1);
            }

            // Interpolate new position along polyline
            const newPos = interpolatePositionBackwards(path, targetLat, targetLng, b.partRemained);
            b.lat = newPos.lat;
            b.lng = newPos.lng;
            b.bearing = newPos.bearing;

            // Smooth glide marker with CSS transform transition 0.95s
            b.marker.setLatLng([newPos.lat, newPos.lng]);
        }

        // Kiểm tra điều kiện xe xuất bến / bắt đầu di chuyển
        checkDepartureCondition(b);

        // Kiểm tra điều kiện xe đến gần trạm cảnh báo (mỗi giây)
        checkProximityAlertLocal(b);
    }
}

// Realtime Tracking Polling
function startRealtimeTracking(type = 'route') {
    if (realtimeInterval) clearInterval(realtimeInterval);
    if (busSecondTimer) clearInterval(busSecondTimer);

    // Bắt đầu nhịp animation di chuyển xe mỗi giây
    busSecondTimer = setInterval(tickRealtimeBusesEverySecond, 1000);

    if (type === 'route') {
        fetchRealtimeBuses();
        realtimeInterval = setInterval(fetchRealtimeBuses, 4000);
    } else if (type === 'station') {
        fetchRealtimeStationBuses();
        realtimeInterval = setInterval(fetchRealtimeStationBuses, 4000);
    }
}

// Fetch realtime buses for an entire route (Hiển thị tất cả xe đang lưu thông trên làn đường)
async function fetchRealtimeBuses() {
    if (!currentRoute) return;

    try {
        const res = await fetch(`/api/realtime/route/${encodeURIComponent(currentRoute.code)}`);
        const json = await res.json();
        if (!json.success) return;

        const allBuses = json.buses || [];
        busCountSpan.innerText = allBuses.length;

        const activePlates = new Set();
        allBuses.forEach(b => {
            if (!b.lat || !b.lng) return;
            const plateKey = String(b.plate || '').trim();
            activePlates.add(plateKey);

            if (liveActiveBuses.has(plateKey)) {
                // Cập nhật vị trí và thông tin xe hiện hữu
                const existing = liveActiveBuses.get(plateKey);
                existing.partRemained = b.partRemained;
                existing.timeRemained = b.timeRemained;
                existing.speed = b.speed;
                existing.targetLat = b.targetLat;
                existing.targetLng = b.targetLng;
                existing.path = (b.path && b.path.length > 0) ? b.path : existing.path;
                existing.nextStation = b.nextStation;
                existing.directionText = b.directionText;
                existing.isGo = b.isGo;

                if (existing.marker) {
                    existing.marker.setLatLng([b.lat, b.lng]);
                    updateBusPopup(existing.marker, existing);
                }
                checkDepartureCondition(existing);
                checkProximityAlertLocal(existing);
            } else {
                // Tạo marker mới cho xe vừa xuất hiện
                const m = createBusMarker(b);
                busMarkersLayer.addLayer(m);
                b.marker = m;
                liveActiveBuses.set(plateKey, b);
                checkDepartureCondition(b);
                checkProximityAlertLocal(b);
            }
        });

        // Xóa những xe không còn phát tín hiệu
        for (const [plate, b] of liveActiveBuses.entries()) {
            if (!activePlates.has(plate)) {
                if (b.marker) busMarkersLayer.removeLayer(b.marker);
                liveActiveBuses.delete(plate);
            }
        }

        renderBusCardsList(Array.from(liveActiveBuses.values()));

    } catch (e) {
        console.warn('Realtime fetch failed:', e);
    }
}

// Fetch realtime buses for a specific Station (e.g. Chợ Gạo)
async function fetchRealtimeStationBuses() {
    if (!currentStation) return;

    try {
        const res = await fetch(`/api/realtime/station/${currentStation.stationId}`);
        const json = await res.json();
        if (!json.success) return;

        const buses = json.buses || [];
        busCountSpan.innerText = buses.length;

        const activePlates = new Set();
        buses.forEach(b => {
            if (!b.lat || !b.lng) return;
            const plateKey = String(b.plate || b.BienKiemSoat || '').trim();
            activePlates.add(plateKey);

            if (liveActiveBuses.has(plateKey)) {
                const existing = liveActiveBuses.get(plateKey);
                existing.partRemained = b.partRemained || b.PartRemained;
                existing.timeRemained = b.timeRemained || b.TimeRemained;
                existing.speed = b.speed || b.Speed;
                existing.isGo = b.isGo;
                existing.directionText = b.directionText;
                if (existing.marker) {
                    existing.marker.setLatLng([b.lat, b.lng]);
                    updateBusPopup(existing.marker, existing);
                }
            } else {
                const m = createBusMarker(b);
                busMarkersLayer.addLayer(m);
                b.marker = m;
                liveActiveBuses.set(plateKey, b);
            }
        });

        for (const [plate, b] of liveActiveBuses.entries()) {
            if (!activePlates.has(plate)) {
                if (b.marker) busMarkersLayer.removeLayer(b.marker);
                liveActiveBuses.delete(plate);
            }
        }

        renderBusCardsList(Array.from(liveActiveBuses.values()));

    } catch (e) {
        console.warn('Station buses fetch failed:', e);
    }
}

// ==========================================
// 3. PROXIMITY ALERT ENGINE
// ==========================================
window.openAlertModalForStation = function(stationId, stationName, routeCode = '', lat = 0, lng = 0) {
    let stationIsGo = null;
    let stationOrder = null;

    if (currentRoute) {
        if (!routeCode) routeCode = currentRoute.code;
        const goStations = (currentRoute.go && currentRoute.go.stations) || [];
        const retStations = (currentRoute.ret && currentRoute.ret.stations) || [];

        if (currentDirection === 'go') {
            const foundGo = goStations.find(s => s.stationId === stationId);
            if (foundGo) {
                stationIsGo = true;
                stationOrder = foundGo.order;
                if (!lat || !lng) { lat = foundGo.lat; lng = foundGo.lng; }
            } else {
                const foundRet = retStations.find(s => s.stationId === stationId);
                if (foundRet) {
                    stationIsGo = false;
                    stationOrder = foundRet.order;
                    if (!lat || !lng) { lat = foundRet.lat; lng = foundRet.lng; }
                }
            }
        } else {
            const foundRet = retStations.find(s => s.stationId === stationId);
            if (foundRet) {
                stationIsGo = false;
                stationOrder = foundRet.order;
                if (!lat || !lng) { lat = foundRet.lat; lng = foundRet.lng; }
            } else {
                const foundGo = goStations.find(s => s.stationId === stationId);
                if (foundGo) {
                    stationIsGo = true;
                    stationOrder = foundGo.order;
                    if (!lat || !lng) { lat = foundGo.lat; lng = foundGo.lng; }
                }
            }
        }
    }

    pendingAlert = { stationId, stationName, routeCode, lat, lng, isGo: stationIsGo, stationOrder: stationOrder };

    const dirTag = stationIsGo === true ? ' [Chiều đi]' : (stationIsGo === false ? ' [Chiều về]' : '');
    modalRouteName.innerText = routeCode ? `Tuyến ${routeCode}${dirTag}` : 'Tất cả các tuyến qua trạm';
    modalStationName.innerText = stationName || `Trạm ID: ${stationId}`;
    alertModal.style.display = 'flex';

    requestNotificationPermission();
    if (!ringtoneAudioCtx) {
        ringtoneAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
};

modalCloseBtn.addEventListener('click', () => alertModal.style.display = 'none');
btnCancelModal.addEventListener('click', () => alertModal.style.display = 'none');

btnTestAlertSound.addEventListener('click', () => {
    startPhoneRingtone();
    triggerVibration();
    const testFleet = (pendingAlert && pendingAlert.routeCode) ? pendingAlert.routeCode : (currentRoute ? currentRoute.code : '83');
    const testStation = pendingAlert ? pendingAlert.stationName : 'Điểm dừng đã chọn';
    showIncomingCall(
        '29E-95794',
        testFleet,
        `Cách trạm ~250m (~1 phút)!`,
        `Thông báo: Xe buýt biển số 29E-95794 tuyến ${testFleet} đang cách điểm dừng ${testStation} khoảng 250 mét, sắp tới nơi. Quý khách vui lòng chuẩn bị đón xe!`
    );
});

btnActivateAlert.addEventListener('click', () => {
    if (!pendingAlert) return;

    activeAlert = {
        routeCode: pendingAlert.routeCode,
        stationId: pendingAlert.stationId,
        stationName: pendingAlert.stationName,
        stationLat: pendingAlert.lat,
        stationLng: pendingAlert.lng,
        isGo: pendingAlert.isGo,
        stationOrder: pendingAlert.stationOrder,
        maxDistance: parseInt(alertDistanceSelect.value, 10),
        call: chkCall ? chkCall.checked : true,
        sound: chkSound.checked,
        vibrate: chkVibrate.checked,
        notify: chkNotification.checked,
        lastNotifiedPlate: null
    };

    alertModal.style.display = 'none';

    // Show Alert Banner
    alertBanner.style.display = 'flex';
    const dirTag = activeAlert.isGo === true ? ' [Chiều đi]' : (activeAlert.isGo === false ? ' [Chiều về]' : '');
    alertBannerStation.innerText = `Đang canh xe ${activeAlert.routeCode ? 'Tuyến ' + activeAlert.routeCode : ''}${dirTag} tại: ${activeAlert.stationName}`;
    alertBannerStatus.innerText = `Cảnh báo khi xe cùng chiều cách < ${activeAlert.maxDistance >= 1000 ? (activeAlert.maxDistance/1000) + 'km' : activeAlert.maxDistance + 'm'}`;

    // Kiểm tra ngay lập tức các xe đang có trên bản đồ
    for (const b of liveActiveBuses.values()) {
        checkProximityAlertLocal(b);
    }
    checkStationAlert();
});

btnStopAlert.addEventListener('click', () => {
    activeAlert = null;
    alertBanner.style.display = 'none';
    stopPhoneRingtone();
});

// Kiểm tra điều kiện xe buýt đến gần trạm cảnh báo (chạy mỗi giây trực tiếp trên client)
function checkProximityAlertLocal(b) {
    if (!activeAlert) return;
    const bFleet = String(b.fleet || '').trim();
    if (activeAlert.routeCode && bFleet.toLowerCase() !== String(activeAlert.routeCode).trim().toLowerCase()) return;

    // 1. FILTER CHIỀU: Tuyệt đối chỉ cảnh báo xe đang chạy CÙNG CHIỀU với điểm dừng đã chọn!
    if (typeof activeAlert.isGo === 'boolean' && typeof b.isGo === 'boolean') {
        if (b.isGo !== activeAlert.isGo) return; // Khác chiều -> Bỏ qua ngay lập tức!
    }

    // 2. FILTER ĐÃ QUA ĐIỂM: Bỏ qua xe đã đi qua trạm cảnh báo!
    if (currentRoute && typeof activeAlert.stationOrder === 'number' && b.nextStationId) {
        const stList = b.isGo ? (currentRoute.go ? currentRoute.go.stations : []) : (currentRoute.ret ? currentRoute.ret.stations : []);
        const busNextSt = stList.find(s => s.stationId === b.nextStationId);
        if (busNextSt && typeof busNextSt.order === 'number') {
            if (busNextSt.order > activeAlert.stationOrder) {
                // Trạm tiếp theo của xe đã vượt quá trạm cảnh báo -> Xe ĐÃ ĐI QUA TRẠM -> Bỏ qua!
                return;
            }
        }
    }

    let distMeters = Infinity;
    if (b.nextStationId === activeAlert.stationId && typeof b.partRemained === 'number') {
        distMeters = b.partRemained;
    } else if (b.lat && b.lng && activeAlert.stationLat && activeAlert.stationLng) {
        distMeters = getDistance(b.lat, b.lng, activeAlert.stationLat, activeAlert.stationLng);
    }

    if (distMeters <= activeAlert.maxDistance) {
        triggerStationProximityAlert({
            fleet: bFleet || activeAlert.routeCode,
            plate: b.plate,
            distance: Math.round(distMeters),
            timeRemained: b.timeRemained || Math.round((distMeters / 300) * 60)
        });
    }
}

function triggerStationProximityAlert({ fleet, plate, distance, timeRemained }) {
    if (!activeAlert) return;
    const etaMinutes = Math.max(1, Math.round((timeRemained || 60) / 60));

    alertBannerStatus.innerHTML = `⚠️ <b style="color: #d32f2f;">XE SẮP TỚI!</b> Tuyến <b>${fleet}</b> (${plate}) cách ${distance}m (~${etaMinutes} phút)!`;

    if (activeAlert.lastNotifiedPlate !== plate) {
        activeAlert.lastNotifiedPlate = plate;

        if (activeAlert.sound) startPhoneRingtone();
        if (activeAlert.vibrate) triggerVibration();

        if (activeAlert.notify && 'Notification' in window && Notification.permission === 'granted') {
            new Notification(`Xe Buýt Tuyến ${fleet} Sắp Đến Trạm!`, {
                body: `Xe mang biển số ${plate} hiện chỉ còn cách bạn ${distance} mét (~${etaMinutes} phút). Chuẩn bị ra đón xe!`,
                icon: 'icon.png'
            });
        }

        if (activeAlert.call) {
            showIncomingCall(
                plate,
                fleet,
                `Cách trạm ~${distance}m (~${etaMinutes} phút)!`,
                `Thông báo: Xe buýt biển số ${plate} tuyến ${fleet} đang cách điểm dừng ${activeAlert.stationName} ${distance} mét, khoảng ${etaMinutes} phút nữa sẽ tới nơi. Quý khách vui lòng chuẩn bị đón xe!`
            );
        } else {
            alert(`🔔 CẢNH BÁO XE BUÝT SẮP ĐẾN!\n\nXe Tuyến ${fleet} (Biển số: ${plate}) đang cách trạm ${distance} mét (~${etaMinutes} phút)!\nHãy chuẩn bị ra đón xe.`);
        }
    }
}

// Periodic Station Alert Check
setInterval(checkStationAlert, 5000);

async function checkStationAlert() {
    if (!activeAlert) return;

    try {
        const res = await fetch(`/api/realtime/station/${activeAlert.stationId}?fleet=${encodeURIComponent(activeAlert.routeCode || '')}`);
        const json = await res.json();
        if (!json.success || !Array.isArray(json.buses)) return;

        const incomingBuses = json.buses;
        let matchedBus = null;

        for (const b of incomingBuses) {
            const bFleet = String(b.fleet || b.Fleet || '').trim();
            if (activeAlert.routeCode && bFleet.toLowerCase() !== activeAlert.routeCode.toLowerCase()) continue;

            // 1. FILTER CHIỀU: Tuyệt đối chỉ xét xe cùng chiều với điểm dừng đã chọn
            if (typeof activeAlert.isGo === 'boolean' && typeof b.isGo === 'boolean') {
                if (b.isGo !== activeAlert.isGo) continue;
            }

            const bDist = (typeof b.partRemained === 'number') ? b.partRemained : 
                          ((typeof b.PartRemained === 'number') ? b.PartRemained : Infinity);

            if (bDist <= activeAlert.maxDistance) {
                matchedBus = {
                    fleet: bFleet || activeAlert.routeCode,
                    plate: b.plate || b.BienKiemSoat || b.plateNum || '',
                    distance: Math.round(bDist),
                    timeRemained: b.timeRemained || b.TimeRemained || 60
                };
                break;
            }
        }

        if (matchedBus) {
            triggerStationProximityAlert(matchedBus);
        } else if (!activeAlert.lastNotifiedPlate) {
            alertBannerStatus.innerText = `Đang quét xe... Xe gần nhất chưa vào phạm vi ${activeAlert.maxDistance >= 1000 ? (activeAlert.maxDistance/1000) + 'km' : activeAlert.maxDistance + 'm'}`;
        }
    } catch (e) {
        console.warn('Alert check failed:', e);
    }
}

// ==========================================
// 3.1 DEPARTURE ALERT ENGINE (CANH XE RỜI BẾN) & MÔ PHỎNG CUỘC GỌI
// ==========================================
let pendingDeparture = null;
let activeDepartureAlert = null;
let inCallTimer = null;
let callDurationSec = 0;
let currentCallContext = null;

function startCallTimer() {
    stopCallTimer();
    callDurationSec = 0;
    if (callTimer) {
        callTimer.innerText = '00:00';
        callTimer.style.display = 'block';
    }
    inCallTimer = setInterval(() => {
        callDurationSec++;
        const mins = String(Math.floor(callDurationSec / 60)).padStart(2, '0');
        const secs = String(callDurationSec % 60).padStart(2, '0');
        if (callTimer) callTimer.innerText = `${mins}:${secs}`;
    }, 1000);
}

function stopCallTimer() {
    if (inCallTimer) {
        clearInterval(inCallTimer);
        inCallTimer = null;
    }
    callDurationSec = 0;
    if (callTimer) callTimer.style.display = 'none';
}

function showIncomingCall(plate, fleet, subTitle = '', voiceMessage = '') {
    if (!incomingCallOverlay) return;
    currentCallContext = {
        plate,
        fleet,
        subTitle: subTitle || `Tuyến ${fleet} • Xe đã xuất bến!`,
        voiceMessage: voiceMessage || `Thông báo: Xe buýt biển số ${plate} tuyến ${fleet} đã bắt đầu xuất bến và đang di chuyển. Bạn hãy chuẩn bị ra đón xe nhé!`
    };

    incomingCallOverlay.style.display = 'flex';
    if (callCallerName) callCallerName.innerText = `Xe ${plate}`;
    if (callCallerSub) callCallerSub.innerText = currentCallContext.subTitle;
    if (callStatusLabel) callStatusLabel.innerText = 'Đang đổ chuông cuộc gọi...';
    if (callRingingActions) callRingingActions.style.display = 'flex';
    if (callActiveActions) callActiveActions.style.display = 'none';
    stopCallTimer();
}

function answerCall(plate, fleet) {
    stopPhoneRingtone();
    if (callStatusLabel) callStatusLabel.innerText = 'Đang nghe cuộc gọi trực tiếp';
    if (callRingingActions) callRingingActions.style.display = 'none';
    if (callActiveActions) callActiveActions.style.display = 'flex';
    startCallTimer();

    const voiceMsg = currentCallContext ? currentCallContext.voiceMessage : `Thông báo: Xe buýt biển số ${plate} tuyến ${fleet} đang đến gần. Bạn hãy chuẩn bị đón xe nhé!`;
    speakVietnamese(voiceMsg);
}

function hangupCall() {
    stopPhoneRingtone();
    stopCallTimer();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (incomingCallOverlay) incomingCallOverlay.style.display = 'none';
}

window.openDepartureModal = function(plate, fleet, stationName, partRemained, lat, lng) {
    pendingDeparture = {
        plate,
        fleet: fleet || (currentRoute ? currentRoute.code : ''),
        stationName,
        partRemained,
        lat,
        lng
    };

    if (depModalPlate) depModalPlate.innerText = plate;
    if (depModalStatus) depModalStatus.innerText = `Tuyến ${pendingDeparture.fleet} • Vị trí: ${stationName || 'Bến xe'}`;
    if (departureModal) departureModal.style.display = 'flex';

    requestNotificationPermission();
    if (!ringtoneAudioCtx) {
        ringtoneAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
};

if (modalDepartureCloseBtn) modalDepartureCloseBtn.addEventListener('click', () => departureModal.style.display = 'none');
if (btnCancelDepartureModal) btnCancelDepartureModal.addEventListener('click', () => departureModal.style.display = 'none');

if (btnTestDepCall) {
    btnTestDepCall.addEventListener('click', () => {
        startPhoneRingtone();
        triggerVibration();
        const testPlate = pendingDeparture ? pendingDeparture.plate : '29E-95736';
        const testFleet = pendingDeparture ? pendingDeparture.fleet : '83';
        showIncomingCall(testPlate, testFleet);
    });
}

if (btnActivateDeparture) {
    btnActivateDeparture.addEventListener('click', () => {
        if (!pendingDeparture) return;

        activeDepartureAlert = {
            plate: pendingDeparture.plate,
            fleet: pendingDeparture.fleet,
            initialPartRemained: pendingDeparture.partRemained || 0,
            initialLat: pendingDeparture.lat || 0,
            initialLng: pendingDeparture.lng || 0,
            startTime: Date.now(),
            call: chkDepCall ? chkDepCall.checked : true,
            sound: chkDepSound ? chkDepSound.checked : true,
            vibrate: chkDepVibrate ? chkDepVibrate.checked : true,
            notify: chkDepNotify ? chkDepNotify.checked : true
        };

        departureModal.style.display = 'none';

        if (departureBanner) {
            departureBanner.style.display = 'flex';
            if (departureBannerTitle) departureBannerTitle.innerText = `Đang canh xe ${activeDepartureAlert.plate} (Tuyến ${activeDepartureAlert.fleet}) xuất bến!`;
            if (departureBannerStatus) departureBannerStatus.innerText = `Hệ thống sẽ đổ chuông & gọi điện ngay khi xe bắt đầu di chuyển.`;
        }

        alert(`🚀 ĐÃ KÍCH HOẠT CANH XE!\n\nĐang theo dõi xe ${activeDepartureAlert.plate} Tuyến ${activeDepartureAlert.fleet}.\nNgay khi xe chuyển bánh xuất bến, hệ thống sẽ lập tức đổ chuông, rung máy và gọi điện báo cho bạn!`);
    });
}

if (btnStopDeparture) {
    btnStopDeparture.addEventListener('click', () => {
        activeDepartureAlert = null;
        if (departureBanner) departureBanner.style.display = 'none';
        stopPhoneRingtone();
    });
}

if (btnAcceptCall) {
    btnAcceptCall.addEventListener('click', () => {
        const plate = activeDepartureAlert ? activeDepartureAlert.plate : (pendingDeparture ? pendingDeparture.plate : '29E-95736');
        const fleet = activeDepartureAlert ? activeDepartureAlert.fleet : (pendingDeparture ? pendingDeparture.fleet : '83');
        answerCall(plate, fleet);
    });
}

if (btnDeclineCall) btnDeclineCall.addEventListener('click', () => hangupCall());
if (btnHangupCall) btnHangupCall.addEventListener('click', () => hangupCall());

function checkDepartureCondition(bus) {
    if (!activeDepartureAlert) return;
    const busPlate = String(bus.plate || '').trim();
    if (busPlate !== String(activeDepartureAlert.plate).trim()) return;

    const distDelta = Math.abs((bus.partRemained || 0) - activeDepartureAlert.initialPartRemained);
    const geoDelta = (bus.lat && bus.lng && activeDepartureAlert.initialLat && activeDepartureAlert.initialLng)
        ? getDistance(bus.lat, bus.lng, activeDepartureAlert.initialLat, activeDepartureAlert.initialLng)
        : 0;
    const speed = bus.speed || 0;

    // Phát hiện xe bắt đầu chuyển bánh (tốc độ > 5 km/h hoặc di chuyển quá 50m)
    if (speed >= 5 || distDelta >= 50 || geoDelta >= 50) {
        triggerDepartureAlert(bus);
    }
}

function triggerDepartureAlert(bus) {
    if (!activeDepartureAlert) return;

    const alertCopy = { ...activeDepartureAlert };
    activeDepartureAlert = null; // Tránh kích hoạt lặp

    if (departureBannerStatus) {
        departureBannerStatus.innerHTML = `⚠️ <b style="color: #fef08a;">XE ĐÃ RỜI BẾN!</b> Xe <b>${alertCopy.plate}</b> đã bắt đầu di chuyển!`;
    }

    if (alertCopy.sound) startPhoneRingtone();
    if (alertCopy.vibrate) triggerVibration();

    if (alertCopy.notify && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(`Xe buýt ${alertCopy.plate} đã xuất bến!`, {
            body: `Xe tuyến ${alertCopy.fleet} (${alertCopy.plate}) vừa chuyển bánh rời bến và đang bắt đầu hành trình. Hãy chuẩn bị ra đón xe!`,
            icon: 'icon.png'
        });
    }

    if (alertCopy.call) {
        showIncomingCall(alertCopy.plate, alertCopy.fleet);
    } else {
        alert(`🔔 XE BUÝT ĐÃ XUẤT BẾN!\n\nXe ${alertCopy.plate} Tuyến ${alertCopy.fleet} đã bắt đầu rời bến và đang di chuyển!`);
    }
}

// ==========================================
// 4. LOCATION ENGINE (GPS + MANUAL PICKING)
// ==========================================

document.getElementById('btn-locate').addEventListener('click', () => {
    if (!navigator.geolocation) {
        alert('Thiết bị của bạn không hỗ trợ định vị.');
        return;
    }

    showLoading(true, 'Đang xác định vị trí...');
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            showLoading(false);
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const accuracy = pos.coords.accuracy || 0;

            setUserPosition(lat, lng, accuracy);

            if (accuracy > 800) {
                locationHintToast.style.display = 'flex';
            }
        },
        (err) => {
            showLoading(false);
            locationHintToast.style.display = 'flex';
            alert('Không lấy được GPS chính xác (' + err.message + '). Bạn có thể click chuột trực tiếp lên bản đồ để chọn vị trí của bạn.');
        },
        { enableHighAccuracy: true, timeout: 8000 }
    );
});

document.getElementById('btn-pick-location').addEventListener('click', () => {
    locationHintToast.style.display = 'flex';
    locationHintToast.querySelector('span').innerHTML = '👉 <b>Hãy click vào vị trí bất kỳ trên bản đồ</b> để đặt vị trí của bạn.';
});

btnCloseToast.addEventListener('click', () => {
    locationHintToast.style.display = 'none';
});

function handleManualLocationPick(lat, lng) {
    setUserPosition(lat, lng, 20);
    locationHintToast.style.display = 'none';
}

function setUserPosition(lat, lng, accuracy = 20) {
    if (userLocationMarker) map.removeLayer(userLocationMarker);
    if (userAccuracyCircle) map.removeLayer(userAccuracyCircle);

    userLocationMarker = L.circleMarker([lat, lng], {
        radius: 9,
        fillColor: '#2563eb',
        color: '#ffffff',
        weight: 3,
        opacity: 1,
        fillOpacity: 0.95
    }).addTo(map);

    userAccuracyCircle = L.circle([lat, lng], {
        radius: Math.min(accuracy, 2000),
        color: '#2563eb',
        fillColor: '#60a5fa',
        fillOpacity: 0.15,
        weight: 1
    }).addTo(map);

    userLocationMarker.bindPopup(`
        <div style="font-family: inherit;">
            <div style="font-weight: 800; color: #2563eb;">📍 Vị trí của bạn</div>
            <div style="font-size: 11px; color: #64748b; margin-top: 2px;">Sai số ước tính: ±${Math.round(accuracy)}m</div>
            <div style="font-size: 12px; margin-top: 6px;">Click vào trạm buýt gần nhất để xem xe sắp tới.</div>
        </div>
    `).openPopup();

    map.setView([lat, lng], 15, { animate: true });
}

// Refresh button
document.getElementById('btn-refresh-realtime').addEventListener('click', () => {
    if (currentRoute) {
        fetchRealtimeBuses();
    } else if (currentStation) {
        fetchRealtimeStationBuses();
    }
});

function switchTab(tabId) {
    sheetTabs.forEach(t => t.classList.remove('active'));
    tabBuses.classList.remove('active');
    tabStations.classList.remove('active');
    tabInfo.classList.remove('active');

    const tabBtn = document.querySelector(`.sheet-tab[data-tab="${tabId}"]`);
    if (tabBtn) tabBtn.classList.add('active');
    document.getElementById(tabId).classList.add('active');
}

sheetTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-tab');
        switchTab(target);
        bottomSheet.classList.remove('collapsed');
        bottomSheet.classList.add('expanded');
    });
});

// Nút thu gọn / đóng Bottom Sheet
const btnCollapseSheet = document.getElementById('btn-collapse-sheet');
if (btnCollapseSheet) {
    btnCollapseSheet.addEventListener('click', (e) => {
        e.stopPropagation();
        bottomSheet.classList.remove('expanded');
        bottomSheet.classList.add('collapsed');
    });
}

document.getElementById('btn-toggle-sheet').addEventListener('click', () => {
    bottomSheet.classList.toggle('expanded');
    bottomSheet.classList.toggle('collapsed');
});

sheetHandle.addEventListener('click', () => {
    bottomSheet.classList.toggle('expanded');
    bottomSheet.classList.toggle('collapsed');
});

function showLoading(show, text = 'Đang tải...') {
    loadingSpinner.style.display = show ? 'flex' : 'none';
    document.getElementById('loading-text').innerText = text;
}

// ==========================================
// 4. AUTO-UPDATE APP ENGINE (Tự động cập nhật & Bảo lưu 100% dữ liệu)
// ==========================================
const APP_CURRENT_VERSION = '1.2.3';
const DEFAULT_UPDATE_URL = 'https://raw.githubusercontent.com/tuanleanh89/timbus_promax/main/version.json';

const btnCheckUpdate = document.getElementById('btn-check-update');
const updateIcon = document.getElementById('update-icon');
const updateText = document.getElementById('update-text');
const updateModal = document.getElementById('update-modal');
const updateModalTitle = document.getElementById('update-modal-title');
const updateModalBody = document.getElementById('update-modal-body');
const updateModalFooter = document.getElementById('update-modal-footer');
const btnCloseUpdateModal = document.getElementById('btn-close-update-modal');
const btnCancelUpdate = document.getElementById('btn-cancel-update');
const btnConfirmUpdate = document.getElementById('btn-confirm-update');
const btnManualCheckUpdate = document.getElementById('btn-manual-check-update');
const infoCurrentVer = document.getElementById('info-current-ver');

let latestUpdateData = null;

function getUpdateManifestUrl() {
    return localStorage.getItem('custom_bus_update_url') || DEFAULT_UPDATE_URL;
}

function isNewerVersion(remoteVer, currentVer) {
    if (!remoteVer || !currentVer) return false;
    const v1 = String(remoteVer).trim().replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    const v2 = String(currentVer).trim().replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    const len = Math.max(v1.length, v2.length);
    for (let i = 0; i < len; i++) {
        const a = v1[i] || 0;
        const b = v2[i] || 0;
        if (a > b) return true;
        if (a < b) return false;
    }
    return false;
}

async function checkAppUpdate(isManual = false) {
    if (updateIcon) updateIcon.style.animation = 'spin 0.8s linear infinite';

    try {
        let url = getUpdateManifestUrl();
        let updateData = null;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}_nocache=${Date.now()}`, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) updateData = await res.json();
        } catch (_) {
            // Fallback to local server endpoint if remote fails
            if (url !== '/api/version') {
                const resLocal = await fetch(`/api/version?_nocache=${Date.now()}`);
                if (resLocal.ok) updateData = await resLocal.json();
            }
        }

        if (!updateData) throw new Error('Không thể nạp dữ liệu phiên bản');
        latestUpdateData = updateData;

        const remoteVer = updateData.version || '';
        const hasUpdate = isNewerVersion(remoteVer, APP_CURRENT_VERSION);

        if (hasUpdate) {
            if (btnCheckUpdate) btnCheckUpdate.classList.add('has-update');
            if (updateIcon) updateIcon.innerText = '🔴';
            if (updateText) updateText.innerText = `Có v${remoteVer}`;

            showUpdateModal(updateData, true);
        } else {
            if (btnCheckUpdate) btnCheckUpdate.classList.remove('has-update');
            if (updateIcon) updateIcon.innerText = '🔄';
            if (updateText) updateText.innerText = `v${APP_CURRENT_VERSION}`;

            if (isManual) {
                showUpdateModal(updateData, false);
            }
        }
    } catch (err) {
        console.warn('Update check failed:', err);
        if (isManual) {
            alert(`⚠️ Không thể kết nối máy chủ cập nhật: ${err.message || 'Lỗi mạng'}\nVui lòng kiểm tra lại kết nối.`);
        }
    } finally {
        if (updateIcon) updateIcon.style.animation = '';
    }
}

function showUpdateModal(data, hasUpdate) {
    if (!updateModal) return;
    const remoteVer = (data && data.version) || APP_CURRENT_VERSION;
    const releaseDate = (data && data.release_date) || 'Mới nhất';
    const changelog = (data && Array.isArray(data.changelog)) ? data.changelog : [];

    if (hasUpdate) {
        updateModalTitle.innerHTML = `🚀 Đã có phiên bản mới: <b>v${remoteVer}</b>`;
        updateModalBody.innerHTML = `
            <div style="font-size: 13.5px; color: #334155;">
                <div style="display: flex; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid #e2e8f0;">
                    <span>Phiên bản hiện tại: <b>v${APP_CURRENT_VERSION}</b></span>
                    <span style="color: #2563eb; font-weight: 800;">Mới: v${remoteVer}</span>
                </div>
                <div style="margin-top: 6px; font-size: 12px; color: #64748b;">Ngày phát hành: ${releaseDate}</div>

                <div style="margin-top: 12px; font-weight: 700; color: #0f172a;">Những điểm mới trong bản cập nhật:</div>
                <ul style="margin: 6px 0 12px 18px; padding: 0; font-size: 12.5px; color: #334155; line-height: 1.5;">
                    ${changelog.map(item => `<li style="margin-bottom: 4px;">${item}</li>`).join('')}
                </ul>

                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px 12px; margin-top: 10px; font-size: 12px; color: #166534;">
                    🛡️ <b>Đảm bảo an toàn:</b> Toàn bộ điểm dừng đã lưu, cấu hình tuyến mặc định và các thiết lập của bạn được bảo lưu 100%.
                </div>
            </div>
        `;
        updateModalFooter.style.display = 'flex';
        btnConfirmUpdate.innerText = '⚡ Cập nhật ngay';
        btnConfirmUpdate.style.display = 'block';
        btnCancelUpdate.innerText = 'Để sau';
    } else {
        updateModalTitle.innerHTML = `✅ Bạn đang ở phiên bản mới nhất`;
        updateModalBody.innerHTML = `
            <div style="font-size: 13.5px; color: #334155; text-align: center; padding: 10px 0;">
                <div style="font-size: 40px; margin-bottom: 6px;">🎉</div>
                <div style="font-size: 16px; font-weight: 800; color: #0f172a;">Tìm Bus Promax v${APP_CURRENT_VERSION}</div>
                <div style="font-size: 12.5px; color: #64748b; margin-top: 4px;">Ứng dụng của bạn đang chạy phiên bản mới nhất và tối ưu nhất.</div>
                
                <div style="margin-top: 14px; text-align: left; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; font-size: 12px;">
                    <b>Tính năng hiện có trong v${APP_CURRENT_VERSION}:</b>
                    <ul style="margin: 6px 0 0 18px; padding: 0; line-height: 1.45;">
                        ${changelog.map(item => `<li style="margin-bottom: 3px;">${item}</li>`).join('')}
                    </ul>
                </div>
            </div>
        `;
        updateModalFooter.style.display = 'flex';
        btnConfirmUpdate.style.display = 'none';
        btnCancelUpdate.innerText = 'Đóng';
    }

    updateModal.style.display = 'flex';
}

async function performAppUpdate() {
    updateModalTitle.innerHTML = `⏳ Đang tiến hành cập nhật...`;
    updateModalBody.innerHTML = `
        <div style="text-align: center; padding: 20px 10px;">
            <div class="spinner" style="margin: 0 auto 14px auto;"></div>
            <div style="font-weight: 700; color: #0f172a;">Đang xóa bộ nhớ đệm & nạp mã nguồn mới...</div>
            <div style="font-size: 12px; color: #64748b; margin-top: 6px;">Dữ liệu điểm dừng và tuyến yêu thích được giữ nguyên 100%.</div>
        </div>
    `;
    updateModalFooter.style.display = 'none';

    try {
        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
        }
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (const r of regs) {
                await r.update();
            }
        }
    } catch (e) {
        console.warn('Cache clear error:', e);
    }

    setTimeout(() => {
        window.location.href = window.location.pathname + '?_v=' + Date.now();
    }, 1200);
}

if (btnCheckUpdate) {
    btnCheckUpdate.addEventListener('click', () => checkAppUpdate(true));
}
if (btnManualCheckUpdate) {
    btnManualCheckUpdate.addEventListener('click', () => checkAppUpdate(true));
}
if (btnCloseUpdateModal) {
    btnCloseUpdateModal.addEventListener('click', () => { updateModal.style.display = 'none'; });
}
if (btnCancelUpdate) {
    btnCancelUpdate.addEventListener('click', () => { updateModal.style.display = 'none'; });
}
if (btnConfirmUpdate) {
    btnConfirmUpdate.addEventListener('click', performAppUpdate);
}

// ==========================================
// 5. RESET TO HOME (VỀ TRANG BAN ĐẦU KHI BẤM LOGO / BIỂU TƯỢNG)
// ==========================================
const brandHomeBtn = document.getElementById('brand-home-btn');
if (brandHomeBtn) {
    brandHomeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        resetToHome();
    });
}

function resetToHome() {
    searchInput.value = '';
    clearSearchBtn.style.display = 'none';
    searchDropdown.style.display = 'none';

    // Đưa top controls về trạng thái mở nếu đang thu gọn
    document.body.classList.remove('top-controls-collapsed');
    if (btnToggleTopControls) {
        btnToggleTopControls.classList.remove('is-collapsed');
        if (toggleTopIcon) toggleTopIcon.innerText = '▲';
        if (toggleTopText) toggleTopText.innerText = 'Thu gọn';
    }

    // Mặc định ban đầu KHÔNG mở rộng bottom sheet
    bottomSheet.classList.add('collapsed');
    bottomSheet.classList.remove('expanded');

    // Chuyển về tab xe đang chạy
    switchTab('tab-buses');

    // Nạp lại tuyến mặc định ban đầu
    const defaultRoute = localStorage.getItem('bus_hanoi_default_route') || '83';
    selectRoute(defaultRoute);
}

// Initial Boot
window.addEventListener('DOMContentLoaded', async () => {
    initMap();
    // Tự động tải tuyến mặc định đã lưu của người dùng (mặc định Tuyến 83)
    const defaultRoute = localStorage.getItem('bus_hanoi_default_route') || '83';
    selectRoute(defaultRoute);

    // Tự động kiểm tra bản cập nhật mới sau 3 giây
    setTimeout(() => {
        checkAppUpdate(false);
    }, 3000);
});
