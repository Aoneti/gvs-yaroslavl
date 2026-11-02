'use strict';
// Страница «Аварии и отключения ЖКХ»: читает incidents.json (его обновляет GitHub Actions)
// и рисует таблицы по разделам с поиском по адресу и фильтром «аварии / плановые».
// Зависит от config.js и gvs-core.js (GVS.escapeHtml, GVS.normalizeQuery).
(function () {
  const CFG         = window.GVS_CONFIG || {};
  const DATA_URL    = CFG.INCIDENTS_URL || 'incidents.json';  // относительный путь: сайт в подпапке /gvs-yaroslavl/
  const STALE_HOURS = CFG.INCIDENTS_STALE_HOURS || 30;
  const SOURCE_URL  = 'https://moydom-yaroslavl.ru/incident';
  const LABEL_EMERGENCY = 'авария';

  const esc = GVS.escapeHtml;
  const $   = (id) => document.getElementById(id);
  const el  = {
    lead:    $('lead'),
    stale:   $('staleAlert'),
    input:   $('info-filter-input'),
    clear:   $('clearBtn'),
    types:   $('typeFilter'),
    count:   $('filterCount'),
    jump:    $('jump'),
    results: $('results'),
  };

  let data = null;                           // содержимое incidents.json
  const state = { q: '', type: 'all' };      // type: all | emergency | planned

  // ─── Тема ────────────────────────────────────────────────────────────
  $('themeToggle').addEventListener('click', () => {
    const isLight = document.documentElement.classList.toggle('light');
    try { localStorage.setItem('theme', isLight ? 'light' : 'dark'); } catch (e) {}
  });

  // ─── Мелкие помощники ────────────────────────────────────────────────
  /** plural(5, ['отключение', 'отключения', 'отключений']) → «отключений» */
  const plural = (n, [one, few, many]) => {
    const a = n % 10, b = n % 100;
    return b > 10 && b < 20 ? many : a === 1 ? one : a > 1 && a < 5 ? few : many;
  };

  const MSK = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });

  /** Текст → токены для поиска. Знаки «: ; ( )» и «ё» убираем, остальное делает GVS.normalizeQuery. */
  const norm = (s) => GVS.normalizeQuery(
    String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[:;()«»"]/g, ' ')
  );

  /** Каждый токен запроса — начало какого-нибудь слова записи (как в поиске на главной). */
  const matches = (tokens, hay) =>
    tokens.every((t) => hay.some((h) => h === t || h.startsWith(t)));

  /** Подсветка совпадений. Работает по сырому тексту, каждый кусок экранируется отдельно. */
  function highlight(text, tokens) {
    if (!tokens.length) return esc(text);
    const pattern = tokens.slice()
      .sort((a, b) => b.length - a.length)
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/е/g, '[её]'))
      .join('|');
    // Подсвечиваем только начало слова — так же, как работает сам поиск.
    // Без lookbehind: он не поддерживается в Safari старше 16.4.
    const re = new RegExp('(^|[^\\p{L}\\p{N}])(' + pattern + ')', 'giu');
    let out = '', last = 0, m;
    while ((m = re.exec(text))) {
      const start = m.index + m[1].length;
      out += esc(text.slice(last, start)) + '<mark>' + esc(m[2]) + '</mark>';
      last = start + m[2].length;
    }
    return out + esc(text.slice(last));
  }

  const isHttps = (u) => /^https:\/\//i.test(u || '');

  // ─── Загрузка данных ─────────────────────────────────────────────────
  /** fetch с таймаутом и повторами; cache: 'no-cache' — браузер всегда сверяется с сервером (304 дёшево). */
  async function fetchJson(url, attempt = 0) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CFG.FETCH_TIMEOUT_MS || 12000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      if (attempt < (CFG.FETCH_RETRY_COUNT || 2)) {
        await new Promise((r) => setTimeout(r, (CFG.FETCH_RETRY_DELAY || 1000) * Math.pow(2, attempt)));
        return fetchJson(url, attempt + 1);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Проверяет формат и один раз считает поисковые токены для каждой записи. */
  function prepare(json) {
    if (!json || !Array.isArray(json.groups)) throw new Error('Неожиданный формат incidents.json');
    for (const g of json.groups) {
      for (const it of g.items) {
        it._kind = it.typeLabel === LABEL_EMERGENCY ? 'emergency' : 'planned';
        it._hay  = norm([it.address, it.addressFull, it.typeDescription, it.typeLabel, g.name].join(' '));
        it._addr = norm(it.address);   // чтобы понять, совпало ли в сокращённом адресе или только в полном списке
      }
    }
    return json;
  }

  // ─── Разметка ────────────────────────────────────────────────────────
  /** «с 26 октября, 09:00 по 30 октября, 23:55» → две строки; плюс пометка, если срок уже вышел. */
  function termHtml(it) {
    if (!it.dateInterval) return '<span class="info-muted">—</span>';
    const parts = it.dateInterval.split(/\s+(?=(?:до|по)\s)/);
    const overdue = it.endTs && it.endTs * 1000 < Date.now()
      ? '<div class="info-overdue" title="Плановое время окончания прошло, но запись ещё не закрыта">срок истёк</div>'
      : '';
    return parts.map((p) => '<span>' + esc(p) + '</span>').join('') + overdue;
  }

  /** Контакты построчно (по подрядчику в строке), телефоны — ссылки tel:. */
  function contactsHtml(it) {
    if (!it.contacts) return '<span class="info-muted">—</span>';
    // Делим до экранирования: в «&quot;» тоже есть «;», его резать нельзя
    return it.contacts.split('; ').map((part) => {
      let html = esc(part);
      for (const phone of it.phones || []) {
        const href = 'tel:' + phone.replace(/[^\d+]/g, '');
        html = html.split(esc(phone)).join('<a href="' + href + '">' + esc(phone) + '</a>');
      }
      return html;
    }).join('<br>');
  }

  /** Сокращённый адрес («… и ещё 9 улиц») — под ним сворачиваемый полный список. */
  function moreHtml(it, tokens) {
    if (!it.addressFull) return '';
    // Если запрос нашёлся только внутри полного списка — раскрываем его сразу, чтобы было видно почему.
    const open = tokens.length && !matches(tokens, it._addr) ? ' open' : '';
    return '<details class="info-more"' + open + '><summary>Все адреса</summary><p>' +
      highlight(it.addressFull, tokens) + '</p></details>';
  }

  function rowHtml(it, tokens) {
    const emergency = it._kind === 'emergency';
    const addr = highlight(it.address, tokens);
    const addrHtml = isHttps(it.url)
      ? '<a href="' + esc(it.url) + '" target="_blank" rel="noopener noreferrer" title="Открыть запись на сайте «Мой Дом»">' + addr + '</a>'
      : addr;

    return '<tr role="row" class="' + (emergency ? 'is-emergency' : 'is-planned') + '">' +
      '<td role="cell" class="info-addr">' + addrHtml + moreHtml(it, tokens) + '</td>' +
      '<td role="cell" class="info-kind">' +
        '<span class="info-badge info-badge--' + (emergency ? 'emergency' : 'planned') + '">' + esc(it.typeLabel) + '</span>' +
        (it.typeDescription ? '<div class="info-muted">' + esc(it.typeDescription) + '</div>' : '') +
      '</td>' +
      '<td role="cell" class="info-term" data-label="Срок">' + termHtml(it) + '</td>' +
      '<td role="cell" class="info-contacts" data-label="Контакты">' + contactsHtml(it) + '</td>' +
    '</tr>';
  }

  function blockHtml(group, index, tokens) {
    // Огонёк — у разделов про горячую воду: сайт именно про неё
    const flame = /горяч/i.test(group.name) ? '<span class="info-flame" aria-hidden="true">🔥</span>' : '';
    const head = ['Адрес', 'Вид', 'Срок', 'Контакты']
      .map((h) => '<th role="columnheader" scope="col">' + h + '</th>').join('');

    return '<section class="info-block" id="group-' + index + '">' +
      '<h2>' + flame + esc(group.name) + ' <span class="info-muted">(' + group.items.length + ')</span></h2>' +
      '<div class="info-table-wrap"><table class="info-table" role="table">' +
        '<thead role="rowgroup"><tr role="row">' + head + '</tr></thead>' +
        '<tbody role="rowgroup">' + group.items.map((it) => rowHtml(it, tokens)).join('') + '</tbody>' +
      '</table></div></section>';
  }

  /** Почему пусто: в источнике ничего нет / запрос не нашёл / запрос нашёл, но в другой категории. */
  function emptyHtml(counts) {
    const box = (emoji, title, text, btn) =>
      '<div class="state-message"><span class="emoji">' + emoji + '</span><h3>' + title + '</h3><p>' + text + '</p>' + (btn || '') + '</div>';
    const button = (action, label) => '<button class="info-btn" type="button" data-action="' + action + '">' + label + '</button>';

    if (!data.total) {
      return box('✅', 'Сейчас всё спокойно', 'В источнике нет действующих аварий и плановых отключений.');
    }
    const q = state.q ? '«' + esc(state.q) + '»' : '';
    // Запрос что-то находит, но не в выбранной категории — подскажем, где искать
    if (state.type !== 'all' && counts.all > 0) {
      return box('🔎', 'В этой категории пусто',
        (q ? 'По запросу ' + q + ' ' : 'Здесь ') + 'ничего нет, но в другой категории записи есть (' + counts.all + ').',
        button('all-types', 'Показать все'));
    }
    if (!state.q) {
      return box('🔎', 'В этой категории пусто', 'Сейчас здесь нет записей.', button('all-types', 'Показать все'));
    }
    return box('🤔', 'Ничего не найдено',
      'По запросу ' + q + ' записей нет. Проверьте написание. Отсутствие адреса в списке не гарантирует, ' +
      'что отключений нет, — уточните в управляющей компании.',
      button('reset', 'Сбросить поиск'));
  }

  // ─── Отрисовка ───────────────────────────────────────────────────────
  function leadHtml() {
    const t = Date.parse(data.fetchedAt);
    const when = Number.isFinite(t)
      ? ' Данные проверены <time datetime="' + esc(data.fetchedAt) + '">' + MSK.format(t) + '</time> (мск).'
      : '';
    if (!data.total) return 'Сейчас в источнике нет действующих отключений.' + when;
    return 'Сейчас в Ярославле действует <b>' + data.total + ' ' +
      plural(data.total, ['отключение', 'отключения', 'отключений']) + '</b>: аварий — ' +
      data.emergency + ', плановых работ — ' + data.planned + '.' + when;
  }

  /** Плашка, если GitHub Actions давно не обновлял файл (например, источник недоступен). */
  function staleHtml() {
    const t = Date.parse(data.fetchedAt);
    if (!Number.isFinite(t)) return '';
    const hours = (Date.now() - t) / 36e5;
    if (hours < STALE_HOURS) return '';
    const ago = hours < 48
      ? Math.round(hours) + ' ' + plural(Math.round(hours), ['час', 'часа', 'часов'])
      : Math.round(hours / 24) + ' ' + plural(Math.round(hours / 24), ['день', 'дня', 'дней']);
    return '<div class="info-alert" role="status"><b>Данные могли устареть:</b> список обновлялся ' + ago +
      ' назад. Актуальные сведения — на сайте «<a href="' + SOURCE_URL +
      '" target="_blank" rel="noopener noreferrer">Мой Дом</a>».</div>';
  }

  const TYPE_BUTTONS = [['all', 'Все'], ['emergency', 'Аварии'], ['planned', 'Плановые']];

  function buildTypeFilter() {
    el.types.innerHTML = TYPE_BUTTONS.map(([key, label]) =>
      '<button type="button" data-type="' + key + '" aria-pressed="false">' + label + ' <span class="n"></span></button>'
    ).join('');
  }

  /** Обновляет кнопки на месте (а не пересоздаёт), чтобы не терять фокус с клавиатуры. */
  function updateTypeFilter(counts) {
    el.types.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.type === state.type));
      b.querySelector('.n').textContent = counts[b.dataset.type];
    });
  }

  function syncUrl() {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.type !== 'all') p.set('type', state.type);
    const qs = p.toString();
    try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '')); } catch (e) {}
  }

  function render() {
    const tokens = norm(state.q);

    // Счётчики на кнопках типа учитывают поиск, но не сам выбранный тип
    const counts = { all: 0, emergency: 0, planned: 0 };
    const groups = [];
    for (const g of data.groups) {
      const items = [];
      for (const it of g.items) {
        if (!matches(tokens, it._hay)) continue;
        counts.all++; counts[it._kind]++;
        if (state.type === 'all' || state.type === it._kind) items.push(it);
      }
      if (items.length) groups.push({ name: g.name, items });
    }
    const shown = groups.reduce((n, g) => n + g.items.length, 0);

    updateTypeFilter(counts);
    el.count.textContent = (state.q || state.type !== 'all') ? 'Найдено: ' + shown : '';
    el.clear.classList.toggle('visible', state.q.length > 0);

    el.jump.hidden = groups.length < 2;
    el.jump.innerHTML = groups.map((g, i) =>
      '<button type="button" data-target="group-' + i + '">' + esc(g.name) + ' <span class="n">' + g.items.length + '</span></button>'
    ).join('');

    el.results.innerHTML = groups.length
      ? groups.map((g, i) => blockHtml(g, i, tokens)).join('')
      : emptyHtml(counts);

    syncUrl();
  }

  function showError(err) {
    console.error('[incidents] не удалось загрузить данные:', err);
    el.types.innerHTML = '';
    el.jump.hidden = true;
    el.results.innerHTML = '<div class="state-message"><span class="emoji">❌</span>' +
      '<h3>Не удалось загрузить данные</h3>' +
      '<p>Попробуйте обновить страницу. Актуальный список всегда есть на сайте «<a href="' + SOURCE_URL +
      '" target="_blank" rel="noopener noreferrer">Мой Дом</a>».</p>' +
      '<button class="info-btn" type="button" data-action="retry">Попробовать снова</button></div>';
  }

  function load() {
    el.results.innerHTML = '<div class="state-message"><span class="emoji">⏳</span><h3>Загрузка данных…</h3><p>Подождите секунду</p></div>';
    return fetchJson(DATA_URL)
      .then((json) => {
        data = prepare(json);
        el.lead.innerHTML  = leadHtml();
        el.stale.innerHTML = staleHtml();
        buildTypeFilter();
        render();
      })
      .catch(showError);
  }

  // ─── События ─────────────────────────────────────────────────────────
  let debounce;
  el.input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.q = el.input.value.trim().slice(0, 100);
      if (data) render();
    }, 150);
  });

  function clearSearch() {
    el.input.value = '';
    state.q = '';
    if (data) render();
  }

  el.clear.addEventListener('click', () => { clearSearch(); el.input.focus(); });
  el.input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && el.input.value) clearSearch(); });

  el.types.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-type]');
    if (!btn) return;
    state.type = btn.dataset.type;
    render();
  });

  el.jump.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-target]');
    const target = btn && $(btn.dataset.target);
    if (!target) return;
    const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  });

  el.results.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'retry') { load(); return; }
    if (action === 'all-types') { state.type = 'all'; render(); return; }
    if (action === 'reset') { state.type = 'all'; clearSearch(); }
  });

  // ─── Старт ───────────────────────────────────────────────────────────
  // Состояние из адреса: ?q=урицкого&type=emergency — этой ссылкой можно поделиться
  const params = new URLSearchParams(location.search);
  state.q = (params.get('q') || '').trim().slice(0, 100);
  if (['emergency', 'planned'].includes(params.get('type'))) state.type = params.get('type');
  el.input.value = state.q;

  load();
}());
