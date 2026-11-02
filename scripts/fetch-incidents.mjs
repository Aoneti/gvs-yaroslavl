#!/usr/bin/env node
// Скачивает действующие инциденты с «Мой Дом» (все страницы), группирует и сохраняет в incidents.json.
//
// Запускается из GitHub Actions (.github/workflows/fetch-incidents.yml) и вручную:
//   node scripts/fetch-incidents.mjs
//
// Как устроен запрос. Список на сайте подгружается скриптом: адрес /incident/current отвечает
// только на POST и только с CSRF-токеном (по GET там 404). Поэтому мы делаем то же, что браузер:
//   1. открываем обычную страницу /incident и берём из неё cookie и <meta name="csrf-token">;
//   2. шлём POST /incident/current?page=N с пустым фильтром (как поиск на самом сайте, см. api.ts).
//
// Переменные окружения (нужны в основном для тестов):
//   INCIDENTS_API_URL  — адрес списка без ?page=   (по умолчанию https://moydom-yaroslavl.ru/incident/current)
//   INCIDENTS_PAGE_URL — страница, с которой берём токен (по умолчанию https://moydom-yaroslavl.ru/incident)
//   INCIDENTS_OUT      — куда писать результат     (по умолчанию <корень репозитория>/incidents.json)
//
// Если загрузка не удалась, скрипт завершается с кодом 1 и НЕ трогает прежний файл:
// сайт продолжит показывать последние удачные данные, а плашка «данные устарели»
// на странице предупредит посетителей.

import { appendFile, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractItems, groupIncidents } from './incidents-core.mjs';

const API_URL = process.env.INCIDENTS_API_URL || 'https://moydom-yaroslavl.ru/incident/current';
const PAGE_URL = process.env.INCIDENTS_PAGE_URL || 'https://moydom-yaroslavl.ru/incident';
const OUT_FILE =
  process.env.INCIDENTS_OUT ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'incidents.json');

const MAX_PAGES = 30; // предохранитель от бесконечного цикла (сейчас ~3 страницы по 20 записей)
const TIMEOUT_MS = 20_000; // на один запрос
const ATTEMPTS = 3; // попыток на один запрос
const RETRY_BASE_MS = Number(process.env.INCIDENTS_RETRY_BASE_MS) || 2_000; // 2 с, затем 6 с
const PAGE_DELAY_MS = 400; // пауза между страницами — не нагружаем чужой сервер

const USER_AGENT = 'gvs-yaroslavl-bot (+https://github.com/Aoneti/gvs-yaroslavl)';

// Пустой фильтр = все текущие инциденты. Тело такое же, как отправляет поиск на сайте (api.ts → fetchSearch).
const FILTER = { houses_ids: null, streets_ids: null, area_ids: null };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ошибка, которую повторять бессмысленно (4xx, не-JSON, нет токена). */
const fatal = (message, extra = {}) => Object.assign(new Error(message), { fatal: true, ...extra });

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

/** Обычная страница сайта → cookie и CSRF-токен (так делает браузер перед любым XHR). */
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

    // В журнал — только имена cookie и факт наличия токена, сами значения не печатаем.
    const names = cookies.map((c) => c.split('=')[0]).join(', ') || 'нет';
    console.log(`сессия: HTTP ${res.status}, cookie: ${names}, csrf-токен: ${token ? 'есть' : 'НЕ НАЙДЕН'}`);

    if (!token) {
      const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim().slice(0, 80);
      throw fatal(
        `На странице ${PAGE_URL} нет <meta name="csrf-token"> (заголовок страницы: «${title ?? 'нет'}»). ` +
          'Либо изменилась вёрстка сайта, либо вместо страницы пришла заглушка антибота.',
      );
    }
    return { token, cookie: cookies.join('; ') };
  });
}

/** POST /incident/current?page=N → JSON страницы. */
function fetchPage(n, session) {
  const url = `${API_URL}?page=${n}`;

  return withRetries(url, async () => {
    const headers = {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest', // как у axios на сайте (api.ts)
      'X-CSRF-Token': session.token,
      Origin: new URL(PAGE_URL).origin,
      Referer: PAGE_URL,
    };
    if (session.cookie) headers.Cookie = session.cookie;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(FILTER),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
    // 400/403 у Yii2 — это обычно «токен не принят»: вызывающий код откроет сессию заново
    if (res.status === 400 || res.status === 403) throw fatal(`HTTP ${res.status} для ${url} (токен не принят?)`, { csrf: true });
    if (!res.ok) throw fatal(`HTTP ${res.status} для POST ${url}. Сервер не знает такого адреса или метода — проверьте запрос в DevTools (Network → Fetch/XHR).`);

    const body = await res.text();
    try {
      return JSON.parse(body);
    } catch {
      // Чаще всего это HTML-заглушка: антибот, блокировка по региону или смена адреса API.
      const type = res.headers.get('content-type');
      throw fatal(`Ответ не JSON (content-type: ${type}). Начало ответа: ${body.slice(0, 120).replace(/\s+/g, ' ')}`);
    }
  });
}

/** Листает ?page=1,2,… пока не соберёт totalCount записей (или пока страницы не кончатся). */
async function fetchAllPages() {
  let session = await openSession();

  // Если сервер отклонил токен — один раз открываем сессию заново и повторяем запрос
  const getPage = async (n) => {
    try {
      return await fetchPage(n, session);
    } catch (err) {
      if (!err.csrf) throw err;
      console.warn('Сервер не принял CSRF-токен — открываю сессию заново');
      session = await openSession();
      return fetchPage(n, session);
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

async function main() {
  const { pages, collected } = await fetchAllPages();
  const result = groupIncidents(pages);

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
