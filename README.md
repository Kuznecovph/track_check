# 🎧 TrackCheck v2 — проверка музыки, распознавание по звуку, исправление тегов

Клиентское веб-приложение для видеографов (React + Vite + TailwindCSS v4 + TypeScript,
хостинг — Netlify). Три возможности:

1. **Проверка прав** по бесплатным базам iTunes Search API и Deezer API (вердикты 🔴 / 🟡 /  + отчёт клиенту);
2. **FEATURE 1 — распознавание по звуку** («🎧 Identify by Audio»): Web Audio API декодирует файл
   в браузере, вырезает ~30 с фрагмент (моно, 16 кГц, WAV), а Netlify-функция `/api/identify`
   отправляет его в **AudD** (токен хранится в env, не в бандле) и возвращает Title / Artist / Album / Cover;
3. **FEATURE 2 — ID3 Tag Writer** («🏷️ Fix & Download Track»): `browser-id3-writer` внедряет
   теги (TIT2, TPE1, TALB, TYER, TCON, APIC) **полностью в браузере** и скачивает исправленный MP3.

> 🔒 **Приватность:** чтение тегов, распознающий фрагмент кроме фингерпринт-запроса и вся
> перезапись файла происходят в браузере. Для FEATURE 2 аудиофайл **никогда не покидает
> браузер** (см. комментарий-гарантию в `src/lib/id3export.ts`). Для FEATURE 1 в сервис
> распознавания уходит только короткий WAV-фрагмент (~1 МБ) — без этого распознавание
> по звуку невозможно; ключ AudD при этом живёт только в env функции.

## Структура

```
trackcheck/
├── index.html                     # Vite-точка входа
├── package.json / tsconfig.json / vite.config.ts
├── netlify.toml                   # build, publish=dist, функции, редиректы /api/*
├── src/
│   ├── App.tsx                    # оркестрация состояния и шагов UI
│   ├── main.tsx / index.css       # вход + тема Tailwind v4 (@theme)
│   ├── types.ts
│   ├── components/
│   │   ├── Dropzone.tsx           # drag & drop + выбор файла
│   │   ├── MetaForm.tsx           # поля метаданных, обложка, 3 кнопки, прогресс-бар
│   │   ├── ResultCard.tsx         # вердикт, совпадения, источники, отчёт
│   │   ├── Spinner.tsx / Toasts.tsx
│   └── lib/
│       ├── tags.ts                # jsmediatags: теги + встроенная обложка (локально)
│       ├── fingerprint.ts         # FEATURE 1: Web Audio → 30 c WAV-фрагмент
│       ├── identifyClient.ts      # FEATURE 1: POST /api/identify
│       ├── id3export.ts           # FEATURE 2: browser-id3-writer + скачивание (локально!)
│       ├── checkClient.ts         # /api/check + JSONP-резерв (iTunes+Deezer из браузера)
│       ├── similarity.ts          # нечёткое сравнение строк (зеркало check.py)
│       ├── report.ts / utils.ts
└── netlify/functions/
    ├── check.py                   # проверка прав (Python stdlib, iTunes+Deezer параллельно)
    └── identify.ts                # FEATURE 1: AudD-прокси (Node 20, токен из env)
```

## Деплой на Netlify (5 минут)

1. Залейте папку в GitHub-репозиторий.
2. Netlify → **Add new site → Import from Git**. Build command / publish directory
   подхватятся из `netlify.toml` (`npm run build` → `dist`).
3. **Site configuration → Environment variables** → добавьте
   `AUDD_API_TOKEN` (бесплатный токен: <https://audd.io>) → redeploy.
4. Проверка:
   - `https://<site>/api/check?title=Blinding%20Lights&artist=The%20Weeknd` → JSON с `"found": true`;
   - `POST https://<site>/api/identify` (байты WAV) → JSON с метаданными.

Без токена AudD сайт полностью работоспособен: проверка прав, теги, экспорт MP3;
кнопка распознавания покажет понятную ошибку-инструкцию.

### Деплой на GitHub Pages (статика, без функций)

1. Создайте репозиторий на GitHub и залейте туда содержимое проекта
   (`git init && git add . && git commit -m "TrackCheck v2" && git push`).
2. В репозитории: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Каждый push в `main` запускает workflow `.github/workflows/pages.yml`:
   `npm ci → npm run build → deploy dist/`. Сайт: `https://<user>.github.io/<repo>/`
   (Vite собран с `base: './'`, поэтому ассеты работают из подпапки).
4. Что работает на Pages из коробки: проверка прав (JSONP-резерв iTunes+Deezer
   из браузера), чтение тегов, 🏷️ экспорт MP3 — всё локально.
5. 🎧 Распознавание по звуку требует серверную функцию (ключ AudD, CORS):
   задеплойте функции на Netlify (Drop-бандл `trackcheck-v2-drop.zip` или Git-деплой),
   затем в GitHub: **Settings → Secrets and variables → Actions → Variables** →
   `VITE_API_BASE = https://<ваш-сайт>.netlify.app` → перезапустите workflow.
   Функции отдают `Access-Control-Allow-Origin: *`, кросс-домен разрешён.

### Локальная разработка

```bash
npm install
npm run dev        # http://localhost:5173 (функции локально требует netlify dev + Docker для check.py)
npm run build      # typecheck + прод-сборка в dist/
```

Без `netlify dev` проверка прав автоматически уходит в JSONP-резерв (обе базы из браузера),
распознавание требует задеплоенную функцию с токеном.

## Как работает FEATURE 1 (Identify by Audio)

```
файл → AudioContext.decodeAudioData (браузер)
     → OfflineAudioContext: окно ~30 с из середины, моно, 16 кГц
     → WAV PCM16 (~1 МБ) → POST /api/identify (сырые байты)
     → Netlify Function: multipart → api.audd.io (api_token из env, return=apple_music)
     → { found, title, artist, album, year, artwork } → автозаполнение формы + тост
     → сразу запускается проверка прав по свежим данным
```

Ошибки: «Track not found in database» (база не узнала фрагмент), таймаут 30 с,
503 с инструкцией при отсутствии токена.

## Как работает FEATURE 2 (Fix & Download)

```
исходный File → file.arrayBuffer()          (ЛОКАЛЬНО, без сети)
              → ID3Writer.setFrame(TIT2/TPE1/TALB/TYER/TCON/APIC)
              → writer.addTag() → Blob audio/mpeg → object URL → <a download>
```

- Кнопка активна, когда есть файл + Название + Исполнитель (обложка встраивается,
  если присутствует: из тегов файла, из AudD или загружена вручную — по желанию).
- Прогресс-бар с этапами: чтение → запись тегов → ссылка → готово.
- Ошибка формата/записи: «Failed to write tags. Please use an MP3 file.»

## Известные ограничения

| Ограничение | Обработка |
|---|---|
| `jsmediatags` не читает FLAC/WAV/OGG | fallback: разбор имени файла + ручной ввод |
| У пакета `jsmediatags` сломано поле `browser` | alias в `vite.config.ts` на UMD-билд |
| AudD без токена не работает | 503 с инструкцией; остальной функционал не страдает |
| Deezer иногда отдаёт 403 с облачных IP | вердикт по iTunes + JSONP-резерв, статус виден в UI |
| Обложка с чужого CDN может не отдать CORS | экспорт продолжится без обложки с уведомлением |

## Дисклеймер

Сервис информационный: «не найден» ≠ «свободен от авторских прав». Перед публикацией видео
получайте письменное разрешение правообладателя или лицензию музыкальной библиотеки.
