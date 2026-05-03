'use strict';

// ─── fetch с таймаутом и retry ────────────────────────
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
      
      // Retry
      if (retryCount < GVS_CONFIG.FETCH_RETRY_COUNT) {
        const delay = GVS_CONFIG.FETCH_RETRY_DELAY * Math.pow(2, retryCount);
        console.warn(`[fetch] Попытка ${retryCount + 1} не удалась, повтор через ${delay}мс:`, url);
        return new Promise(resolve => setTimeout(resolve, delay))
          .then(() => fetchWithTimeout(url, timeoutMs, retryCount + 1));
      }
      
      throw err;
    });
}

// ─── Тема ───────────────────────────────────────────────────────────────
document.getElementById('themeToggle').addEventListener('click', () => {
  const isLight = document.documentElement.classList.toggle('light');
  try { localStorage.setItem('theme', isLight ? 'light' : 'dark'); } catch (e) {}
});

// ─── Состояние ──────────────────────────────────────────────────────────
const PER_PAGE = GVS_CONFIG.PER_PAGE;

let DATA          = [];
let filtered      = [];
let currentPage   = 1;
let currentTokens = [];

// ─── DOM ────────────────────────────────────────────────────────────────
const searchInput  = document.getElementById('searchInput');
const clearBtn     = document.getElementById('clearBtn');
const resultsEl    = document.getElementById('results');
const statsBar     = document.getElementById('statsBar');
const foundCount   = document.getElementById('foundCount');
const paginationEl = document.getElementById('pagination');

// ─── Подсветка совпадений ───────────────────────────────────────────────
function hl(text, tokens) {
  if (!tokens || !tokens.length) return GVS.escapeHtml(text);

  const ranges = [];
  for (const token of tokens) {
    if (!token) continue;
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      ranges.push([m.index, m.index + m[0].length]);
    }
  }

  if (!ranges.length) return GVS.escapeHtml(text);

  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0]];
  for (let j = 1; j < ranges.length; j++) {
    const prev = merged[merged.length - 1];
    if (ranges[j][0] <= prev[1]) prev[1] = Math.max(prev[1], ranges[j][1]);
    else merged.push(ranges[j]);
  }

  // Безопасная вставка через DOM-элементы
  const container = document.createElement('span');
  let pos = 0;
  for (const [start, end] of merged) {
    container.appendChild(document.createTextNode(text.slice(pos, start)));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(start, end);
    container.appendChild(mark);
    pos = end;
  }
  container.appendChild(document.createTextNode(text.slice(pos)));
  return container.innerHTML;
}

// ─── Рендер одного блока периода ────────────────────────────────────────
function renderPeriodItem(type, label, rangeStr, onStr, isActive) {
  if (!rangeStr) return '';
  const isDate     = GVS.isDateValue(rangeStr);
  const activeClass = isActive ? ' period-active' : '';
  const inner = isDate
    ? '<div class="period-dates">' + GVS.escapeHtml(rangeStr) + '</div>' +
      (onStr ? '<div class="period-on">\u25b2 вода с ' + GVS.escapeHtml(onStr) + '</div>' : '')
    : '<div class="period-note">' + GVS.escapeHtml(rangeStr) + '</div>';
  return '<div class="period-item ' + type + activeClass + '">' +
    '<div class="period-label">' + label + '</div>' +
    inner +
    '</div>';
}

