'use strict';
// ─── Константы ────
const MAP_CENTER       = GVS_CONFIG.MAP_CENTER;
const MAP_ZOOM_DEFAULT = GVS_CONFIG.MAP_ZOOM_DEFAULT;
const MAP_ZOOM_FOCUS   = GVS_CONFIG.MAP_ZOOM_FOCUS;
const CLUSTER_RADIUS   = GVS_CONFIG.CLUSTER_RADIUS;
const SHEET_SNAP_SMALL  = GVS_CONFIG.SHEET_SNAP_SMALL;
const SHEET_SNAP_MEDIUM = GVS_CONFIG.SHEET_SNAP_MEDIUM;
const SHEET_SNAP_LARGE  = GVS_CONFIG.SHEET_SNAP_LARGE;

const FETCH_TIMEOUT_MS  = GVS_CONFIG.FETCH_TIMEOUT_MS;
const FETCH_RETRY_COUNT = GVS_CONFIG.FETCH_RETRY_COUNT;
const FETCH_RETRY_DELAY = GVS_CONFIG.FETCH_RETRY_DELAY;
const MOBILE_BREAKPOINT = GVS_CONFIG.MOBILE_BREAKPOINT;
const MAX_LIST_ITEMS    = GVS_CONFIG.MAX_LIST_ITEMS;

// ─── Вспомогательная: fetch с таймаутом и retry ────────────────────────
function fetchWithTimeout(url, timeoutMs, retryCount = 0) {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);
  
  return fetch(url, { signal: controller.signal })
    .then(res => { 
      clearTimeout(timerId); 
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res; 
    })
    .catch(err => {
      clearTimeout(timerId);
      if (err.name === 'AbortError') {
        err = new Error('Превышено время ожидания загрузки данных');
      }
      
      // Retry с exponential backoff
      if (retryCount < FETCH_RETRY_COUNT) {
        const delay = FETCH_RETRY_DELAY * Math.pow(2, retryCount);
        console.warn(`[fetch] Попытка ${retryCount + 1} не удалась, повтор через ${delay}мс:`, url);
        return new Promise(resolve => setTimeout(resolve, delay))
          .then(() => fetchWithTimeout(url, timeoutMs, retryCount + 1));
      }
      
      throw err;
    });
}

// ─── normKey ─────────────────────────────────────────────────────────────
function normKey(s) {
  return GVS.normalizeQuery(s).sort().join(' ');
}

// ─── Склонение «адрес» ───────────────────────────────────────────────────
function pluralAddr(n) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return n + ' адресов';
  if (mod10 === 1)                   return n + ' адрес';
  if (mod10 >= 2 && mod10 <= 4)      return n + ' адреса';
  return n + ' адресов';
}

// ─── Карта ───────────────────────────────────────────────────────────────
const map = L.map('map', {
  center: MAP_CENTER,
  zoom:   MAP_ZOOM_DEFAULT,
  attributionControl: true,
});
map.zoomControl.setPosition('bottomleft');
map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');

const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright" style="color:#7d8590">OpenStreetMap</a>',
  maxZoom: 19,
}).addTo(map);

// Tile error toast
(function () {
  let errorShown = false;
  tileLayer.on('tileerror', () => {
    if (errorShown) return;
    errorShown = true;
    const toast = document.createElement('div');
    toast.style.cssText =
      'position:fixed;top:60px;left:50%;transform:translateX(-50%);' +
      'background:var(--surface);border:1px solid var(--border);color:var(--text);' +
      'padding:8px 18px;border-radius:8px;font-size:13px;z-index:9999;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.4);white-space:nowrap;';
    toast.textContent = '⚠️ Не удалось загрузить карту — проверьте соединение';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  });
}());

// ─── Кластерный слой ─────────────────────────────────────────────────────
const clusterGroup = L.markerClusterGroup({
  maxClusterRadius: CLUSTER_RADIUS,
  spiderfyOnMaxZoom: true,
  showCoverageOnHover: false,
  zoomToBoundsOnClick: true,
  iconCreateFunction(cluster) {
    const color = getClusterColor(cluster.getAllChildMarkers());
    const count = cluster.getChildCount();
    return L.divIcon({
      html: '<div style="background:' + color +
        ';opacity:.82;width:34px;height:34px;border-radius:50%;border:2.5px solid #0d1117;' +
        'box-shadow:0 2px 8px rgba(0,0,0,.55);line-height:30px;text-align:center;color:#fff;' +
        'font-family:\'Unbounded\',sans-serif;font-size:11px;font-weight:700;">' + count + '</div>',
      className: '',
      iconSize:   [40, 40],
      iconAnchor: [20, 20],
    });
  },
});
map.addLayer(clusterGroup);

