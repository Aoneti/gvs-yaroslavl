#!/usr/bin/env node
// Скачивает действующие инциденты с «Мой Дом» (все страницы), группирует и сохраняет в incidents.json.
//
// Запускается из GitHub Actions (.github/workflows/fetch-incidents.yml) и вручную:
//   node scripts/fetch-incidents.mjs
//
// Как устроен запрос (сверено с DevTools браузера). Список на сайте подгружается скриптом:
//   POST /incident/ajax-incidents/current?page=N
//   тело: {"houses_ids":null,"streets_ids":null,"area_ids":[18, 7230, …]}   ← «весь город»
//   заголовки: X-Requested-With, X-CSRF-Token (из <meta name="csrf-token"> страницы) и cookie XSDID.
// Поэтому мы делаем то же, что браузер:
//   1. открываем обычную страницу /incident и берём из неё cookie, csrf-токен и id города;
//   2. шлём POST со списком районов (DEFAULT_AREA_IDS ниже, при желании дополняем с сайта).
// Адрес /incident/current (без ajax-incidents) отвечает 404.
//
// Переменные окружения (нужны в основном для тестов):
//   INCIDENTS_SITE_URL  — адрес сайта                (по умолчанию https://moydom-yaroslavl.ru)
//   INCIDENTS_API_URL   — адрес списка без ?page=    (по умолчанию <сайт>/incident/ajax-incidents/current)
//   INCIDENTS_PAGE_URL  — страница с токеном         (по умолчанию <сайт>/incident)
//   INCIDENTS_AREAS_URL — список районов города      (по умолчанию <сайт>/location/areas)
//   INCIDENTS_AREA_IDS  — id районов через запятую; заменяет и сохранённый список, и автодополнение
//   INCIDENTS_ALLOW_EMPTY=1 — разрешить записать «0 отключений» поверх непустого файла
//   INCIDENTS_OUT       — куда писать результат      (по умолчанию <корень репозитория>/incidents.json)
//
// Если загрузка не удалась, скрипт завершается с кодом 1 и НЕ трогает прежний файл:
// сайт продолжит показывать последние удачные данные, а плашка «данные устарели»
// на странице предупредит посетителей.

import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractItems, groupIncidents } from './incidents-core.mjs';

const SITE_URL = (process.env.INCIDENTS_SITE_URL || 'https://moydom-yaroslavl.ru').replace(/\/+$/, '');
const API_URL = process.env.INCIDENTS_API_URL || `${SITE_URL}/incident/ajax-incidents/current`;
const PAGE_URL = process.env.INCIDENTS_PAGE_URL || `${SITE_URL}/incident`;
const AREAS_URL = process.env.INCIDENTS_AREAS_URL || `${SITE_URL}/location/areas`;
const OUT_FILE =
  process.env.INCIDENTS_OUT ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'incidents.json');

const MAX_PAGES = 30; // предохранитель от бесконечного цикла (сейчас ~3 страницы по 20 записей)
const TIMEOUT_MS = 20_000; // на один запрос
const ATTEMPTS = 3; // попыток на один запрос
const RETRY_BASE_MS = Number(process.env.INCIDENTS_RETRY_BASE_MS) || 2_000; // 2 с, затем 6 с
const PAGE_DELAY_MS = 400; // пауза между страницами — не нагружаем чужой сервер

const USER_AGENT = 'gvs-yaroslavl-bot (+https://github.com/Aoneti/gvs-yaroslavl)';

/**
 * «Весь город» для фильтра area_ids: ровно тот список (62 id), который браузер отправляет по умолчанию
 * (взят из DevTools → Request Payload). Первый id — сам Ярославль. Если на сайте появятся новые районы,
 * discoverAreaIds() подхватит их сам; руками список менять не нужно.
 */
const DEFAULT_AREA_IDS = [
  18, 7230, 295, 8997, 9026, 9098, 8798, 6587, 6733, 132, 6330, 7017, 7046, 6257, 203, 304, 2555, 6258, 6259, 6260,
  6261, 6262, 6263, 6264, 6265, 6266, 6267, 6268, 6269, 6270, 6271, 6273, 6276, 6284, 6288, 6290, 6293, 6298, 6305,
  6308, 6311, 6313, 6317, 6698, 6707, 6720, 6726, 6742, 6773, 6787, 6802, 6823, 6832, 6848, 6860, 6875, 6885, 6902,
  6926, 6936, 6956, 6979,
];
const MAX_EXTRA_AREAS = 50; // больше «новых» районов за раз — подозрительно: скорее всего, мы разобрали чужой ответ

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ошибка, которую повторять бессмысленно (4xx, не-JSON, нет токена). */
const fatal = (message, extra = {}) => Object.assign(new Error(message), { fatal: true, ...extra });

/** Начало ответа для сообщений об ошибках: одна строка, без лишнего. */
const snippet = (text, n = 160) => String(text).replace(/\s+/g, ' ').trim().slice(0, n);

