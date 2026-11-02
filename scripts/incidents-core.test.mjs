// Запуск из корня репозитория: node --test   (Node 18+)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUP_ORDER,
  formatContacts,
  groupIncidents,
  isEmergency,
  normalizeIncident,
} from './incidents-core.mjs';

const NOW = new Date('2026-10-30T12:00:00Z');

/** Минимальный «сырой» инцидент в формате API; поля можно переопределить. */
const raw = (over = {}) => ({
  id: 1,
  group: { name: 'Отопление' },
  subtitle: 'Ремонт стояков',
  urlName: 'remont-stoyakov',
  status: { type: 'in', title: 'В работе' },
  date: { start: 1792962000, end: null, interval: { text: 'c 26.10.2026 00:00 до устранения' } },
  contractors: [{ name: 'АО «УК»', phones: [{ phone: '+7 (4852) 111-222' }] }],
  location: { title: 'ул. Громова: д. 34' },
  link: 'https://moydom-yaroslavl.ru/incident/yaroslavl/remont-stoyakov-1',
  ...over,
});

const page = (list, totalCount = list.length) => ({ list, totalCount });

test('фильтр: остаются только status.type === "in"', () => {
  const out = groupIncidents(
    page([
      raw({ id: 1 }),
      raw({ id: 2, status: { type: 'done' } }),
      raw({ id: 3, status: { type: 'plan' } }),
    ]),
    { now: NOW },
  );
  assert.equal(out.total, 1);
  assert.equal(out.groups[0].items[0].id, 1);
  assert.equal(out.apiTotal, 3);
});

test('метка «авария» / «план»', () => {
  assert.equal(isEmergency(raw({ urlName: 'avarijnoe-otkluchenie', subtitle: 'x' })), true);
  assert.equal(isEmergency(raw({ urlName: 'zamena', subtitle: 'Аварийное отключение' })), true);
  assert.equal(isEmergency(raw({ urlName: 'remont-stoyakov', subtitle: 'Ремонт стояков' })), false);
  // «Устранение утечки» — не авария по правилу из ТЗ (ни urlName, ни subtitle не содержат «аварий»)
  assert.equal(isEmergency(raw({ urlName: 'ustranenie-utechki', subtitle: 'Устранение утечки на тепловой сети' })), false);
  assert.equal(normalizeIncident(raw()).typeLabel, 'план');
});

test('группировка по group.name, порядок разделов и «Прочее»', () => {
  const out = groupIncidents(
    page([
      raw({ id: 1, group: { name: 'Газоснабжение' } }),
      raw({ id: 2, group: { name: 'Горячее водоснабжение' } }),
      raw({ id: 3, group: { name: 'Яблочная категория' } }),
      raw({ id: 4, group: { name: 'Аптечная категория' } }),
      raw({ id: 5, group: undefined }),
      raw({ id: 6, group: { name: 'Отопление' } }),
    ]),
    { now: NOW },
  );
  assert.deepEqual(out.groups.map((g) => g.name), [
    'Горячее водоснабжение', // из GROUP_ORDER, первым
    'Отопление',
    'Газоснабжение',
    'Аптечная категория', // неизвестные — после известных, по алфавиту
    'Прочее',
    'Яблочная категория',
  ]);
  assert.equal(GROUP_ORDER[0], 'Горячее водоснабжение');
});

test('сортировка внутри группы: сначала аварии, затем план; новые выше; при равенстве — по адресу', () => {
  const out = groupIncidents(
    page([
      raw({ id: 1, location: { title: 'ул. Б: д. 1' }, date: { start: 100, interval: { text: 'x' } } }),
      raw({ id: 2, urlName: 'avarijnoe', subtitle: 'Аварийное', location: { title: 'ул. А: д. 5' }, date: { start: 50, interval: { text: 'x' } } }),
      raw({ id: 3, urlName: 'avarijnoe', subtitle: 'Аварийное', location: { title: 'ул. А: д. 2' }, date: { start: 200, interval: { text: 'x' } } }),
      raw({ id: 4, urlName: 'avarijnoe', subtitle: 'Аварийное', location: { title: 'ул. А: д. 10' }, date: { start: 50, interval: { text: 'x' } } }),
      raw({ id: 5, location: { title: 'ул. В: д. 1' }, date: { start: 300, interval: { text: 'x' } } }),
    ]),
    { now: NOW },
  );
  // аварии: 3 (start 200), затем два с start 50 — «д. 5» раньше «д. 10»? нет: numeric collator → 5 < 10
  // планы: 5 (start 300), 1 (start 100)
  assert.deepEqual(out.groups[0].items.map((i) => i.id), [3, 2, 4, 5, 1]);
});

