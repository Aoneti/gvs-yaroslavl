# Отключение горячей воды в Ярославле

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub Pages](https://img.shields.io/badge/Hosted-GitHub_Pages-222222?logo=github)](https://aoneti.github.io/gvs-yaroslavl/)
[![Static Site](https://img.shields.io/badge/Type-Static_Website-brightgreen)](https://aoneti.github.io/gvs-yaroslavl/)

Статический сайт для жителей Ярославля: график плановых отключений горячего водоснабжения (ГВС) по адресам, интерактивная карта и действующие аварии ЖКХ. Бэкенда нет — всё работает на GitHub Pages, а свежие данные об авариях подтягивает GitHub Actions.

<div align="center">

### **[Открыть сайт](https://aoneti.github.io/gvs-yaroslavl/)**

</div>

## Возможности

- **Поиск по адресу** — улица и номер дома, частичные совпадения; для каждого дома показаны ремонт, два этапа гидравлических испытаний и дата, с которой возвращается вода.
- **Статистика и календарь** — сколько адресов без ГВС сегодня, сколько начнут отключать в ближайшие дни, пик отключений; три вида: календарь, график, таблица. Клик по дню показывает адреса, клик по адресу подставляет его в поиск.
- **Карта** — те же адреса на карте с кластеризацией и фильтром по типу работ.
- **Аварии и отключения ЖКХ** — действующие аварии и плановые работы по воде, отоплению, электричеству и газу: поиск, фильтр «аварии / плановые», разделы, телефоны служб (ссылки `tel:`), предупреждение, если данные давно не обновлялись.
- **Оформление** — тёмная и светлая темы, адаптивная вёрстка, свои шрифты, иконки и фон-паттерн.

## Страницы

| Страница | Что на ней |
|---|---|
| `index.html` | Поиск по графику ГВС, статистика, календарь, вопросы и ответы |
| `map.html` | Карта отключений |
| `incidents.html` | Аварии и отключения ЖКХ |

## Структура проекта

```
├── index.html, map.html, incidents.html   # страницы
├── styles.css            # общие стили: тема, шрифты, иконки, фон, скролл, виджеты
├── config.js             # настройки (лимиты, карта, адрес incidents.json)
├── site.js               # общее: SVG-иконки (GVS_UI.icon) и год в подвале
├── gvs-core.js           # общая логика: нормализация, периоды, статусы
├── app-index.js          # главная: поиск и карточки
├── app-stats.js          # главная: статистика и календарь
├── stats-core.js         # подсчёт уникальных адресов по дням
├── app-map.js            # карта
├── app-incidents.js      # страница аварий
├── incidents-badge.js    # счётчик на кнопке «Аварии и отключения» (главная)
├── ui-widgets.js         # виджеты «Аналитика» и «Свежие новости»
├── analytics.js          # Яндекс.Метрика
├── theme-init.js         # выбор темы до отрисовки страницы
├── data.json             # график отключений ГВС
├── geo.json              # координаты адресов
├── incidents.json        # аварии ЖКХ (обновляет GitHub Actions)
├── manifest.webmanifest, sitemap.xml, robots.txt, llms.txt   # для браузеров, поисковиков и ИИ-краулеров
├── assets/               # icons.svg (спрайт), фавикон, иконки приложения, og-image.png
├── fonts/                # Dela Gothic One и Golos Text (woff2) и лицензия OFL
├── vendor/               # Leaflet и MarkerCluster
├── scripts/              # подготовка данных (ГВС) и загрузка аварий
├── .github/workflows/    # fetch-incidents.yml
├── gvs-core.test.js, stats-core.test.js   # тесты
├── LICENSE
└── README.md
```

## Как это работает

### График ГВС: Excel → JSON → координаты

```
Excel-файл отключений → scripts/convert.ipynb → data.json → scripts/geocoder.ipynb → geo.json
```

Оба блокнота запускаются в Google Colab, подробности — в [scripts/README.md](scripts/README.md). Готовые `data.json` и `geo.json` кладутся в корень репозитория.

### Аварии и отключения ЖКХ: GitHub Actions

Браузер не может читать `moydom-yaroslavl.ru` напрямую (CORS), поэтому данные собирает workflow `.github/workflows/fetch-incidents.yml`:

1. Раз в 12 часов (cron `0 0,12 * * *`, время UTC) и по кнопке *Actions → Fetch incidents → Run workflow* запускается `scripts/fetch-incidents.mjs`.
2. Скрипт открывает страницу `/incident`, берёт CSRF-токен и cookie, затем шлёт `POST /incident/ajax-incidents/current?page=N` с тем же телом, что и сайт (список районов Ярославля), и листает все страницы.
3. `scripts/incidents-core.mjs` оставляет записи со `status.type === "in"`, определяет «авария / план», собирает контакты и группирует по разделам (порядок — константа `GROUP_ORDER`, разделы про горячую воду идут первыми).
4. Результат записывается в `incidents.json` и коммитится. Коммит бота сам не запускает сборку Pages, поэтому последний шаг workflow просит её через API.

Если загрузка не удалась, `incidents.json` остаётся прежним, а страница через `INCIDENTS_STALE_HOURS` часов покажет предупреждение «данные могли устареть». Если API вернёт 0 записей при непустом прежнем файле, скрипт тоже ничего не затирает и падает с пояснением.

> Если GitHub Pages у вас настроен через «GitHub Actions», а не «Deploy from a branch», замените последний шаг workflow на запуск вашего deploy-workflow: `gh workflow run <файл>.yml`.

## Запуск и разработка

```bash
python3 -m http.server 8000      # затем открыть http://localhost:8000/
node --test                      # тесты (Node 18+)
node scripts/fetch-incidents.mjs # обновить incidents.json вручную
```

Открывать `index.html` двойным кликом (`file://`) нельзя: страницы загружают JSON и SVG-спрайт запросами.

## Конфигурация

Все числа и пути — в `config.js`:

| Ключ | Что делает |
|---|---|
| `PER_PAGE`, `MAX_LIST_ITEMS` | размер страницы поиска и список на карте |
| `SOON_DAYS` | за сколько дней до начала работ адрес считается «скоро» |
| `MAP_CENTER`, `MAP_ZOOM_*`, `CLUSTER_RADIUS` | параметры карты |
| `FETCH_TIMEOUT_MS`, `FETCH_RETRY_*` | таймаут и повторы загрузки данных |
| `INCIDENTS_URL` | путь к `incidents.json` (без ведущего `/`: сайт живёт в подпапке) |
| `INCIDENTS_STALE_HOURS` | через сколько часов без обновления показывать предупреждение |

## Оформление

- **Цвета и темы** — переменные в начале `styles.css` (`:root` для тёмной, `html.light` для светлой). Тема выбирается скриптом `theme-init.js` до отрисовки.
- **Шрифты** — Dela Gothic One для заголовков и крупных цифр, Golos Text для текста; файлы лежат в `fonts/`, подключены в `styles.css`. У Dela Gothic One одно начертание, поэтому вес объявлен диапазоном, чтобы браузер не рисовал фальшивый полужирный.
- **Иконки** — спрайт `assets/icons.svg`. В разметке: `<svg class="icon"><use href="assets/icons.svg#i-search"></use></svg>`, в JS: `GVS_UI.icon('search')`. Новую иконку добавляют новым `<symbol id="i-имя" viewBox="0 0 24 24" …>` по образцу соседних. Эмодзи в вёрстке не используются.
- **Фон** — паттерн «волны» из двух синусоид в `--wave`, включается классом `bg-waves` на `<body>`.
- **Полосы прокрутки** — общий тонкий вариант в `styles.css`.
- **Фавикон и иконки приложения** — `assets/favicon.svg` (основной), `favicon.ico`, `apple-touch-icon.png`, `icon-192/512.png`; обложка для соцсетей — `assets/og-image.png`.

## SEO и GEO

Что уже сделано на каждой странице: уникальные `title` и `description`, канонический адрес, `hreflang`, Open Graph и Twitter Cards с обложкой, геометки Ярославля (`geo.*`, ICBM), структурированные данные schema.org (WebSite, WebApplication, WebPage, BreadcrumbList, Dataset, FAQPage), блок вопросов и ответов на главной и странице аварий, один `<h1>` и ландмарки `<main>` / `<header>` / `<footer>`, предзагрузка шрифтов, `sitemap.xml`, `llms.txt` с описанием сайта и данных для ИИ-поиска.

Что сделать после публикации:

1. Добавить сайт в [Яндекс Вебмастер](https://webmaster.yandex.ru) и [Google Search Console](https://search.google.com/search-console), отправить `sitemap.xml`. Подтвердить права можно через уже подключённую Метрику.
2. В Яндекс Вебмастере указать регион сайта — Ярославль (раздел «Региональность»).
3. Проверить превью ссылки в Telegram и VK.
4. При переезде на свой домен заменить адрес во всех файлах одной командой:

   ```bash
   grep -rl "aoneti.github.io/gvs-yaroslavl" . --include="*.html" --include="*.xml" --include="*.txt" \
     | xargs sed -i 's#https://aoneti.github.io/gvs-yaroslavl/#https://ваш-домен/#g'
   ```

   Заодно `robots.txt` начнёт работать: на адресе вида `*.github.io/gvs-yaroslavl/` поисковики его не читают, они ищут файл только в корне домена.

## Ежегодное обновление

1. Подготовить новые `data.json` и `geo.json` (см. [scripts/README.md](scripts/README.md)).
2. Заменить год в заголовках и описаниях: `grep -n "2026" *.html`. Год в подвале обновляется сам.

## Лицензии и источники

- Код проекта — MIT, см. [LICENSE](LICENSE).
- Шрифты Dela Gothic One и Golos Text — SIL Open Font License 1.1 (`fonts/`).
- Иконки — [Lucide](https://lucide.dev), лицензия ISC; знак «капля с пламенем» нарисован для проекта.
- Карта: [Leaflet](https://leafletjs.com) (BSD-2-Clause), [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) (MIT), данные © участники [OpenStreetMap](https://www.openstreetmap.org/copyright).
- Аварии и отключения ЖКХ — диспетчерская служба ЖКХ Ярославля через сервис [«Мой Дом»](https://moydom-yaroslavl.ru/incident).

> **Важно**: данные об отключениях — общедоступная информация, которую предоставляют коммунальные службы Ярославля. Проект не является официальным ресурсом и носит информационный характер. Для юридически значимых сведений обращайтесь в управляющие компании или на порталы государственных услуг.

---

<div align="center">

*Разработано специально для сетевого издания «[Яркуб](https://yarcube.ru)» с заботой о жителях Ярославля*

</div>
