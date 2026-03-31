'use strict';

const GVS = (() => {

  // ─── Константы ──────────────────────────────────────────────
  const PER_PAGE  = 20;   // карточек на странице
  const SOON_DAYS = 7;    // дней вперёд → статус «скоро»

  // ─── Детектор значений-дат vs текстовых заметок ─────────────
  // Период считается датой, если начинается с цифры (день месяца).
  const DATE_PERIOD_RE = /^\d{1,2}[.-]/;
  function isDateValue(v) {
    return Boolean(v && DATE_PERIOD_RE.test(String(v)));
  }

  // ─── HTML-экранирование ──────────────────────────────────────
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Нормализация поискового запроса → массив токенов ────────.
  const _STREET_ALIASES = {
    'пр-кт':    'проспект',
    'пр-д':     'проезд',
    'переулок': 'пер',
    'улица':    'ул',
    'наб':      'набережная',
  };
  const _NOISE_TOKENS = new Set(['д']);

  function normalizeQuery(s) {
    return s.toLowerCase()
      .replace(/[,.]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean)
      .map(t => _STREET_ALIASES[t] || t)
      .filter(t => !_NOISE_TOKENS.has(t));
  }

  // ─── Безопасное создание даты с защитой от переполнения ──────
  function _safeDate(year, month0, day) {
    if (month0 < 0 || month0 > 11 || day < 1 || day > 31) return null;
    const d = new Date(year, month0, day);
    if (d.getMonth() !== month0 || d.getDate() !== day) return null;
    return d;
  }

  // ─── Парсинг одиночной даты «dd.mm.yyyy» ─────────────────────
  function _parseOneDate(s) {
    const m = String(s).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (!m) return null;
    return _safeDate(+m[3], +m[2] - 1, +m[1]);
  }

  // ─── Парсинг периода «dd.mm.yyyy[-dd.mm.yyyy]» → {start, end} ──
  function parsePeriod(rangeStr, onStr) {
    if (!isDateValue(rangeStr)) return null;
    const clean = String(rangeStr).replace(/\.{2,}/g, '.').trim();
    let start = null, end2 = null;

    // 1. dd.mm.yyyy-dd.mm.yyyy  (нормализованный, 4-значный год)
    let m = clean.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})[-–](\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (m) {
      start = _safeDate(+m[3], +m[2] - 1, +m[1]);
      end2  = _safeDate(+m[6], +m[5] - 1, +m[4]);
    }

    // 2. dd.mm-dd.mm.yyyy  (год только у второй части)
    if (!start) {
      m = clean.match(/^(\d{1,2})\.(\d{1,2})-(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      if (m) {
        start = _safeDate(+m[5], +m[2] - 1, +m[1]);
        end2  = _safeDate(+m[5], +m[4] - 1, +m[3]);
      }
    }

    // 3. dd-dd.mm.yyyy  (два дня одного месяца)
    if (!start) {
      m = clean.match(/^(\d{1,2})-(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      if (m) {
        start = _safeDate(+m[4], +m[3] - 1, +m[1]);
        end2  = _safeDate(+m[4], +m[3] - 1, +m[2]);
      }
    }

    // 4. Одиночная дата
    if (!start) start = _parseOneDate(clean);
    if (!start) return null;

    const endFromOn = onStr ? _parseOneDate(onStr) : null;
    return { start, end: endFromOn || end2 || start };
  }

  // ─── Внутренняя: собирает все валидные периоды записи ────────
  function _getPeriods(d) {
    return [
      parsePeriod(d.repair, d.repair_on),
      parsePeriod(d.hydro1, d.hydro1_on),
      parsePeriod(d.hydro2, d.hydro2_on),
    ].filter(Boolean);
  }

  // ─── Счётчик дней (для чипа на карточке) ────────────────────
  function getDaysInfo(d) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const periods = _getPeriods(d);
    if (!periods.length) return null;

    const active = periods.find(p => today >= p.start && today <= p.end);
    if (active) {
      return { type: 'active', days: Math.ceil((active.end - today) / 86400000) };
    }

    const future = periods
      .filter(p => p.start > today)
      .sort((a, b) => a.start - b.start)[0];
    if (future) {
      return { type: 'soon', days: Math.ceil((future.start - today) / 86400000) };
    }

    return null;
  }

  // ─── Статус карточки относительно сегодня ────────────────────
  function getStatus(d) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const soonLimit = new Date(today);
    soonLimit.setDate(today.getDate() + SOON_DAYS);

    const periods = _getPeriods(d);
    if (!periods.length) return 'normal';
    if (periods.some(p => today >= p.start && today <= p.end))       return 'active';
    if (periods.some(p => p.start > today && p.start <= soonLimit))  return 'soon';
    if (periods.every(p => p.end < today))                           return 'past';
    return 'normal';
  }

  // ─── Цвет маркера для карты (перенесено из map.html) ─────────
  const _COLOR_BY_TYPE = {
    repair: '#e85d2f',
    hydro1: '#d29922',
    hydro2: '#58a6ff',
  };
  function getMapColor(records) {
    const today = new Date(); today.setHours(0, 0, 0, 0);

    // Активное прямо сейчас
    for (const r of records) {
      const checks = [
        { period: parsePeriod(r.repair, r.repair_on), color: _COLOR_BY_TYPE.repair },
        { period: parsePeriod(r.hydro1, r.hydro1_on), color: _COLOR_BY_TYPE.hydro1 },
        { period: parsePeriod(r.hydro2, r.hydro2_on), color: _COLOR_BY_TYPE.hydro2 },
      ];
      for (const c of checks) {
        if (c.period && today >= c.period.start && today <= c.period.end) return c.color;
      }
    }

    // Все периоды завершены → вода подана
    const all = records.flatMap(r => [
      parsePeriod(r.repair, r.repair_on),
      parsePeriod(r.hydro1, r.hydro1_on),
      parsePeriod(r.hydro2, r.hydro2_on),
    ]).filter(Boolean);
    if (all.length > 0 && all.every(p => p.end < today)) return '#3fb950';

    // Будущие — по приоритету типа
    if (records.some(r => r.repair && isDateValue(r.repair)))  return _COLOR_BY_TYPE.repair;
    if (records.some(r => r.hydro2 && isDateValue(r.hydro2))) return _COLOR_BY_TYPE.hydro2;
    if (records.some(r => r.hydro1 && isDateValue(r.hydro1))) return _COLOR_BY_TYPE.hydro1;
    return '#7d8590';
  }

  // ─── Public API ───────────────────────────────────────────────
  return {
    PER_PAGE,
    SOON_DAYS,
    isDateValue,
    escapeHtml,
    normalizeQuery,
    parsePeriod,
    getDaysInfo,
    getStatus,
    getMapColor,
  };
})();