test('контакты: «Название: телефон, телефон», кавычки, несколько подрядчиков, без телефонов', () => {
  const one = formatContacts([
    { name: 'АО «Яргазсервис»', phones: [{ phone: '+7 (4852) 494-539' }, { phone: '+7 (4852) 494-532' }] },
  ]);
  assert.equal(one.contacts, 'АО «Яргазсервис»: +7 (4852) 494-539, +7 (4852) 494-532');
  assert.deepEqual(one.phones, ['+7 (4852) 494-539', '+7 (4852) 494-532']);

  // прямые кавычки (в т.ч. с пробелом перед закрывающей) → «ёлочки»
  assert.equal(
    formatContacts([{ name: 'АО "УПРАВДОМ РАЙОНА "', phones: [{ phone: '+7 (485) 259-42-06' }] }]).contacts,
    'АО «УПРАВДОМ РАЙОНА»: +7 (485) 259-42-06',
  );

  const many = formatContacts([
    { name: 'ООО «А»', phones: [{ phone: '111', comment: 'диспетчер' }] },
    { name: 'ООО «Б»', phones: [] },
    { name: '', phones: [{ phone: '222' }] },
  ]);
  assert.equal(many.contacts, 'ООО «А»: 111 (диспетчер); ООО «Б»; 222');
  assert.deepEqual(many.phones, ['111', '222']);

  assert.deepEqual(formatContacts(undefined), { contacts: '', phones: [] });
  assert.deepEqual(formatContacts([]), { contacts: '', phones: [] });
});

test('срок: латинская «c» → кириллическая «с», метки времени сохраняются', () => {
  const i = normalizeIncident(
    raw({ date: { start: 1792962000, end: 1793393700, interval: { text: 'c 26 октября, 00:00 по 30 октября, 23:55' } } }),
  );
  assert.equal(i.dateInterval, 'с 26 октября, 00:00 по 30 октября, 23:55');
  assert.equal(i.startTs, 1792962000);
  assert.equal(i.endTs, 1793393700);

  const open = normalizeIncident(raw());
  assert.equal(open.endTs, null); // «до устранения»
  assert.equal(normalizeIncident(raw({ date: undefined })).dateInterval, '');
});

test('полный список адресов — только когда заголовок сокращён («и ещё …»)', () => {
  const streets = [
    { name: 'ул. Кирова', houses: ['12', '12б', '14'] },
    { name: 'ул. Максимова', houses: ['15'] },
    { name: 'ул. Без домов', houses: [] },
  ];

  const truncated = normalizeIncident(
    raw({ location: { title: 'ул. Кирова, ул. Максимова и ещё 1 улица (5 домов)', groupedHousesNumByStreet: streets } }),
  );
  assert.equal(truncated.addressFull, 'ул. Кирова: д. 12, д. 12б, д. 14; ул. Максимова: д. 15; ул. Без домов');

  const plain = normalizeIncident(raw({ location: { title: 'ул. Громова: д. 34', groupedHousesNumByStreet: streets } }));
  assert.equal('addressFull' in plain, false);

  // сокращённый заголовок, но структуры домов нет — поле просто не добавляется
  const noStreets = normalizeIncident(raw({ location: { title: 'ул. А и ещё 3 улицы' } }));
  assert.equal('addressFull' in noStreets, false);
});

test('страницы: несколько ответов объединяются, дубли по id считаются один раз', () => {
  const out = groupIncidents(
    [page([raw({ id: 1 }), raw({ id: 2 })], 3), page([raw({ id: 2 }), raw({ id: 3 })], 3)],
    { now: NOW },
  );
  assert.equal(out.total, 3);
  assert.equal(out.apiTotal, 3);
  assert.equal(out.fetchedAt, '2026-10-30T12:00:00.000Z');
});

test('счётчики: total / emergency / planned', () => {
  const out = groupIncidents(
    page([
      raw({ id: 1, urlName: 'avarijnoe', subtitle: 'Аварийное' }),
      raw({ id: 2 }),
      raw({ id: 3 }),
    ]),
    { now: NOW },
  );
  assert.deepEqual([out.total, out.emergency, out.planned], [3, 1, 2]);
});

test('ссылка: только https на moydom, остальное отбрасывается', () => {
  assert.equal(normalizeIncident(raw()).url, 'https://moydom-yaroslavl.ru/incident/yaroslavl/remont-stoyakov-1');
  assert.equal(normalizeIncident(raw({ link: 'javascript:alert(1)' })).url, '');
  assert.equal(normalizeIncident(raw({ link: 'https://evil.example/incident/1' })).url, '');
  assert.equal(normalizeIncident(raw({ link: undefined })).url, '');
});

test('защита от смены формата API: бросаем ошибку, а не публикуем пустоту', () => {
  assert.throws(() => groupIncidents({ items: [] }), /list/);
  assert.throws(() => groupIncidents(null), /list/);
  assert.throws(() => groupIncidents(page([{ id: 1, title: 'без статуса' }])), /status\.type/);
  // пустой, но корректный ответ — это нормально: сейчас просто нет отключений
  assert.equal(groupIncidents(page([]), { now: NOW }).total, 0);
});