const allPoints    = [];
let   activeAddr   = null;
const markerColorMap = new Map();

const { escapeHtml } = GVS;

// ─── Цвет маркера ────────────────────────────────────────────────────────
function makeIcon(color, approximate) {
  const cls = approximate ? 'mc-dot approximate' : 'mc-dot';
  return L.divIcon({
    className: '',
    html: '<div class="' + cls + '" style="background:' + color + '"></div>',
    iconSize:   [18, 18],
    iconAnchor: [9, 9],
  });
}

const COLOR_PRIORITY = { '#e85d2f': 0, '#d29922': 1, '#58a6ff': 2, '#3fb950': 3, '#7d8590': 4 };

function getClusterColor(children) {
  let best = '#7d8590', bestRank = 99;
  for (const child of children) {
    const c    = markerColorMap.get(child) || '#7d8590';
    const rank = COLOR_PRIORITY[c] !== undefined ? COLOR_PRIORITY[c] : 99;
    if (rank < bestRank) { best = c; bestRank = rank; }
  }
  return best;
}

// ─── Попап ───────────────────────────────────────────────────────────────
function makePopup(pt) {
  let rows = '';
  for (const r of pt.records) {
    const fields = [
      { key: 'repair', label: 'Ремонт',  on: r.repair_on },
      { key: 'hydro1', label: 'Гидро 1', on: r.hydro1_on },
      { key: 'hydro2', label: 'Гидро 2', on: r.hydro2_on },
    ];
    for (const f of fields) {
      const val = r[f.key];
      if (!val) continue;
      const content = GVS.isDateValue(val)
        ? '<div class="popup-dates">' + escapeHtml(val) +
          (f.on ? '<br><span class="popup-on">\u25b2 вода с ' + escapeHtml(f.on) + '</span>' : '') + '</div>'
        : '<div class="popup-note">' + escapeHtml(val) + '</div>';
      rows += '<div class="popup-row"><div class="popup-badge ' + f.key + '">' + f.label + '</div>' + content + '</div>';
    }
  }
  if (!rows) rows = '<div class="popup-dates" style="color:var(--muted);font-style:italic">Нет данных</div>';

  const approxBadge = pt.approximate
    ? '<div class="popup-approx-badge">⚠️ Координаты приблизительны — маркер указывает на улицу, а не на конкретный дом</div>'
    : '';

  return '<div class="popup-inner"><div class="popup-addr">' +
    escapeHtml(pt.address) + '</div>' + rows + approxBadge + '</div>';
}

// ─── Загрузка данных ─────────────────────
function loadData() {
  return Promise.all([
    fetchWithTimeout('data.json', FETCH_TIMEOUT_MS),
    fetchWithTimeout('geo.json',  FETCH_TIMEOUT_MS),
  ]).then(responses => {
    if (!responses[0].ok) throw new Error('data.json: HTTP ' + responses[0].status);
    if (!responses[1].ok) throw new Error('geo.json: HTTP '  + responses[1].status);
    return Promise.all([responses[0].json(), responses[1].json()]);
  }).then(([data, geoDb]) => {
    if (!geoDb || typeof geoDb !== 'object' || !Object.keys(geoDb).length) {
      throw new Error('geo.json пустой или повреждён');
    }

    // Build geo index (normKey sorts tokens for collision-free lookup)
    const geoIdx = {};
    for (const [k, v] of Object.entries(geoDb)) {
      if (v && typeof v.lat === 'number' && typeof v.lng === 'number') {
        geoIdx[normKey(k)] = v;
      }
    }

    // Cache periods upfront
    for (const item of data) {
      GVS.cacheRecordPeriods(item);
    }

    // Group by address
    const byAddr = {};
    for (const item of data) {
      if (!byAddr[item.address]) byAddr[item.address] = [];
      byAddr[item.address].push(item);
    }

    const today = GVS.makeToday();
    let matched = 0, missed = 0;

    for (const [addr, records] of Object.entries(byAddr)) {
      const geo = geoIdx[normKey(addr)];
      if (!geo) { missed++; continue; }
      matched++;

      const color       = GVS.getMapColor(records, today);
      const approximate = geo.approximate === true;
      const pt = {
        address:     addr,
        lat:         geo.lat,
        lng:         geo.lng,
        records,
        approximate,
        _normTokens: GVS.normalizeQuery(addr),
      };

      const marker = L.marker([pt.lat, pt.lng], { icon: makeIcon(color, approximate) });
      markerColorMap.set(marker, color);
      marker.bindPopup(makePopup(pt), { maxWidth: 320 });
      marker.on('click', () => selectAddr(pt.address));
      pt._marker = marker;
      allPoints.push(pt);
    }

    console.info('[map] geo совпало: ' + matched + ', без координат: ' + missed);

    const chip = document.getElementById('counterChip');
    if (missed > 0) {
      chip.title = missed + ' адресов не показаны (нет координат в geo.json)';
    }

    renderAll();
  });
}

