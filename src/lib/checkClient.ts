/*
 * Проверка по базам iTunes + Deezer.
 * Основной путь: Netlify Function /api/check (Python, параллельный опрос баз).
 * Резервный путь (функция недоступна: деплой без функций, локальный запуск,
 * строгий in-app браузер): JSONP-запросы к обеим базам прямо из браузера —
 * <script src="…&callback=fn"> не блокируется ни CORS, ни WebView.
 */
import { dedupeItems, sim } from './similarity';
import { stripUrls } from './utils';
import { API_CHECK_URL } from './apiBase';
import type { CheckResult, MatchItem, SourceStatus } from '../types';

export const FETCH_TIMEOUT_MS = 20000;

export async function apiCheck(rawTitle: string, rawArtist: string): Promise<CheckResult> {
  const title = stripUrls(rawTitle);
  const artist = stripUrls(rawArtist);
  const url = API_CHECK_URL + '?' + new URLSearchParams({ title, artist }).toString();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`функция /api/check вернула HTTP ${res.status}`);
    const data = (await res.json()) as CheckResult;
    if (typeof data.found !== 'boolean') throw new Error('неожиданный формат ответа /api/check');
    return data;
  } catch (err) {
    // Резерв: JSONP из браузера к обеим базам
    const fnErr = err instanceof Error ? err.message : String(err);
    console.warn('[TrackCheck] /api/check недоступна (' + fnErr + '), включаю резервный режим JSONP');
    return browserCheck(title, artist, fnErr);
  } finally {
    clearTimeout(t);
  }
}

/* ─────────────────── JSONP-транспорт ─────────────────── */

let jsonpSeq = 0;

function jsonp<T>(url: string, timeoutMs: number, withOutputParam: boolean): Promise<T> {
  /*
   * JSONP: создаём <script> с адресом API и именем callback-функции.
   * Ответ приходит как вызов window.<имя>( {...} ) — CORS не участвует вовсе.
   * withOutputParam: Deezer требует output=jsonp для обёртки ответа,
   * а iTunes отдаёт 400 на этот параметр (ему хватает callback).
   */
  return new Promise<T>((resolve, reject) => {
    const name = '__tc_jsonp_' + ++jsonpSeq + '_' + Date.now();
    const script = document.createElement('script');
    const win = window as unknown as Record<string, unknown>;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`таймаут ${Math.round(timeoutMs / 1000)} с`));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timer);
      delete win[name];
      script.remove();
    }

    win[name] = (data: T) => {
      cleanup();
      resolve(data);
    };
    script.src =
      url + (url.includes('?') ? '&' : '?') + (withOutputParam ? 'output=jsonp&' : '') + 'callback=' + name;
    script.onerror = () => {
      cleanup();
      reject(new Error('скрипт не загрузился'));
    };
    document.head.appendChild(script);
  });
}

interface ItunesTrack {
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  releaseDate?: string;
  trackViewUrl?: string;
}
interface DeezerTrack {
  title?: string;
  title_short?: string;
  artist?: { name?: string };
  album?: { title?: string };
  link?: string;
}

function shortErr(e: unknown): string {
  return String(e instanceof Error ? e.message : e).slice(0, 80);
}

/* ─────────────────── Резервная проверка из браузера ─────────────────── */

export async function browserCheck(title: string, artist: string, functionError: string): Promise<CheckResult> {
  const term = [title, artist].filter(Boolean).join(' ');
  const itUrl =
    'https://itunes.apple.com/search?' +
    new URLSearchParams({ term, media: 'music', entity: 'song', limit: '15' });
  const dzUrl = 'https://api.deezer.com/search/track?' + new URLSearchParams({ q: term, limit: '15' });

  const [itRes, dzRes] = await Promise.allSettled([
    jsonp<{ results?: ItunesTrack[] }>(itUrl, 9000, false), // iTunes: хватает callback
    jsonp<{ data?: DeezerTrack[] }>(dzUrl, 9000, true), // Deezer: нужен output=jsonp
  ]);

  const itItems: MatchItem[] | null =
    itRes.status === 'fulfilled'
      ? (itRes.value.results ?? []).map(r => ({
          sources: ['iTunes'],
          title: r.trackName ?? '',
          artist: r.artistName ?? '',
          album: r.collectionName ?? '',
          year: (r.releaseDate ?? '').slice(0, 4),
          url: r.trackViewUrl ?? '',
          score: 0,
          confirmed: false,
        }))
      : null;

  const dzItems: MatchItem[] | null =
    dzRes.status === 'fulfilled'
      ? (dzRes.value.data ?? []).map(r => ({
          sources: ['Deezer'],
          title: r.title_short ?? r.title ?? '',
          artist: r.artist?.name ?? '',
          album: r.album?.title ?? '',
          year: '',
          url: r.link ?? '',
          score: 0,
          confirmed: false,
        }))
      : null;

  if (!itItems && !dzItems) {
    throw new Error(
      `функция /api/check: ${functionError}; iTunes(JSONP): ${shortErr(itRes.status === 'rejected' ? itRes.reason : '')}; Deezer(JSONP): ${shortErr(dzRes.status === 'rejected' ? dzRes.reason : '')}`,
    );
  }

  // Клиентский скоринг — те же пороги, что в check.py
  const scored = dedupeItems(
    [...(itItems ?? []), ...(dzItems ?? [])].map(it => {
      const t = title ? sim(title, it.title) : null;
      const a = artist ? sim(artist, it.artist) : null;
      let score: number;
      let confirmed: boolean;
      if (t !== null && a !== null) {
        score = 0.6 * t + 0.4 * a;
        confirmed = t >= 0.8 && a >= 0.65;
      } else if (t !== null) {
        score = t;
        confirmed = t >= 0.85;
      } else {
        score = a ?? 0;
        confirmed = (a ?? 0) >= 0.85;
      }
      return { ...it, score, confirmed };
    }),
  ).sort((x, y) => Number(y.confirmed) - Number(x.confirmed) || y.score - x.score);

  const sources: { itunes?: SourceStatus; deezer?: SourceStatus } = {
    itunes: itItems
      ? { ok: true, results: itItems.length, error: null }
      : { ok: false, results: 0, error: shortErr(itRes.status === 'rejected' ? itRes.reason : '') },
    deezer: dzItems
      ? { ok: true, results: dzItems.length, error: null }
      : { ok: false, results: 0, error: shortErr(dzRes.status === 'rejected' ? dzRes.reason : '') },
  };

  return {
    found: scored.some(s => s.confirmed),
    matches: scored.filter(s => s.confirmed).slice(0, 5),
    possible: scored.filter(s => !s.confirmed && s.score >= 0.5).slice(0, 5),
    sources,
    checkedAt: new Date().toISOString(),
    fallback: true,
    functionError,
  };
}
