#!/usr/bin/env node
// Скачивает действующие инциденты с «Мой Дом» (все страницы), группирует и сохраняет в incidents.json.
//
// Запускается из GitHub Actions (.github/workflows/fetch-incidents.yml) и вручную:
//   node scripts/fetch-incidents.mjs
//
// Переменные окружения (нужны в основном для тестов):
//   INCIDENTS_API_URL — адрес API без ?page=  (по умолчанию https://moydom-yaroslavl.ru/incident/current)
//   INCIDENTS_OUT     — куда писать результат (по умолчанию <корень репозитория>/incidents.json)
//
// Если загрузка не удалась, скрипт завершается с кодом 1 и НЕ трогает прежний файл:
// сайт продолжит показывать последние удачные данные, а плашка «данные устарели»
// на странице предупредит посетителей.

import { appendFile, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractItems, groupIncidents } from './incidents-core.mjs';

const API_URL = process.env.INCIDENTS_API_URL || 'https://moydom-yaroslavl.ru/incident/current';
const OUT_FILE =
  process.env.INCIDENTS_OUT ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'incidents.json');

const MAX_PAGES = 30; // предохранитель от бесконечного цикла (сейчас ~3 страницы по 20 записей)
const TIMEOUT_MS = 20_000; // на один запрос
const ATTEMPTS = 3; // попыток на одну страницу
const RETRY_BASE_MS = Number(process.env.INCIDENTS_RETRY_BASE_MS) || 2_000; // 2 с, затем 6 с
const PAGE_DELAY_MS = 400; // пауза между страницами — не нагружаем чужой сервер

const HEADERS = {
  Accept: 'application/json',
  // Сайт отдаёт JSON на XHR-запросы: так ходит и его собственный фронтенд (см. api.ts).
  'X-Requested-With': 'XMLHttpRequest',
  'User-Agent': 'gvs-yaroslavl-bot (+https://github.com/Aoneti/gvs-yaroslavl)',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ошибка, которую повторять бессмысленно (4xx, не-JSON). */
const fatal = (message) => Object.assign(new Error(message), { fatal: true });

/** GET → JSON с таймаутом и повторами (сетевые сбои, 429, 5xx). */
async function fetchJson(url) {
  let lastError;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });

      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw fatal(`HTTP ${res.status} для ${url}`);

      const body = await res.text();
      try {
        return JSON.parse(body);
      } catch {
        // Чаще всего это HTML-заглушка: антибот, блокировка по региону или смена адреса API.
        const type = res.headers.get('content-type');
        throw fatal(`Ответ не JSON (content-type: ${type}). Начало ответа: ${body.slice(0, 120).replace(/\s+/g, ' ')}`);
      }
    } catch (err) {
      lastError = err;
      if (err.fatal || attempt === ATTEMPTS) break;

      const wait = RETRY_BASE_MS * 3 ** (attempt - 1);
      console.warn(`[${url}] попытка ${attempt}/${ATTEMPTS}: ${err.message}. Повтор через ${wait / 1000} с`);
      await sleep(wait);
    }
  }

  throw lastError;
}

/** Листает ?page=1,2,… пока не соберёт totalCount записей (или пока страницы не кончатся). */
async function fetchAllPages() {
  const pages = [];
  const seen = new Set();

  for (let n = 1; n <= MAX_PAGES; n++) {
    const page = await fetchJson(`${API_URL}?page=${n}`);
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