// ─── Состояние видимых маркеров для диффного обновления ──────────────────
let _visibleSet = new Set();

// ─── Рендер + ограничение списка ─────────────────────────────────────────
function renderAll() {
  const tokens = GVS.normalizeQuery(document.getElementById('panelSearch').value);
  const fRep   = document.getElementById('fRepair').checked;
  const fH1    = document.getElementById('fHydro1').checked;
  const fH2    = document.getElementById('fHydro2').checked;

  const visiblePts = [];
  const fragment   = document.createDocumentFragment();
  let   listCount  = 0;

  for (const pt of allPoints) {
    const matchSearch = !tokens.length || tokens.every(t =>
      pt._normTokens.some(nt => nt === t || nt.startsWith(t))
    );

    const hasRep = pt.records.some(r => GVS.isDateValue(r.repair));
    const hasH1  = pt.records.some(r => GVS.isDateValue(r.hydro1));
    const hasH2  = pt.records.some(r => GVS.isDateValue(r.hydro2));
    const matchFilter = (fRep && hasRep) || (fH1 && hasH1) || (fH2 && hasH2);

    if (!matchSearch || !matchFilter) continue;

    visiblePts.push(pt);

    if (listCount < MAX_LIST_ITEMS) {
      const item = document.createElement('div');
      item.className  = 'addr-item' + (pt.address === activeAddr ? ' active' : '');
      item.dataset.addr = pt.address;
      item.innerHTML =
        '<div class="addr-street">' + escapeHtml(pt.address) +
        (pt.approximate ? ' <span style="color:var(--muted);font-size:10px">~</span>' : '') +
        '</div>' +
        '<div class="addr-dots">' +
          (hasRep ? '<div class="dot repair"></div>' : '') +
          (hasH1  ? '<div class="dot hydro1"></div>' : '') +
          (hasH2  ? '<div class="dot hydro2"></div>' : '') +
        '</div>';
      item.addEventListener('click', () => {
        selectAddr(pt.address);
        map.setView([pt.lat, pt.lng], MAP_ZOOM_FOCUS, { animate: true });
        if (pt._marker) pt._marker.openPopup();
      });
      fragment.appendChild(item);
      listCount++;
    }
  }

  const visibleAddrs = new Set(visiblePts.map(p => p.address));
  if (activeAddr && !visibleAddrs.has(activeAddr)) {
    activeAddr = null;
  }

  if (visiblePts.length > MAX_LIST_ITEMS) {
    const overflow = document.createElement('div');
    overflow.className   = 'addr-overflow';
    overflow.textContent = '↑ и ещё ' + (visiblePts.length - MAX_LIST_ITEMS) + ' — уточните поиск';
    fragment.appendChild(overflow);
  }

  // Диффное обновление маркеров для предотвращения утечек памяти
  const newSet = new Set(visiblePts.map(p => p._marker));
  const toRemove = [];
  const toAdd    = [];
  _visibleSet.forEach(m => { if (!newSet.has(m)) toRemove.push(m); });
  newSet.forEach(m    => { if (!_visibleSet.has(m)) toAdd.push(m); });
  if (toRemove.length) clusterGroup.removeLayers(toRemove);
  if (toAdd.length)    clusterGroup.addLayers(toAdd);
  
  // Очистка старых ссылок для предотвращения утечек памяти
  _visibleSet.clear();
  newSet.forEach(m => _visibleSet.add(m));

  const listEl = document.getElementById('addrList');
  listEl.innerHTML = '';
  if (visiblePts.length) {
    listEl.appendChild(fragment);
  } else {
    listEl.innerHTML =
      '<div class="empty-list"><span class="big">🔍</span>' +
      'Ничего не найдено. Попробуйте другое написание или воспользуйтесь основным поиском</div>';
  }

  document.getElementById('counterChip').textContent = pluralAddr(visiblePts.length);
}

