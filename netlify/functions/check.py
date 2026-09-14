# -*- coding: utf-8 -*-
"""
Netlify Function «check» → доступна по адресу  /api/check  (см. редирект в netlify.toml)
════════════════════════════════════════════════════════════════════════════════════════
Проверяет музыкальный трек по двум БЕСПЛАТНЫМ базам (без ключей и регистрации):

  • iTunes Search API — https://itunes.apple.com/search
  • Deezer API        — https://api.deezer.com/search/track

Принципиальные моменты:
  • Аудиофайл на сервер НЕ попадает — фронтенд присылает только текст: «название» и «исполнитель».
  • Используется ТОЛЬКО стандартная библиотека Python (urllib, json, difflib и т.д.),
    поэтому функция деплоится на Netlify без pip install и без сборки.
  • Обе базы опрашиваются ПАРАЛЛЕЛЬНО (ThreadPoolExecutor), таймаут каждого
    запроса — 6 сек. Если одна база «лежит» (Deezer иногда блокирует облачные IP),
    вердикт всё равно выносится по второй, а статус ошибки виден в ответе.
  • Совпадения не просто берутся «первым результатом поиска»: название и
    исполнитель сравниваются с кандидатами нечётко (нормализация + рейтинг
    схожести), чтобы отсечь мусор вроде одноимённых треков других артистов.

Запрос (GET или POST, параметры title / artist — хотя бы один):
  GET  /api/check?title=Blinding+Lights&artist=The+Weeknd
  POST /api/check  {"title": "...", "artist": "..."}

Ответ 200:
  {
    "ok": true,
    "found": true|false,            # найдено ли ТОЧНОЕ совпадение в коммерч. базе
    "query": {"title": "...", "artist": "..."},
    "matches":  [ {...}, ... ],      # подтверждённые совпадения (вердикт 🔴)
    "possible": [ {...}, ... ],      # похожие — для ручной проверки
    "sources": {                     # состояние каждой базы
       "itunes": {"ok": true,  "results": 7, "error": null},
       "deezer": {"ok": false, "results": 0, "error": "HTTP Error 403: Forbidden"}
    },
    "checkedAt": "2026-09-14T10:00:00+00:00"
  }
"""

import base64
import difflib
import json
import re
import unicodedata
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

# ──────────────────────────── Настройки ────────────────────────────

REQUEST_TIMEOUT = 6     # таймаут одного HTTP-запроса к API, сек
MAX_RESULTS = 15        # сколько кандидатов просим у каждой базы

# «Браузерный» User-Agent: некоторые CDN (в т.ч. Deezer) не любят python-urllib
USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# Пороги схожести (0..1) для вынесения вердикта
TITLE_CONFIRM = 0.80    # насколько должно совпасть название (при указанном артисте)
ARTIST_CONFIRM = 0.65   # насколько должен совпасть исполнитель
ONLY_CONFIRM = 0.85     # порог, если в запросе только название ИЛИ только артист
POSSIBLE_MIN = 0.50     # порог для блока «похожие совпадения — проверьте вручную»

# Слова-«шум»: переиздания одного и того же произведения, не влияющие на права
NOISE_WORDS = {"remastered", "remaster", "explicit", "mono", "stereo"}


# ──────────────── Нормализация строк и оценка схожести ────────────────

def _fold(s) -> str:
    """Регистр + диакритика вниз: 'Björk' == 'Bjork', 'ЁЖИК' == 'ёжик' -> 'ежик'."""
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower()


def _clean(s) -> str:
    """
    Приводит строку к форме, пригодной для сравнения:
      1) убирает содержимое скобок: '(Remix)', '[Live]', '{Bonus}' — это версии
         того же произведения;
      2) убирает пунктуацию;
      3) выбрасывает слова-«шум» и чисто числовые токены (номера треков, годы).
    """
    s = _fold(s)
    s = re.sub(r"[\(\[\{][^\)\]\}]*[\)\]\}]", " ", s)
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    tokens = [t for t in s.split() if t not in NOISE_WORDS and not t.isdigit()]
    return " ".join(tokens)