// ─── Карточка адреса ─────────────────────────────────────────────────────
function renderCard(d, tokens, today) {
  const status           = GVS.getStatus(d, today);
  const daysInfo         = GVS.getDaysInfo(d, today);
  const activePeriodType = GVS.getActivePeriodType(d, today);

  let unifiedBadge = '';
  if (status === 'active' && daysInfo) {
    const numLabel = daysInfo.days <= 0 ? 'сегодня'
                   : daysInfo.days === 1 ? '1 день'
                   : daysInfo.days + ' дн.';
    unifiedBadge = '<div class="status-block active">' +
      '<span class="status-num">'   + numLabel    + '</span>' +
      '<span class="status-label">Нет воды</span>' +
      '</div>';
  } else if (status === 'soon' && daysInfo) {
    const numLabelSoon = daysInfo.days === 1 ? 'завтра' : 'через ' + daysInfo.days + ' дн.';
    unifiedBadge = '<div class="status-block soon">' +
      '<span class="status-num">'   + numLabelSoon + '</span>' +
      '<span class="status-label">Скоро</span>' +
      '</div>';
  } else if (status === 'past') {
    unifiedBadge = '<div class="status-block past">' +
      '<span class="status-label">Завершено</span>' +
      '</div>';
  }

  const cardClass = status === 'active' ? ' status-active'
                  : status === 'past'   ? ' status-past' : '';

  const periodsHtml = [
    renderPeriodItem('repair', 'Текущий ремонт',   d.repair, d.repair_on, activePeriodType === 'repair'),
    renderPeriodItem('hydro1', 'Гидроиспытания 1', d.hydro1, d.hydro1_on, activePeriodType === 'hydro1'),
    renderPeriodItem('hydro2', 'Гидроиспытания 2', d.hydro2, d.hydro2_on, activePeriodType === 'hydro2'),
  ].filter(Boolean).join('') || '<div class="period-empty">Нет данных о периодах</div>';

  return '<div class="result-card' + cardClass + '">' +
    '<div class="card-header">' +
      '<div class="address-badge">' + hl(d.address, tokens) + '</div>' +
      unifiedBadge +
    '</div>' +
    '<div class="periods-grid">' + periodsHtml + '</div>' +
    (d.source ? '<div class="card-footer"><span class="source-tag">🏘️ ' + GVS.escapeHtml(d.source) + '</span></div>' : '') +
    '</div>';
}

// ─── Рендер страницы результатов ────────────────────────────────────────
function renderPage(tokens) {
  const today = GVS.makeToday();
  const start = (currentPage - 1) * PER_PAGE;
  const page  = filtered.slice(start, start + PER_PAGE);

  resultsEl.innerHTML = page.length
    ? page.map(d => renderCard(d, tokens, today)).join('')
    : '<div class="state-message">' +
        '<span class="emoji">🤔</span>' +
        '<h3>Ничего не найдено</h3>' +
        '<p>Попробуйте другое написание адреса</p>' +
      '</div>';

  renderPagination();
}

// ─── Пагинация ───────────────────────────────────────────────────────────
function renderPagination() {
  const total = Math.ceil(filtered.length / PER_PAGE);
  if (total <= 1) { paginationEl.style.display = 'none'; return; }

  paginationEl.style.display = 'flex';
  let pages = [];
  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i);
  } else {
    pages = [1];
    if (currentPage > 3) pages.push('…');
    for (let p = Math.max(2, currentPage - 1); p <= Math.min(total - 1, currentPage + 1); p++) pages.push(p);
    if (currentPage < total - 2) pages.push('…');
    pages.push(total);
  }

  let html = '<button class="page-btn" type="button" data-page="' + (currentPage - 1) + '" ' +
    (currentPage === 1 ? 'disabled' : '') + '>← Назад</button>';
  for (const p of pages) {
    html += p === '…'
      ? '<span class="page-info">…</span>'
      : '<button class="page-btn ' + (p === currentPage ? 'active' : '') + '" type="button" data-page="' + p + '">' + p + '</button>';
  }
  html += '<button class="page-btn" type="button" data-page="' + (currentPage + 1) + '" ' +
    (currentPage === total ? 'disabled' : '') + '>Вперёд →</button>';
  html += '<span class="page-info">' + currentPage + ' / ' + total + '</span>';
  paginationEl.innerHTML = html;
}

