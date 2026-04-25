'use strict';

const GVS = (() => {

  // ─── Константы ──────────────────────────────────────────────
  const PER_PAGE  = 20;   // карточек на странице
  const SOON_DAYS = 7;    // статус «скоро»

  const DATE_PERIOD_RE = /^\d{1,2}\.\d{1,2}[.-]/;
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

  // ─── Нормализация поискового запроса ────────
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

  // ─── Вспомогательная: нормализованный сегодня ──────────────
  function makeToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // ─── DST-безопасная разность дат в днях ──────────────────────
  function _daysDiff(dateA, dateB) {
    const a = new Date(dateA.getFullYear(), dateA.getMonth(), dateA.getDate());
    const b = new Date(dateB.getFullYear(), dateB.getMonth(), dateB.getDate());
    const diffMs = b - a;
    // Округляем вниз для прошедших дней, вверх для будущих (исправлено: используем floor для консистентности)
    return Math.floor(diffMs / 86400000);
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

  // ─── Парсинг периода dd.mm.yyyy[-dd.mm.yyyy] ─────────────────
  function parsePeriod(rangeStr, onStr) {
    if (!rangeStr || typeof rangeStr !== 'string') return null;
    
    const clean = String(rangeStr).replace(/\.{2,}/g, '.').trim();
    if (!isDateValue(clean)) return null;
    
    let start = null, end2 = null;

    // 1. dd.mm.yyyy-dd.mm.yyyy
    let m = clean.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})[-\u2013](\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (m) {
      start = _safeDate(+m[3], +m[2] - 1, +m[1]);
      end2  = _safeDate(+m[6], +m[5] - 1, +m[4]);
    }

    // 2. dd.mm.yy-dd.mm.yy
    if (!start) {
      m = clean.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})[-\u2013](\d{1,2})\.(\d{1,2})\.(\d{2})$/);
      if (m) {
        start = _safeDate(2000 + +m[3], +m[2] - 1, +m[1]);
        end2  = _safeDate(2000 + +m[6], +m[5] - 1, +m[4]);
      }
    }

    // 3. dd.mm-dd.mm.yyyy
    if (!start) {
      m = clean.match(/^(\d{1,2})\.(\d{1,2})-(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      if (m) {
        const yEnd   = +m[5];
        const mo1    = +m[2];
        const mo2    = +m[4];
        const yStart = mo1 > mo2 ? yEnd - 1 : yEnd;
        start = _safeDate(yStart, mo1 - 1, +m[1]);
        end2  = _safeDate(yEnd,   mo2 - 1, +m[3]);
      }
    }

    // 4. dd-dd.mm.yyyy
    if (!start) {
      m = clean.match(/^(\d{1,2})-(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      if (m) {
        start = _safeDate(+m[4], +m[3] - 1, +m[1]);
        end2  = _safeDate(+m[4], +m[3] - 1, +m[2]);
      }
    }

    // 5. Одиночная дата dd.mm.yyyy
    if (!start) start = _parseOneDate(clean);
    if (!start) return null;

    const endFromOn = onStr ? _parseOneDate(onStr) : null;
    return { start, end: endFromOn || end2 || start };
  }

  // ─── Кешированный доступ к периодам одной записи ─────────────
  function _getPeriods(d) {
    if (d._periods) {
      return [d._periods.repair, d._periods.hydro1, d._periods.hydro2].filter(Boolean);
    }
    return [
      parsePeriod(d.repair,  d.repair_on),
      parsePeriod(d.hydro1,  d.hydro1_on),
      parsePeriod(d.hydro2,  d.hydro2_on),
    ].filter(Boolean);
  }

  // ─── Кешированный доступ к именованным периодам одной записи ──
  function _getNamedPeriods(d) {
    return d._periods || {
      repair: parsePeriod(d.repair,  d.repair_on),
      hydro1: parsePeriod(d.hydro1,  d.hydro1_on),
      hydro2: parsePeriod(d.hydro2,  d.hydro2_on),
    };
  }

  // ─── Разбирает и кеширует периоды одной записи ───────────────
  function cacheRecordPeriods(d) {
    d._periods = {
      repair: parsePeriod(d.repair,  d.repair_on),
      hydro1: parsePeriod(d.hydro1,  d.hydro1_on),
      hydro2: parsePeriod(d.hydro2,  d.hydro2_on),
    };
    return d;
  }

  // ─── Счётчик дней (для чипа на карточке) ─────────────────────
  function getDaysInfo(d, today) {
    if (!today) today = makeToday();
    const periods = _getPeriods(d);
    if (!periods.length) return null;

    const active = periods.find(p => today >= p.start && today <= p.end);
    if (active) {
      return { type: 'active', days: _daysDiff(today, active.end) };
    }

    const future = periods
      .filter(p => p.start > today)
      .sort((a, b) => a.start - b.start)[0];
    if (future) {
      return { type: 'soon', days: _daysDiff(today, future.start) };
    }

    return null;
  }

  // ─── Статус карточки относительно сегодня ────────────────────
  function getStatus(d, today) {
    if (!today) today = makeToday();
    const soonLimit = new Date(
      today.getFullYear(), today.getMonth(), today.getDate() + SOON_DAYS
    );

    const periods = _getPeriods(d);
    if (!periods.length) return 'normal';
    
    // Приоритет: active > past > soon > normal
    if (periods.some(p => today >= p.start && today <= p.end))             return 'active';
    if (periods.every(p => p.end < today))                                  return 'past';
    if (periods.some(p => p.start > today && p.start <= soonLimit))        return 'soon';
    return 'normal';
  }

  // ─── Тип активного периода ───────────────────────────────────
  function getActivePeriodType(d, today) {
    if (!today) today = makeToday();
    const np = _getNamedPeriods(d);
    if (np.repair && today >= np.repair.start && today <= np.repair.end) return 'repair';
    if (np.hydro1 && today >= np.hydro1.start && today <= np.hydro1.end) return 'hydro1';
    if (np.hydro2 && today >= np.hydro2.start && today <= np.hydro2.end) return 'hydro2';
    return null;
  }

  // ─── Цвет маркера для карты ──────────────────────────────────
  const _COLOR_BY_TYPE = {
    repair: '#e85d2f',
    hydro1: '#d29922',
    hydro2: '#58a6ff',
  };

  function getMapColor(records, today) {
    if (!today) today = makeToday();

    const allPeriods = records.reduce(
      (acc, r) => acc.concat(_getPeriods(r)),
      []
    );

    for (const r of records) {
      const np = _getNamedPeriods(r);
      if (np.repair && today >= np.repair.start && today <= np.repair.end) return _COLOR_BY_TYPE.repair;
      if (np.hydro1 && today >= np.hydro1.start && today <= np.hydro1.end) return _COLOR_BY_TYPE.hydro1;
      if (np.hydro2 && today >= np.hydro2.start && today <= np.hydro2.end) return _COLOR_BY_TYPE.hydro2;
    }

    if (allPeriods.length > 0 && allPeriods.every(p => p.end < today)) return '#3fb950';

    const types = ['repair', 'hydro1', 'hydro2'];
    for (const type of types) {
      for (const r of records) {
        const np = _getNamedPeriods(r);
        if (np[type] && np[type].start > today) return _COLOR_BY_TYPE[type];
      }
    }

    return '#7d8590';
  }

  // ─── Public API ───────────────────────────────────────────────
  return {
    PER_PAGE,
    SOON_DAYS,
    isDateValue,
    escapeHtml,
    normalizeQuery,
    makeToday,
    parsePeriod,
    cacheRecordPeriods,
    getDaysInfo,
    getStatus,
    getActivePeriodType,
    getMapColor,
  };
})();