def similarity(a, b) -> float:
    """
    Схожесть двух строк от 0 до 1. Максимум из трёх метрик:
      • difflib.ratio  — посимвольная (ловит опечатки: 'Imagin Dragons');
      • Жаккар         — пересечение токенов (ловит перестановку слов);
      • вхождение      — 'ночь' ⊂ 'ночь remaster' → 0.9 (то же произведение).
    """
    na, nb = _clean(a), _clean(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    ratio = difflib.SequenceMatcher(None, na, nb).ratio()
    ta, tb = set(na.split()), set(nb.split())
    jaccard = len(ta & tb) / len(ta | tb)
    contain = 0.90 if (na in nb or nb in na) else 0.0
    return max(ratio, jaccard, contain)


# ─────────────────────────── HTTP-слой ───────────────────────────

def _http_get_json(url: str):
    """GET-запрос с таймаутом и парсингом JSON. Бросает исключение при ошибке."""
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ─────────────────────────── iTunes ───────────────────────────

def search_itunes(title: str, artist: str) -> dict:
    """
    Поиск в iTunes Search API (бесплатный, без ключа).
    Сначала ищем по «название + артист»; если пусто — только по названию.
    Возвращает {'ok': bool, 'items': [...], 'error': str|None}.
    """
    def parse(data):
        items = []
        for r in data.get("results", []) or []:
            items.append({
                "source": "iTunes",
                "title":  r.get("trackName") or "",
                "artist": r.get("artistName") or "",
                "album":  r.get("collectionName") or "",
                "year":   (r.get("releaseDate") or "")[:4],
                "url":    r.get("trackViewUrl") or "",
            })
        return items

    queries = [f"{title} {artist}".strip()]
    if title and artist:
        queries.append(title)          # запасной запрос — только по названию

    got_success, last_err = False, None
    for q in queries:
        try:
            url = "https://itunes.apple.com/search?" + urllib.parse.urlencode({
                "term": q, "media": "music", "entity": "song", "limit": MAX_RESULTS,
            })
            items = parse(_http_get_json(url))
            got_success = True
            if items:
                return {"ok": True, "items": items, "error": None}
        except Exception as e:         # сеть/парсинг — запоминаем, пробуем дальше
            last_err = f"{type(e).__name__}: {e}"

    if got_success:
        return {"ok": True, "items": [], "error": last_err}   # база ответила: пусто
    return {"ok": False, "items": [], "error": last_err or "iTunes не ответил"}


# ─────────────────────────── Deezer ───────────────────────────

def search_deezer(title: str, artist: str) -> dict:
    """
    Поиск в Deezer API (бесплатный, без ключа).

    ВАЖНО: «продвинутый» синтаксис  track:"..." artist:"..."  с облачных IP
    (Netlify/AWS) стабильно возвращает 0 результатов, поэтому начинаем с
    простого поискового запроса «название артист», а как запасной вариант
    используем  track:"название". Лишнее отсеивается скорингом ниже.

    Возвращает {'ok': bool, 'items': [...], 'error': str|None}.
    """
    def parse(data):
        items = []
        for r in data.get("data", []) or []:
            items.append({
                "source": "Deezer",
                # title_short — название без «(feat. ...)»: удобнее сравнивать
                "title":  r.get("title_short") or r.get("title") or "",
                "artist": (r.get("artist") or {}).get("name", ""),
                "album":  (r.get("album") or {}).get("title", ""),
                "year":   "",
                "url":    r.get("link") or "",
            })
        return items

    queries = []
    if title and artist:
        queries += [f"{title} {artist}", f'track:"{title}"']
    elif title:
        queries += [title, f'track:"{title}"']
    elif artist:
        queries += [artist]

    got_success, last_err = False, None
    for q in queries:
        try:
            url = "https://api.deezer.com/search/track?" + urllib.parse.urlencode(
                {"q": q, "limit": MAX_RESULTS})
            data = _http_get_json(url)

            # Deezer возвращает ошибку кодом 800 («нет данных») — это просто пустой результат
            if isinstance(data.get("error"), dict):
                if data["error"].get("code") == 800:
                    got_success = True
                    continue
                last_err = data["error"].get("message") or f"Deezer error {data['error'].get('code')}"
                continue

            got_success = True
            items = parse(data)
            if items:
                return {"ok": True, "items": items, "error": None}
        except Exception as e:
            # В т.ч. HTTP 403: Deezer периодически блокирует дата-центровые IP.
            # Это не роняет функцию — вердикт вынесется по iTunes.
            last_err = f"{type(e).__name__}: {e}"

    if got_success:
        return {"ok": True, "items": [], "error": last_err}
    return {"ok": False, "items": [], "error": last_err or "Deezer не ответил"}


# ───────────────────── Скоринг и сборка результатов ─────────────────────

def _score_item(q_title: str, q_artist: str, item: dict) -> dict:
    """Считает схожесть кандидата с запросом и флаг confirmed (точное совпадение)."""
    t = similarity(q_title, item["title"]) if q_title else None
    a = similarity(q_artist, item["artist"]) if q_artist else None

    if t is not None and a is not None:
        score = 0.6 * t + 0.4 * a
        confirmed = (t >= TITLE_CONFIRM and a >= ARTIST_CONFIRM)
    elif t is not None:                      # запрос только по названию
        score, confirmed = t, t >= ONLY_CONFIRM
    else:                                    # запрос только по артисту
        score, confirmed = a, a >= ONLY_CONFIRM

    scored = dict(item)
    scored.update({
        "titleScore":  None if t is None else round(t, 3),
        "artistScore": None if a is None else round(a, 3),
        "score":       round(score, 3),
        "confirmed":   confirmed,
    })
    return scored


def _dedupe(items: list) -> list:
    """
    Объединяет дубликаты из iTunes и Deezer в одну карточку:
    один и тот же трек показывается один раз, но с двумя бейджами источников.
    """
    merged, order = {}, []
    for it in items:
        key = (_clean(it["title"]), _clean(it["artist"]))
        if key in merged:
            if it["source"] not in merged[key]["sources"]:
                merged[key]["sources"].append(it["source"])
            if it["score"] > merged[key]["score"]:
                merged[key].update({k: it[k] for k in
                                    ("score", "confirmed", "titleScore", "artistScore")})
        else:
            it = dict(it)
            it["sources"] = [it["source"]]
            merged[key] = it
            order.append(key)
    return [merged[k] for k in order]


# ─────────────────── Вспомогательные функции handler ───────────────────

def _extract_params(event: dict) -> dict:
    """Достаёт параметры из query-строки (GET) и/или тела запроса (POST: JSON или форма)."""
    params = {}
    params.update(event.get("queryStringParameters") or {})

    body = event.get("body") or ""
    if body:
        if event.get("isBase64Encoded"):
            try:
                body = base64.b64decode(body).decode("utf-8", "replace")
            except Exception:
                body = ""
        try:                                             # POST с JSON
            data = json.loads(body)
            if isinstance(data, dict):
                params.update({k: v for k, v in data.items()
                               if isinstance(v, (str, int, float))})
        except (ValueError, TypeError):                  # POST с формой title=..&artist=..
            params.update({k: v[0] for k, v in urllib.parse.parse_qs(body).items()})
    return params


def _sanitize(v, limit: int = 200) -> str:
    """Обрезка длины и схлопывание пробелов — защита от мусора и огромных строк."""
    if v is None:
        return ""
    s = str(v).replace("\x00", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s[:limit]


def _response(status: int, payload):
    """Собирает ответ в формате Netlify Functions + CORS-заголовки."""
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",        # для одностраничника не обязателен, но не мешает
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Cache-Control": "no-store",
    }
    body = "" if payload is None else json.dumps(payload, ensure_ascii=False)
    return {"statusCode": status, "headers": headers, "body": body}


# ─────────────────────────── Точка входа ───────────────────────────

def handler(event, context):
    """
    Entry point Netlify Function.
    GET/POST /api/check?title=...&artist=...  →  вердикт + список совпадений.
    """
    try:
        # CORS preflight — на случай вызова функции с другого домена
        if (event.get("httpMethod") or "").upper() == "OPTIONS":
            return _response(204, None)

        params = _extract_params(event)
        title = _sanitize(params.get("title"))
        artist = _sanitize(params.get("artist"))

        if not title and not artist:
            return _response(400, {
                "ok": False,
                "error": "Укажите хотя бы один параметр: title (название) или artist (исполнитель)",
            })

        # Обе базы опрашиваем параллельно: даже при двух 6-секундных таймаутах
        # укладываемся в стандартные 10 секунд Netlify Functions.
        results = {}
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = {
                pool.submit(search_itunes, title, artist): "itunes",
                pool.submit(search_deezer, title, artist): "deezer",
            }
            for fut in as_completed(futures):
                name = futures[fut]
                try:
                    results[name] = fut.result()
                except Exception as e:   # теоретически не случится (ошибки ловятся внутри)
                    results[name] = {"ok": False, "items": [],
                                     "error": f"{type(e).__name__}: {e}"}

        # Оцениваем всех кандидатов, сортируем: сначала подтверждённые, затем по схожести
        scored = []
        for res in results.values():
            for item in res.get("items", []):
                scored.append(_score_item(title, artist, item))
        scored.sort(key=lambda x: (x["confirmed"], x["score"]), reverse=True)
        scored = _dedupe(scored)

        matches = [s for s in scored if s["confirmed"]][:5]
        possible = [s for s in scored
                    if not s["confirmed"] and s["score"] >= POSSIBLE_MIN][:5]

        payload = {
            "ok": True,
            "found": bool(matches),          # True → 🔴, False → 🟡/⚪ (решает фронтенд)
            "query": {"title": title, "artist": artist},
            "matches": matches,
            "possible": possible,
            "sources": {
                name: {
                    "ok": bool(r.get("ok")),
                    "results": len(r.get("items", [])),
                    "error": r.get("error"),
                } for name, r in results.items()
            },
            "checkedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        return _response(200, payload)

    except Exception as e:
        # Функция никогда не должна «падать молча» — фронтенд покажет понятную ошибку
        return _response(500, {"ok": False, "error": f"{type(e).__name__}: {e}"})
