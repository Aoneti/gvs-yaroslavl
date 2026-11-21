# Скрипты обновления данных

Два Colab-блокнота готовят график отключений ГВС, два Node-скрипта собирают аварии ЖКХ. Блокноты запускаются вручную при обновлении графика, Node-скрипты работают сами (GitHub Actions) или по команде.

---

## Общий порядок работы

```
График ГВС:
Excel-файл отключений → convert.ipynb → data.json → geocoder.ipynb → geo.json → загрузить оба файла в репозиторий

Аварии и отключения ЖКХ:
GitHub Actions (раз в 12 часов) → fetch-incidents.mjs → incidents.json → коммит в репозиторий
```

---

## 1. `convert.ipynb` — конвертация Excel в json

Конвертирует таблицу отключений из Excel в `data.json`, который читает сайт.

**Что делает:**
- Читает все листы `.xlsx`-файла
- Нормализует адреса
- Удаляет дубликаты
- Сохраняет результат в `data.json`

---

## 2. `geocoder.ipynb` — геокодирование адресов

Берёт адреса из `data.json` и получает для каждого координаты через [Nominatim (OpenStreetMap)](https://nominatim.openstreetmap.org). Результат сохраняется в `geo.json`.

**Что делает:**
- Загружает данные из `data.json`
- Для каждого уникального адреса пробует 4 стратегии запроса к Nominatim (от самой точной к приближённой)
- Валидирует каждый результат
- Кэширует результаты в `geo.json` после **каждого** адреса

---

## 3. `fetch-incidents.mjs` — загрузка аварий и отключений

Скачивает действующие инциденты с [«Мой Дом»](https://moydom-yaroslavl.ru/incident) и сохраняет их в `incidents.json` в корне репозитория. Запускается workflow `.github/workflows/fetch-incidents.yml` и вручную:

```bash
node scripts/fetch-incidents.mjs     # Node 18+
```

**Что делает:**
- Открывает страницу `/incident` и берёт из неё cookie и CSRF-токен, как браузер
- Листает `POST /incident/ajax-incidents/current?page=N`, пока не соберёт все записи
- Передаёт ответы в `incidents-core.mjs` и атомарно записывает `incidents.json`
- При любой ошибке завершается с кодом 1 и не трогает прежний файл

Переменные окружения нужны в основном для тестов: `INCIDENTS_SITE_URL`, `INCIDENTS_API_URL`, `INCIDENTS_PAGE_URL`, `INCIDENTS_AREAS_URL`, `INCIDENTS_AREA_IDS`, `INCIDENTS_ALLOW_EMPTY`, `INCIDENTS_OUT` — описаны в начале файла.

## 4. `incidents-core.mjs` — разбор и группировка

Чистая логика без сети и файлов: оставляет записи «в работе», определяет метку «авария / план», формирует строку контактов, сортирует и группирует по разделам. Порядок разделов задаёт константа `GROUP_ORDER`. Покрыта тестами `incidents-core.test.mjs` (`node --test` из корня репозитория).
