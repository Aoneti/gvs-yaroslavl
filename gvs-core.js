/**
 * gvs-core.js — общая бизнес-логика для index.html и map.html
 * Единственный источник истины: парсинг дат, нормализация, статусы.
 */
'use strict';

const GVS = (() => {

  // ─── Константы ──────────────────────────────────────────────
  const PER_PAGE  = 20;   // карточек на странице
  const SOON_DAYS = 7;    // дней вперёд → статус «скоро»

  // ─── Детектор значений-дат vs текстовых заметок ─────────────
  // Период считается датой, если начинается с цифры (день месяца)
  const DATE_PERIOD_RE = /^\d{1,2}[.\-]/;
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

  // ─── Нормализация поискового запроса → массив токенов ────────
  // Убирает служебные слова («ул», «д», «пр-кт» и т.д.) и пунктуацию.
  // Используется и для построения _norm на объектах, и для токенов запроса.
  function normalizeQuery(s) {
    return s.toLowerCase()
      .replace(/[,.]/g, ' ')
      .replace(/\bд\b/g, ' ')
      .replace(/\bул\b/g, ' ')
      .replace(/\bпр-кт\b/g, ' ')
      .replace(/\bпр-д\b/g, ' ')
      .replace(/\bпер\b/g, ' ')
      .replace(/\bпр\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);
  }

  // ─── Безопасное создание даты с защитой от переполнения ──────
  // new Date(2026, 12, 1) тихо становится 1 февраля 2027 — эта функция это пресекает.
  function safeDate(year, month0, day) {
    // month0 — 0-индексированный месяц
    if (month0 < 0 || month0 > 11 || day < 1 || day > 31) return null;
    const d = new Date(year, month0, day);
    // JS тихо «переполняет» невалидные числа — сравниваем результат с входными
    if (d.getMonth() !== month0 || d.getDate() !== day) return null;
    return d;
  }

  // ─── Парсинг одиночной даты «dd.mm.yyyy» ─────────────────────
  function parseOneDate(s) {
    const m = String(s).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (!m) return null;
    return safeDate(+m[3], +m[2] - 1, +m[1]);
  }

  // ─── Парсинг периода «dd.mm.yyyy[-dd.mm.yyyy]» → {start, end} ──
  // Поддерживает нормализованный формат (из конвертера) и устаревшие
  // форматы для обратной совместимости с исторически правленными данными.
  function parsePeriod(rangeStr, onStr) {
    if (!isDateValue(rangeStr)) return null;          // текстовая заметка — пропускаем
    const clean = String(rangeStr).replace(/\.{2,}/g, '.').trim();
    let start = null, end2 = null;

    // 1. dd.mm.yyyy-dd.mm.yyyy  (нормализованный)
    let m = clean.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})[-–](\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (m) {
      start = safeDate(+m[3], +m[2] - 1, +m[1]);
      end2  = safeDate(+m[6], +m[5] - 1, +m[4]);
    }

    // 2. dd.mm-dd.mm.yyyy  (старый: год только у второй части)
    if (!start) {
      m = clean.match(/^(\d{1,2})\.(\d{1,2})-(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      if (m) {
        start = safeDate(+m[5], +m[2] - 1, +m[1]);
        end2  = safeDate(+m[5], +m[4] - 1, +m[3]);
      }
    }

    // 3. dd-dd.mm.yyyy  (старый: два дня одного месяца)  — ИСПРАВЛЕНО: теперь извлекается end
    if (!start) {
      m = clean.match(/^(\d{1,2})-(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      if (m) {
        start = safeDate(+m[4], +m[3] - 1, +m[1]);
        end2  = safeDate(+m[4], +m[3] - 1, +m[2]); // был баг: end2 оставался null
      }
    }

    // 4. Одиночная дата
    if (!start) start = parseOneDate(clean);
    if (!start) return null;

    const endFromOn = onStr ? parseOneDate(onStr) : null;
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
  // Возвращает { type: 'active'|'soon', days } или null
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
  // Возвращает 'active' | 'soon' | 'past' | 'normal'
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

  // ─── Public API ───────────────────────────────────────────────
  return {
    PER_PAGE,
    SOON_DAYS,
    isDateValue,
    escapeHtml,
    normalizeQuery,
    safeDate,
    parseOneDate,
    parsePeriod,
    getDaysInfo,
    getStatus,
  };
})();
