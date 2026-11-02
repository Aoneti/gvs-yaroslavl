// Чистая логика без сети и файлов: сырой ответ API «Мой Дом» → сгруппированный объект для сайта.
// Используется в scripts/fetch-incidents.mjs, покрыта тестами (incidents-core.test.mjs).

export const SOURCE = Object.freeze({
  name: 'Мой Дом — Ярославль',
  url: 'https://moydom-yaroslavl.ru/incident',
});

/** Статус «В работе» в ответе API (status.type). */
export const STATUS_IN_WORK = 'in';

export const LABEL_EMERGENCY = 'авария';
export const LABEL_PLANNED = 'план';

const FALLBACK_GROUP = 'Прочее';

/**
 * Порядок разделов на странице. Сначала всё, что связано с горячей водой
 * (сайт именно про неё), затем остальное. Группы, которых нет в списке,
 * выводятся в конце по алфавиту — новые категории из API не потеряются.
 */
export const GROUP_ORDER = [
  'Горячее водоснабжение',
  'Холодное и горячее водоснабжение',
  'Отопление и горячее водоснабжение',
  'Холодное водоснабжение',
  'Отопление',
  'Электроснабжение',
  'Газоснабжение',
];

// ─── Мелкие помощники ────────────────────────────────────────────────────

/** Строка без лишних пробелов и переносов; null/undefined → ''. */
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Прямые кавычки → «ёлочки»: АО "УК" → АО «УК» (в источнике встречаются оба вида). */
const fixQuotes = (s) => s.replace(/"\s*([^"]*?)\s*"/g, '«$1»');

/** Unix-секунды → число или null (end = null означает «до устранения»). */
const toTs = (v) => (Number.isFinite(+v) && +v > 0 ? Math.trunc(+v) : null);

/** В источнике перед датой стоит латинская «c» — заменяем на кириллическую «с». */
const normalizeInterval = (text) => clean(text).replace(/^c(?=\s)/i, 'с');

/** Ссылку на запись оставляем только если она https и ведёт на moydom — в href чужого не нужно. */
const safeUrl = (link) => {
  const url = clean(link);
  return /^https:\/\/([\w-]+\.)*moydom-yaroslavl\.ru\//i.test(url) ? url : '';
};

const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

// ─── Правила из ТЗ ───────────────────────────────────────────────────────

/** «Авария»: urlName содержит "avarijno" или subtitle содержит «Аварий». */
export function isEmergency(raw) {
  const urlName = String(raw?.urlName ?? '').toLowerCase();
  const subtitle = String(raw?.subtitle ?? '').toLowerCase();
  return urlName.includes('avarijno') || subtitle.includes('аварий');
}

/**
 * Контакты: «АО «Яргазсервис»: +7 (4852) 494-539, +7 (4852) 494-532».
 * Несколько подрядчиков разделяются «; ». Телефоны возвращаются отдельно —
 * фронтенд делает из них ссылки tel:.
 */
export function formatContacts(contractors) {
  const parts = [];
  const phones = [];

  for (const c of Array.isArray(contractors) ? contractors : []) {
    const name = fixQuotes(clean(c?.name));
    const list = (Array.isArray(c?.phones) ? c.phones : [])
      .map((p) => ({ phone: clean(p?.phone ?? p?.number), note: clean(p?.comment) }))
      .filter((p) => p.phone);

    phones.push(...list.map((p) => p.phone));
    const phoneText = list.map((p) => (p.note ? `${p.phone} (${p.note})` : p.phone)).join(', ');
    const part = name && phoneText ? `${name}: ${phoneText}` : name || phoneText;
    if (part) parts.push(part);
  }

  return { contacts: parts.join('; '), phones: [...new Set(phones)] };
}

// ─── Полный список адресов ───────────────────────────────────────────────

// Если адресов много, API сокращает заголовок: «ул. Вечерняя, ул. Главная и ещё 9 улиц (303 дома)».
// Не \b: в JS он не понимает кириллицу, поэтому границы слова задаём через Unicode-свойства.
const TRUNCATED_RE = /(?<![\p{L}\p{N}])и ещ[её](?![\p{L}\p{N}])/iu;

/** «ул. Кирова: д. 12, д. 12б; ул. Максимова: д. 15» из location.groupedHousesNumByStreet. */
function buildFullAddress(streets) {
  if (!Array.isArray(streets)) return '';
  return streets
    .map((s) => {
      const name = clean(s?.name);
      const houses = (Array.isArray(s?.houses) ? s.houses : [])
        .map((h) => clean(typeof h === 'object' && h ? (h.name ?? h.number ?? '') : h))
        .filter(Boolean)
        .map((h) => `д. ${h}`);
      return houses.length ? `${name}: ${houses.join(', ')}` : name;
    })
    .filter(Boolean)
    .join('; ');
}

