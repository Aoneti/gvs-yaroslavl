'use strict';
// Статистика по дням. Считаем УНИКАЛЬНЫЕ адреса, а не строки data.json.
// Периоды берём из GVS.parsePeriod: день «вода с» считается днём отключения
// (так же, как в карточках). Изменится правило в parsePeriod — изменится и здесь.
const GVSStats = (() => {
  const TYPES = ['repair', 'hydro1', 'hydro2'];
  const MAX_SPAN_DAYS = 366;                       // защита от опечаток в годах

  const pad     = n => String(n).padStart(2, '0');
  const dayKey  = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

  function compute(data, today) {
    const days = new Map(), addrs = new Set(), startsSoon = new Set();
    const soonEnd = addDays(today, GVS.SOON_DAYS);
    let skipped = 0;

    const bucket = k => {
      let b = days.get(k);
      if (!b) days.set(k, b = { repair: new Set(), hydro1: new Set(), hydro2: new Set(), hydro: new Set(), all: new Set() });
      return b;
    };

    for (const rec of data) {
      addrs.add(rec.address);
      const np = rec._periods || GVS.cacheRecordPeriods(rec)._periods;
      for (const t of TYPES) {
        const p = np[t];
        if (!p) continue;
        if (p.start > today && p.start <= soonEnd) startsSoon.add(rec.address);
        const span = Math.round((p.end - p.start) / 864e5);
        if (span < 0 || span > MAX_SPAN_DAYS) { skipped++; continue; }
        for (let i = 0; i <= span; i++) {
          const b = bucket(dayKey(addDays(p.start, i)));
          b[t].add(rec.address);
          b.all.add(rec.address);
          if (t !== 'repair') b.hydro.add(rec.address);
        }
      }
    }

    const todayBucket = days.get(dayKey(today));
    const activeToday = todayBucket ? todayBucket.all : new Set();
    for (const a of activeToday) startsSoon.delete(a);       // уже без воды — это не «скоро»

    let peak = null, addressDays = 0;
    for (const [k, b] of days) {
      addressDays += b.all.size;                              // адресо-дни, не число жителей
      if (!peak || b.all.size > peak.count || (b.all.size === peak.count && k < peak.key)) {
        peak = { key: k, count: b.all.size };
      }
    }

    const keys = [];                                          // все календарные дни диапазона
    if (days.size) {
      const sorted = [...days.keys()].sort();
      for (let d = fromKey(sorted[0]), end = fromKey(sorted[sorted.length - 1]); d <= end; d = addDays(d, 1)) {
        keys.push(dayKey(d));
      }
    }
    return { total: addrs.size, activeToday: activeToday.size, startingSoon: startsSoon.size,
             peak, addressDays, days, keys, skipped };
  }

  return { compute, dayKey, fromKey, addDays };
})();