function selectAddr(address) {
  activeAddr = address;
  document.querySelectorAll('.addr-item').forEach(el => {
    el.classList.toggle('active', el.dataset.addr === address);
    if (el.dataset.addr === address) el.scrollIntoView({ block: 'nearest' });
  });
}

// ─── События ─────────────────────────────────────────────────────────────
let _mapSearchDebounce;
document.getElementById('panelSearch').addEventListener('input', function () {
  document.getElementById('searchClear').classList.toggle('vis', this.value.length > 0);
  clearTimeout(_mapSearchDebounce);
  _mapSearchDebounce = setTimeout(renderAll, 250);
});
document.getElementById('searchClear').addEventListener('click', () => {
  document.getElementById('panelSearch').value = '';
  document.getElementById('searchClear').classList.remove('vis');
  renderAll();
});
['fRepair', 'fHydro1', 'fHydro2'].forEach(id => {
  document.getElementById(id).addEventListener('change', renderAll);
});

// ─── Bottom sheet drag handle (только mobile) ────────────────────────────
(function () {
  const handle = document.getElementById('sheetHandle');
  if (!handle) return; // Защита от отсутствия элемента
  
  const panel  = handle.parentElement;
  const SNAP_RATIOS = [SHEET_SNAP_SMALL, SHEET_SNAP_MEDIUM, SHEET_SNAP_LARGE];
  let dragging = false, startY = 0, startH = 0;
  let resizeTimeout = null;

  function isMobile() { return window.innerWidth <= MOBILE_BREAKPOINT; }

  function snapHeight(h) {
    const vh    = window.innerHeight;
    const snaps = SNAP_RATIOS.map(r => Math.round(vh * r));
    return snaps.reduce((a, b) => Math.abs(b - h) < Math.abs(a - h) ? b : a);
  }

  function onMove(e) {
    if (!dragging) return;
    if (e.cancelable) e.preventDefault();
    const y    = e.touches ? e.touches[0].clientY : e.clientY;
    const newH = startH - (y - startY);
    panel.style.height = Math.min(Math.max(newH, 80), window.innerHeight * 0.88) + 'px';
    panel.style.transition = 'none';
  }

  function onEnd() {
    if (!dragging) return;
    dragging = false;
    panel.style.transition = 'height .3s ease';
    panel.style.height = snapHeight(panel.offsetHeight) + 'px';
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onEnd);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend',  onEnd);
  }

  function onStart(e) {
    if (!isMobile()) return;
    dragging = true;
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    startH = panel.offsetHeight;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend',  onEnd);
  }

  function initHeight() {
    // Debounced resize handler
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      panel.style.height = isMobile()
        ? Math.round(window.innerHeight * SHEET_SNAP_SMALL) + 'px'
        : '';
    }, 150);
  }

  handle.addEventListener('mousedown',  onStart);
  handle.addEventListener('touchstart', onStart, { passive: true });
  
  // Debounced resize listener для корректной работы при изменении размера окна
  let resizeDebounce = null;
  window.addEventListener('resize', () => {
    if (resizeDebounce) clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(initHeight, 200);
  });
  
  initHeight();
}());

// ─── Запуск ──────────────────────────────────────────────────────────────
loadData().catch(err => {
  console.error('[map] loadData failed:', err);
  document.getElementById('addrList').innerHTML =
    '<div class="empty-list"><span class="big">⚠️</span>' +
    'Ошибка загрузки данных.<br>' +
    '<small style="color:var(--muted)">Попробуйте обновить страницу или проверьте соединение.</small>' +
    '<button id="mapRetryBtn" class="map-btn" type="button" style="margin-top:16px">🔄 Попробовать снова</button>' +
    '</div>';
  document.getElementById('counterChip').textContent = 'Ошибка';
  
  // Кнопка retry для карты
  const retryBtn = document.getElementById('mapRetryBtn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      document.getElementById('addrList').innerHTML =
        '<div class="empty-list"><span class="big">⏳</span>Повторная загрузка...</div>';
      loadData().catch(e => location.reload());
    });
  }
});