// ─── Одна запись ─────────────────────────────────────────────────────────

/** Сырой инцидент API → компактная запись для таблицы. */
export function normalizeIncident(raw) {
  const address = clean(raw?.location?.title);
  const { contacts, phones } = formatContacts(raw?.contractors);
  const full = TRUNCATED_RE.test(address) ? buildFullAddress(raw?.location?.groupedHousesNumByStreet) : '';

  return {
    id: raw?.id ?? null,
    address,
    // Полный список — только когда заголовок сокращён: иначе жителю не найти свой дом поиском.
    ...(full && full !== address ? { addressFull: full } : {}),
    typeLabel: isEmergency(raw) ? LABEL_EMERGENCY : LABEL_PLANNED,
    typeDescription: clean(raw?.subtitle),
    dateInterval: normalizeInterval(raw?.date?.interval?.text),
    startTs: toTs(raw?.date?.start),
    endTs: toTs(raw?.date?.end),
    contacts,
    phones,
    url: safeUrl(raw?.link),
  };
}

// ─── Сортировка ──────────────────────────────────────────────────────────

/** Сначала «авария», затем «план»; внутри — новые выше, при равенстве — по адресу. */
function compareItems(a, b) {
  const rank = (i) => (i.typeLabel === LABEL_EMERGENCY ? 0 : 1);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);

  const sa = a.startTs ?? -Infinity;
  const sb = b.startTs ?? -Infinity;
  if (sa !== sb) return sb - sa;

  return collator.compare(a.address, b.address) || (a.id ?? 0) - (b.id ?? 0);
}

function compareGroups(a, b) {
  const rank = (g) => {
    const i = GROUP_ORDER.indexOf(g.name);
    return i === -1 ? GROUP_ORDER.length : i;
  };
  return rank(a) - rank(b) || collator.compare(a.name, b.name);
}

// ─── Достать записи из ответа ────────────────────────────────────────────

/** Массив инцидентов из одного ответа API (`{ list: [...], totalCount }`). */
export function extractItems(page) {
  if (!page || !Array.isArray(page.list)) {
    throw new TypeError('В ответе API нет массива "list" — формат, похоже, изменился');
  }
  return page.list;
}

// ─── Главная функция ─────────────────────────────────────────────────────

/**
 * Сырой JSON API → сгруппированный объект для сайта.
 *
 * @param {object|object[]} response  один ответ API или массив ответов (страницы 1..N)
 * @param {{ now?: Date }} [options]
 * @returns {{
 *   schemaVersion: number, fetchedAt: string, source: {name: string, url: string},
 *   apiTotal: number, total: number, emergency: number, planned: number,
 *   groups: Array<{ name: string, items: object[] }>
 * }}
 */
export function groupIncidents(response, { now = new Date() } = {}) {
  const pages = Array.isArray(response) ? response : [response];
  const rawItems = [];
  const seenIds = new Set();
  let apiTotal = 0;

  for (const page of pages) {
    for (const raw of extractItems(page)) {
      // Пока мы листаем страницы, список может сдвинуться — один инцидент на двух страницах считаем один раз.
      if (raw?.id != null) {
        if (seenIds.has(raw.id)) continue;
        seenIds.add(raw.id);
      }
      rawItems.push(raw);
    }
    apiTotal = Math.max(apiTotal, Number(page.totalCount) || 0);
  }

  // Защита от тихой поломки: если API сменил формат, лучше упасть, чем опубликовать пустую страницу.
  if (rawItems.length && !rawItems.some((r) => r?.status?.type)) {
    throw new Error('В записях API нет поля status.type — формат, похоже, изменился');
  }

  // Фильтр: только status.type === "in" («В работе»); группировка по group.name.
  const byGroup = new Map();
  for (const raw of rawItems) {
    if (raw?.status?.type !== STATUS_IN_WORK) continue;
    const name = clean(raw?.group?.name) || FALLBACK_GROUP;
    if (!byGroup.has(name)) byGroup.set(name, []);
    byGroup.get(name).push(normalizeIncident(raw));
  }

  const groups = [...byGroup]
    .map(([name, items]) => ({ name, items: items.sort(compareItems) }))
    .sort(compareGroups);

  const all = groups.flatMap((g) => g.items);
  const emergency = all.filter((i) => i.typeLabel === LABEL_EMERGENCY).length;

  return {
    schemaVersion: 1,
    fetchedAt: now.toISOString(),
    source: SOURCE,
    apiTotal,
    total: all.length,
    emergency,
    planned: all.length - emergency,
    groups,
  };
}