/** Выполняет task с повторами при сетевых сбоях, 429 и 5xx. Фатальные ошибки пробрасывает сразу. */
async function withRetries(label, task) {
  let lastError;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      return await task();
    } catch (err) {
      lastError = err;
      if (err.fatal || attempt === ATTEMPTS) break;

      const wait = RETRY_BASE_MS * 3 ** (attempt - 1);
      console.warn(`[${label}] попытка ${attempt}/${ATTEMPTS}: ${err.message}. Повтор через ${wait / 1000} с`);
      await sleep(wait);
    }
  }

  throw lastError;
}

// ─── Сессия: cookie + CSRF-токен ─────────────────────────────────────────

/** Обычная страница сайта → cookie, CSRF-токен и id города (так делает браузер перед любым XHR). */
function openSession() {
  return withRetries(PAGE_URL, async () => {
    const res = await fetch(PAGE_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
    if (!res.ok) throw fatal(`HTTP ${res.status} для ${PAGE_URL}`);

    const html = await res.text();
    const metaTag = html.match(/<meta[^>]*name=["']csrf-token["'][^>]*>/i)?.[0] ?? '';
    const token = metaTag.match(/content=["']([^"']+)["']/i)?.[1];
    const cookies = res.headers.getSetCookie().map((line) => line.split(';')[0]);
    const cityId = Number(html.match(/"activeCity"\s*:\s*(\d+)/)?.[1]) || DEFAULT_AREA_IDS[0];

    // В журнал — только имена cookie и факт наличия токена, сами значения не печатаем.
    const names = cookies.map((c) => c.split('=')[0]).join(', ') || 'нет';
    console.log(`сессия: HTTP ${res.status}, cookie: ${names}, csrf-токен: ${token ? 'есть' : 'НЕ НАЙДЕН'}, город: ${cityId}`);

    if (!token) {
      const title = html.match(/<title>([^<]*)<\/title>/i)?.[1];
      throw fatal(
        `На странице ${PAGE_URL} нет <meta name="csrf-token"> (заголовок страницы: «${snippet(title ?? 'нет', 80)}»). ` +
          'Либо изменилась вёрстка сайта, либо вместо страницы пришла заглушка антибота.',
      );
    }
    return { token, cookie: cookies.join('; '), cityId };
  });
}

// ─── Районы для фильтра ──────────────────────────────────────────────────

/** Числовые id из любого JSON: формат ответа /location/areas нам не известен, поэтому собираем отовсюду. */
function collectIds(node, out = new Set(), depth = 0) {
  if (depth > 8 || out.size > 2000 || !node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((child) => collectIds(child, out, depth + 1));
    return out;
  }
  const id = Number(node.id);
  if (Number.isInteger(id) && id > 0) out.add(id);
  Object.values(node).forEach((child) => collectIds(child, out, depth + 1));
  return out;
}

/**
 * Район-id для фильтра. Основа — DEFAULT_AREA_IDS (то, что шлёт браузер). Дополнительно спрашиваем сайт
 * (GET /location/areas?city=…) и добавляем районы, которых в списке ещё нет. Эта часть НИКОГДА не роняет
 * запуск: любая ошибка или неожиданный ответ — просто остаёмся на сохранённом списке.
 */
async function resolveAreaIds(session) {
  if (process.env.INCIDENTS_AREA_IDS) {
    const ids = process.env.INCIDENTS_AREA_IDS.split(/[,\s]+/).map(Number).filter(Boolean);
    if (ids.length) {
      console.log(`районы: заданы вручную (INCIDENTS_AREA_IDS), ${ids.length} шт.`);
      return ids;
    }
  }

  try {
    const url = `${AREAS_URL}?city=${session.cityId}`;
    const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', Referer: PAGE_URL };
    if (session.cookie) headers.Cookie = session.cookie;

    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const found = [...collectIds(await res.json())];

    const known = new Set(DEFAULT_AREA_IDS);
    const extra = found.filter((id) => !known.has(id));
    console.log(`районы: в списке ${DEFAULT_AREA_IDS.length}, сайт вернул ${found.length}, новых ${extra.length}`);

    if (extra.length > MAX_EXTRA_AREAS) {
      console.warn(`районы: «новых» слишком много (${extra.length}) — ответ похож на что-то другое, беру сохранённый список`);
      return DEFAULT_AREA_IDS;
    }
    return [...DEFAULT_AREA_IDS, ...extra];
  } catch (err) {
    console.warn(`районы: не удалось уточнить на сайте (${err.message}) — беру сохранённый список из ${DEFAULT_AREA_IDS.length}`);
    return DEFAULT_AREA_IDS;
  }
}

// ─── Список инцидентов ───────────────────────────────────────────────────

/** POST /incident/ajax-incidents/current?page=N → JSON страницы. */
function fetchPage(n, session, areaIds) {
  const url = `${API_URL}?page=${n}`;
  if (n === 1) console.log(`запрос: POST ${new URL(url).pathname}?page=1, area_ids: ${areaIds.length} шт.`);

  return withRetries(url, async () => {
    const headers = {
      'User-Agent': USER_AGENT,
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest', // как у axios на сайте (api.ts)
      'X-CSRF-Token': session.token,
      Origin: new URL(PAGE_URL).origin,
      Referer: PAGE_URL,
    };
    if (session.cookie) headers.Cookie = session.cookie;

    // Тело — как у apiSearchFilter.fetchSearch на сайте: houses_ids, streets_ids, area_ids
    const body = JSON.stringify({ houses_ids: null, streets_ids: null, area_ids: areaIds });

    const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();

    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
    // 400/403 у Yii2 — это обычно «токен не принят»: вызывающий код откроет сессию заново
    if (res.status === 400 || res.status === 403) {
      throw fatal(`HTTP ${res.status} для POST ${url} (токен не принят?). Ответ: ${snippet(text)}`, { csrf: true });
    }
    if (!res.ok) throw fatal(`HTTP ${res.status} для POST ${url}. Ответ сервера: ${snippet(text)}`);

    try {
      return JSON.parse(text);
    } catch {
      // Чаще всего это HTML-заглушка: антибот, блокировка по региону или смена адреса API.
      throw fatal(`Ответ не JSON (content-type: ${res.headers.get('content-type')}). Начало ответа: ${snippet(text, 120)}`);
    }
  });
}

/** Листает ?page=1,2,… пока не соберёт totalCount записей (или пока страницы не кончатся). */
async function fetchAllPages() {
  let session = await openSession();
  const areaIds = await resolveAreaIds(session);

  // Если сервер отклонил токен — один раз открываем сессию заново и повторяем запрос
  const getPage = async (n) => {
    try {
      return await fetchPage(n, session, areaIds);
    } catch (err) {
      if (!err.csrf) throw err;
      console.warn('Сервер не принял CSRF-токен — открываю сессию заново');
      session = await openSession();
      return fetchPage(n, session, areaIds);
    }
  };

  const pages = [];
  const seen = new Set();

  for (let n = 1; n <= MAX_PAGES; n++) {
    const page = await getPage(n);
    const items = extractItems(page); // бросит ошибку, если формат ответа изменился
    const fresh = items.filter((item) => item?.id == null || !seen.has(item.id));
    fresh.forEach((item) => item?.id != null && seen.add(item.id));
    pages.push(page);

    const total = Number(page.totalCount) || 0;
    console.log(`страница ${n}: ${items.length} шт., новых ${fresh.length}, totalCount=${total || 'не указан'}`);

    // Стоп: страница пустая, ничего нового (API игнорирует page) или уже собрали всё.
    if (!items.length || !fresh.length || (total && seen.size >= total)) return { pages, collected: seen.size };

    await sleep(PAGE_DELAY_MS);
  }

  console.warn(`::warning::Достигнут лимит в ${MAX_PAGES} страниц — данные могут быть неполными`);
  return { pages, collected: seen.size };
}

/** Сколько записей было в прежнем файле (0, если файла нет или он повреждён). */
async function previousTotal() {
  try {
    return Number(JSON.parse(await readFile(OUT_FILE, 'utf8')).total) || 0;
  } catch {
    return 0;
  }
}

async function main() {
  const { pages, collected } = await fetchAllPages();
  const result = groupIncidents(pages);

  // Защита от «ложного спокойствия»: если фильтр не сработал, сервер отвечает 200 и пустым списком —
  // и мы бы затёрли хорошие данные надписью «Сейчас всё спокойно». За 12 часов от десятков записей до нуля не бывает.
  const before = await previousTotal();
  if (result.apiTotal === 0 && before >= 5 && !process.env.INCIDENTS_ALLOW_EMPTY) {
    throw new Error(
      `API вернул 0 записей, а в прежнем файле их было ${before}. Похоже, не сработал фильтр районов или изменился запрос; ` +
        'прежний файл сохранён. Если отключений действительно нет, запустите с INCIDENTS_ALLOW_EMPTY=1.',
    );
  }

  if (result.apiTotal && collected < result.apiTotal) {
    console.warn(`::warning::Собрано ${collected} из ${result.apiTotal} записей — страница могла сдвинуться во время загрузки`);
  }

  // Пишем во временный файл и переименовываем: упавший процесс не оставит обрезанный JSON.
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  const tmp = `${OUT_FILE}.tmp`;
  await writeFile(tmp, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await rename(tmp, OUT_FILE);

  const summary = `в работе ${result.total} (аварий ${result.emergency}, плановых ${result.planned})`;
  console.log(`Готово: ${summary} → ${OUT_FILE}`);
  for (const g of result.groups) console.log(`  ${g.name}: ${g.items.length}`);

  // Для сообщения коммита в workflow
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `summary=${summary}\n`);
}

main().catch((err) => {
  console.error(`::error::Не удалось обновить incidents.json: ${err.message}`);
  process.exitCode = 1;
});
