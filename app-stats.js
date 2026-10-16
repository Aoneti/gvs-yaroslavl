'use strict';
// Блок статистики над поиском. Сам создаёт разметку и стили, данные берёт из data.json.
(function () {
  const anchor = document.querySelector('.search-wrap');
  if (!anchor) return;

  const { dayKey, fromKey } = GVSStats;
  const esc = GVS.escapeHtml;
  const fmt = (k, o) => fromKey(k).toLocaleDateString('ru-RU', o);
  const DM  = { day: 'numeric', month: 'long' };
  const pl  = n => { const a = n % 10, b = n % 100;
    return n + (b > 10 && b < 20 ? ' адресов' : a === 1 ? ' адрес' : a > 1 && a < 5 ? ' адреса' : ' адресов'); };
  const qd  = new URLSearchParams(location.search).get('date');   // ?date=2026-07-15 — проверка вне сезона
  const today    = /^\d{4}-\d{2}-\d{2}$/.test(qd || '') ? fromKey(qd) : GVS.makeToday();
  const todayKey = dayKey(today);

  const css = document.createElement('style');
  css.textContent =
    '#statsPanel.st-loading{min-height:160px}' +
    '.st-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:18px}' +
    '.st-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px}' +
    ".st-num{font-family:'Unbounded',sans-serif;font-size:22px;font-weight:700;line-height:1.1;overflow-wrap:anywhere}" +
    '.st-num.hot{color:var(--accent2)}.st-lbl{font-size:13px;color:var(--muted);margin-top:6px;line-height:1.35}' +
    '.st-tabs{display:flex;gap:6px;margin-bottom:14px}' +
    '.st-tab{background:var(--surface);border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:8px 14px;font:inherit;font-size:13px;cursor:pointer}' +
    '.st-tab:hover{border-color:var(--accent);color:var(--text)}' +
    '.st-tab[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#fff}' +
    '.st-months{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}' +
    '.st-mt{font-size:13px;font-weight:600;margin-bottom:6px;text-transform:capitalize}' +
    '.st-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}' +
    '.st-day{aspect-ratio:1;display:flex;align-items:center;justify-content:center;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--muted);font:inherit;font-size:11px;padding:0}' +
    'button.st-day{color:var(--text);cursor:pointer}button.st-day:hover{border-color:var(--accent)}' +
    '.st-day.today{border-style:dashed;border-color:var(--text)}.st-day.sel{outline:2px solid var(--accent);outline-offset:1px}' +
    '.st-chart{width:100%;height:auto;display:block}.st-hit{fill:transparent;cursor:pointer}' +
    '.st-hit:hover{fill:rgba(128,128,128,.15)}.st-hit.sel{fill:rgba(232,93,47,.22)}' +
    '.st-legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-top:8px}' +
    '.st-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}' +
    '.st-tbl-wrap{max-height:360px;overflow:auto;border:1px solid var(--border);border-radius:12px}' +
    '.st-tbl{width:100%;border-collapse:collapse;font-size:13px}' +
    '.st-tbl th,.st-tbl td{padding:8px 12px;text-align:right;border-bottom:1px solid var(--border)}' +
    '.st-tbl th:first-child,.st-tbl td:first-child{text-align:left}' +
    '.st-tbl th{position:sticky;top:0;background:var(--surface2);color:var(--muted);font-weight:600}' +
    '.st-tbl tbody tr{cursor:pointer}.st-tbl tbody tr:hover,.st-tbl tr.sel{background:var(--surface2)}' +
    '.st-dayinfo{margin-top:16px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px}' +
    '.st-dayinfo h3{font-size:15px;margin-bottom:10px}.st-addrs{display:flex;flex-wrap:wrap;gap:6px;max-height:220px;overflow:auto}' +
    '.st-addr{background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 10px;font:inherit;font-size:12px;cursor:pointer}' +
    '.st-addr:hover{border-color:var(--accent)}.st-more{font-size:12px;color:var(--muted);margin-top:8px}';
  document.head.appendChild(css);

  const panel = document.createElement('section');
  panel.id = 'statsPanel';
  panel.className = 'st-loading';
  panel.setAttribute('aria-label', 'Статистика отключений по городу');
  anchor.parentNode.insertBefore(panel, anchor);

  fetch('data.json')
    .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
    .then(data => init(GVSStats.compute(data.filter(d => d && d.address), today)))
    .catch(err => { console.warn('[stats]', err); panel.remove(); });

  function init(S) {
    if (!S.peak) { panel.remove(); return; }
    let view = 'cal', sel = null;
    const cnt  = (k, t) => { const b = S.days.get(k); return b ? b[t].size : 0; };
    const card = (n, l, hot) => '<div class="st-card"><div class="st-num' + (hot ? ' hot' : '') + '">' + n + '</div><div class="st-lbl">' + l + '</div></div>';

    const views = {
      cal() {
        const first = fromKey(S.keys[0]), last = fromKey(S.keys[S.keys.length - 1]);
        let html = '';
        for (let m = new Date(first.getFullYear(), first.getMonth(), 1); m <= last; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
          const n = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
          html += '<div><div class="st-mt">' + m.toLocaleDateString('ru-RU', { month: 'long' }) + ' ' + m.getFullYear() + '</div><div class="st-grid">';
          for (let d = 1; d <= n; d++) {
            const k = dayKey(new Date(m.getFullYear(), m.getMonth(), d)), c = cnt(k, 'all');
            const st = (d === 1 ? 'grid-column-start:' + (((m.getDay() + 6) % 7) + 1) + ';' : '') +
                       (c ? 'background:rgba(232,93,47,' + (0.15 + 0.7 * c / S.peak.count).toFixed(2) + ');' : '');
            const cls = 'st-day' + (k === todayKey ? ' today' : '') + (k === sel ? ' sel' : '');
            html += c
              ? '<button type="button" class="' + cls + '" data-k="' + k + '" style="' + st + '" title="' + fmt(k, DM) + ': ' + pl(c) + '">' + d + '</button>'
              : '<span class="' + cls + '" style="' + st + '">' + d + '</span>';
          }
          html += '</div></div>';
        }
        return '<div class="st-months">' + html + '</div>';
      },

      chart() {
        const W = 640, H = 220, L = 34, R = 8, T = 10, B = 22, n = S.keys.length;
        const max = Math.max(1, ...S.keys.map(k => Math.max(cnt(k, 'repair'), cnt(k, 'hydro'))));
        const x = i => L + i * (W - L - R) / Math.max(1, n - 1);
        const y = v => T + (H - T - B) * (1 - v / max);
        const line = (t, c) => '<polyline fill="none" stroke-width="2" style="stroke:' + c + '" points="' +
          S.keys.map((k, i) => x(i).toFixed(1) + ',' + y(cnt(k, t)).toFixed(1)).join(' ') + '"/>';
        const bw = Math.max(2, (W - L - R) / n);
        const hits = S.keys.map((k, i) => '<rect class="st-hit' + (k === sel ? ' sel' : '') + '" data-k="' + k + '" x="' + (x(i) - bw / 2).toFixed(1) +
          '" y="' + T + '" width="' + bw.toFixed(1) + '" height="' + (H - T - B) + '"><title>' + fmt(k, DM) + ': ремонт ' + cnt(k, 'repair') +
          ', гидроиспытания ' + cnt(k, 'hydro') + '</title></rect>').join('');
        const ti = S.keys.indexOf(todayKey);
        return '<svg class="st-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Адресов с отключениями по дням">' +
          '<g style="stroke:var(--border)"><line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0) + '" y2="' + y(0) + '"/>' +
          '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(max) + '" y2="' + y(max) + '" stroke-dasharray="3 4"/></g>' +
          (ti >= 0 ? '<line x1="' + x(ti) + '" x2="' + x(ti) + '" y1="' + T + '" y2="' + (H - B) + '" stroke-dasharray="4 3" style="stroke:var(--text)"/>' : '') +
          line('repair', 'var(--accent)') + line('hydro', 'var(--blue)') +
          '<g font-size="11" style="fill:var(--muted)"><text x="' + (L - 6) + '" y="' + (y(max) + 4) + '" text-anchor="end">' + max + '</text>' +
          '<text x="' + (L - 6) + '" y="' + (y(0) + 4) + '" text-anchor="end">0</text>' +
          '<text x="' + L + '" y="' + (H - 6) + '">' + fmt(S.keys[0], DM) + '</text>' +
          '<text x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end">' + fmt(S.keys[n - 1], DM) + '</text></g>' + hits + '</svg>' +
          '<div class="st-legend"><span><i style="background:var(--accent)"></i>Ремонт</span><span><i style="background:var(--blue)"></i>Гидроиспытания</span>' +
          '<span>Адрес, у которого в один день и ремонт, и гидроиспытания, учтён в обеих линиях</span></div>';
      },

      table() {
        const rows = S.keys.filter(k => cnt(k, 'all')).map(k =>
          '<tr data-k="' + k + '"' + (k === sel ? ' class="sel"' : '') + '><td>' + fmt(k, { weekday: 'short', day: 'numeric', month: 'short' }) +
          '</td><td>' + cnt(k, 'all') + '</td><td>' + cnt(k, 'repair') + '</td><td>' + cnt(k, 'hydro1') + '</td><td>' + cnt(k, 'hydro2') + '</td></tr>').join('');
        return '<div class="st-tbl-wrap"><table class="st-tbl"><thead><tr><th>Дата</th><th>Адресов</th><th>Ремонт</th><th>Гидро 1</th><th>Гидро 2</th></tr></thead><tbody>' +
          rows + '</tbody></table></div>';
      },
    };

    panel.className = '';
    panel.innerHTML =
      '<div class="st-cards">' +
        card(S.activeToday, 'адресов без ГВС сегодня', S.activeToday > 0) +
        card(S.startingSoon, 'начнутся в ближайшие ' + GVS.SOON_DAYS + ' дней') +
        card(S.total, 'адресов в графике') +
        card(fmt(S.peak.key, { day: 'numeric', month: 'short' }), 'пик отключений: ' + pl(S.peak.count)) +
      '</div>' +
      '<div class="st-tabs" role="group" aria-label="Вид">' +
        [['cal', 'Календарь'], ['chart', 'График'], ['table', 'Таблица']].map(([v, t]) =>
          '<button class="st-tab" type="button" data-v="' + v + '">' + t + '</button>').join('') +
      '</div><div id="stView"></div><div id="stDay"></div>';

    function renderView() {
      document.getElementById('stView').innerHTML = views[view]();
      panel.querySelectorAll('.st-tab').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === view)));
    }

    function drawer() {
      const box = document.getElementById('stDay');
      if (!sel) { box.innerHTML = ''; return; }
      const list = [...S.days.get(sel).all].sort((a, b) => a.localeCompare(b, 'ru'));
      box.innerHTML = '<div class="st-dayinfo"><h3>' + fmt(sel, DM) + ': ' + pl(list.length) + ' без горячей воды</h3><div class="st-addrs">' +
        list.slice(0, 200).map(a => '<button type="button" class="st-addr" data-a="' + esc(a) + '">' + esc(a) + '</button>').join('') + '</div>' +
        (list.length > 200 ? '<div class="st-more">Показаны первые 200 — остальные найдите через поиск ниже</div>' : '') + '</div>';
    }

    function pick(k) {
      sel = sel === k ? null : k;
      panel.querySelectorAll('#stView [data-k]').forEach(el => el.classList.toggle('sel', el.dataset.k === sel));
      drawer();
    }

    panel.addEventListener('click', e => {
      const tab = e.target.closest('.st-tab');
      if (tab) { view = tab.dataset.v; renderView(); return; }
      const day = e.target.closest('[data-k]');
      if (day) { pick(day.dataset.k); return; }
      const a = e.target.closest('.st-addr');
      if (a) {                                   // подставляем адрес в обычный поиск
        const input = document.getElementById('searchInput');
        input.value = a.dataset.a;
        input.dispatchEvent(new Event('input'));
        anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    renderView();
  }
}());
