// Положите рядом с gvs-core.js и stats-core.js, запуск из корня репозитория: node --test   (Node 18+)
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const load = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const GVS  = new Function(load('gvs-core.js') + '\nreturn GVS;')();
const S    = new Function('GVS', load('stats-core.js') + '\nreturn GVSStats;')(GVS);
const D    = (m, d) => new Date(2026, m - 1, d);

test('уникальные адреса: дубли записей и пересечения типов не задваивают', () => {
  const data = [
    { address: 'ул. А д. 1', repair: '10.07.2026-12.07.2026' },
    { address: 'ул. А д. 1', repair: '10.07.2026-12.07.2026', hydro1: '11.07.2026' },  // тот же дом
    { address: 'ул. Б д. 2', hydro2: '11.07.2026-11.07.2026' },
  ];
  const s = S.compute(data, D(7, 11));
  const day = s.days.get('2026-07-11');
  assert.equal(day.all.size, 2);          // дом А один раз + дом Б
  assert.equal(day.repair.size, 1);
  assert.equal(s.total, 2);
  assert.equal(s.activeToday, 2);
  assert.deepEqual(s.peak, { key: '2026-07-11', count: 2 });
  assert.equal(s.addressDays, 4);         // 10.07: 1, 11.07: 2, 12.07: 1
  assert.equal(s.keys.length, 3);
});

test('«скоро» не включает адреса, уже оставшиеся без воды; день «вода с» входит в отключение', () => {
  const data = [
    { address: 'ул. А д. 1', repair: '15.07.2026-16.07.2026' },                          // через 4 дня
    { address: 'ул. Б д. 2', repair: '09.07.2026-12.07.2026', hydro1: '14.07.2026' },    // уже без воды
    { address: 'ул. В д. 3', repair: '01.07.2026-02.07.2026', repair_on: '11.07.2026' }, // «вода с» = сегодня
  ];
  const s = S.compute(data, D(7, 11));
  assert.equal(s.startingSoon, 1);        // только А
  assert.equal(s.activeToday, 2);         // Б и В
});

test('опечатка в годе не раздувает расчёт', () => {
  const s = S.compute([{ address: 'ул. А д. 1', repair: '01.07.2026-01.07.2062' }], D(7, 11));
  assert.equal(s.skipped, 1);
  assert.equal(s.peak, null);
});