function goPage(n) {
  const total = Math.ceil(filtered.length / PER_PAGE);
  currentPage = Math.max(1, Math.min(n, total));
  renderPage(currentTokens);
  
  // Учёт высоты хедера
  const header = document.querySelector('header');
  const offset = header ? header.offsetHeight : 0;
  window.scrollTo({ 
    top: offset, 
    behavior: 'smooth' 
  });
}

// ─── Поиск ───────────────────────────────────────────────────────────────
function applySearch() {
  const raw = searchInput.value.trim();
  clearBtn.classList.toggle('visible', raw.length > 0);

  if (!raw) {
    currentTokens = [];
    filtered = [];
    resultsEl.innerHTML = '<div class="state-message">' +
      '<span class="emoji">🏡</span>' +
      '<h3>Найдите свой адрес</h3>' +
      '<p>Введите улицу и номер дома — покажем даты отключения горячей воды</p>' +
      '</div>';
    statsBar.style.display  = 'none';
    paginationEl.style.display = 'none';
    return;
  }

  currentTokens = GVS.normalizeQuery(raw);

  filtered = DATA.filter(d =>
    currentTokens.every(token =>
      d._normTokens.some(t => t === token || t.startsWith(token))
    )
  );

  currentPage = 1;
  statsBar.style.display = 'flex';
  foundCount.textContent = filtered.length;
  renderPage(currentTokens);
}

// ─── События ─────────────────────────────────────────────────────────────
let _searchDebounce;
searchInput.addEventListener('input', () => {
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(applySearch, 250);
});

paginationEl.addEventListener('click', e => {
  const btn = e.target.closest('[data-page]');
  if (btn && !btn.disabled) goPage(+btn.dataset.page);
});

clearBtn.addEventListener('click', () => {
  searchInput.value = '';
  applySearch();
  searchInput.focus();
});

// ─── Загрузка data.json ─────────────────
resultsEl.innerHTML = '<div class="state-message">' +
  '<span class="emoji">⏳</span>' +
  '<h3>Загрузка данных…</h3>' +
  '<p>Подождите секунду</p>' +
  '</div>';

fetchWithTimeout('data.json', GVS_CONFIG.FETCH_TIMEOUT_MS)
  .then(r => r.json())
  .then(json => {
    if (!Array.isArray(json)) {
      throw new Error('data.json должен содержать массив');
    }
    
    DATA = json.map(d => {
      if (!d || typeof d !== 'object') {
        console.warn('[index] Пропущена некорректная запись:', d);
        return null;
      }
      if (!d.address || typeof d.address !== 'string') {
        console.warn('[index] Запись без адреса:', d);
        return null;
      }
      GVS.cacheRecordPeriods(d);
      d._normTokens = GVS.normalizeQuery(d.address);
      return d;
    }).filter(Boolean); // Удаляем null-записи

    if (searchInput.value.trim()) {
      applySearch();
    } else {
      resultsEl.innerHTML = '<div class="state-message">' +
        '<span class="emoji">🏡</span>' +
        '<h3>Найдите свой адрес</h3>' +
        '<p>Введите улицу и номер дома — покажем даты отключения горячей воды</p>' +
        '</div>';
    }
  })
  .catch(err => {
    console.error('[index] data.json load failed:', err);
    resultsEl.innerHTML = '<div class="state-message">' +
      '<span class="emoji">❌</span>' +
      '<h3>Не удалось загрузить данные</h3>' +
      '<p>Попробуйте обновить страницу. Если ошибка повторяется — проверьте соединение.</p>' +
      '<button id="retryBtn" class="map-btn" type="button" style="margin-top:16px">🔄 Попробовать снова</button>' +
      '</div>';
    
    // Кнопка retry
    const retryBtn = document.getElementById('retryBtn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        resultsEl.innerHTML = '<div class="state-message">' +
          '<span class="emoji">⏳</span>' +
          '<h3>Повторная загрузка…</h3>' +
          '</div>';
        location.reload();
      });
    }
  });
