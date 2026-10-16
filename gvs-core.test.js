// Положите рядом с gvs-core.js и запустите из корня репозитория: node --test   (Node 18+)
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const src = fs.readFileSync(path.join(__dirname, 'gvs-core.js'), 'utf8');
const GVS = new Function(src + '\nreturn GVS;')();

const D   = (y, m, d) => new Date(y, m - 1, d);
const ymd = d => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'),
                  String(d.getDate()).padStart(2, '0')].join('-');
const rec = r => GVS.cacheRecordPeriods({ ...r });

test('parsePeriod: форматы из data.json', () => {
  const p = GVS.parsePeriod('25.07.2025-04.08.2025', '07.08.2025');
  assert.equal(ymd(p.start), '2025-07-25');
  assert.equal(ymd(p.end),   '2025-08-07');            // конец берётся из «вода с»

  const one = GVS.parsePeriod('27.05.2025');
  assert.equal(ymd(one.start), ymd(one.end));

  const cross = GVS.parsePeriod('28.12-03.01.2026');    // межгодовой период
  assert.equal(ymd(cross.start), '2025-12-28');
  assert.equal(ymd(cross.end),   '2026-01-03');

  assert.equal(GVS.parsePeriod('снесен'), null);
  assert.equal(GVS.parsePeriod('31.02.2026'), null);    // несуществующая дата
});

test('getStatus / getDaysInfo', () => {
  const r = rec({ repair: '10.07.2026-20.07.2026', repair_on: '22.07.2026' });

  assert.equal(GVS.getStatus(r, D(2026, 7, 1)),  'normal');  // до начала 9 дней
  assert.equal(GVS.getStatus(r, D(2026, 7, 5)),  'soon');
  assert.equal(GVS.getStatus(r, D(2026, 7, 15)), 'active');
  assert.equal(GVS.getStatus(r, D(2026, 7, 23)), 'past');

  assert.deepEqual(GVS.getDaysInfo(r, D(2026, 7, 5)),  { type: 'soon',   days: 5 });
  assert.deepEqual(GVS.getDaysInfo(r, D(2026, 7, 15)), { type: 'active', days: 7 });
  assert.equal(GVS.getDaysInfo(r, D(2026, 7, 23)), null);

  // Фиксируем ТЕКУЩЕЕ поведение: день «вода с» считается днём отключения.
  // Если правило изменится, поправьте parsePeriod и эту проверку.
  assert.equal(GVS.getStatus(r, D(2026, 7, 22)), 'active');
});

test('getMapColor: цвет не зависит от порядка записей', () => {
  const today  = D(2026, 7, 15);
  const hydro  = rec({ hydro1: '10.07.2026-20.07.2026' });   // идёт сейчас
  const repair = rec({ repair: '12.07.2026-18.07.2026' });   // идёт сейчас
  assert.equal(GVS.getMapColor([hydro, repair], today), '#e85d2f');
  assert.equal(GVS.getMapColor([repair, hydro], today), '#e85d2f');   // ремонт приоритетнее

  const later1 = rec({ hydro2: '01.08.2026-02.08.2026' });   // предстоит
  const later2 = rec({ repair: '20.08.2026-25.08.2026' });   // предстоит
  assert.equal(GVS.getMapColor([later1, later2], today), '#e85d2f');
  assert.equal(GVS.getMapColor([later2, later1], today), '#e85d2f');
});

test('getMapColor: завершено и нет данных', () => {
  const today = D(2026, 9, 1);
  assert.equal(GVS.getMapColor([rec({ repair: '01.06.2026-05.06.2026' })], today), '#3fb950');
  assert.equal(GVS.getMapColor([rec({ repair: 'снесен' })], today), '#7d8590');
});
