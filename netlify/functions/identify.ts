/**
 * ═══════════════════════════════════════════════════════════════════════
 *  Netlify Function: POST /api/identify   →   распознавание трека по звуку
 * ═══════════════════════════════════════════════════════════════════════
 *  Формат handler v1 (event, context) — сознательно, чтобы функцию можно
 *  было задеплоить ДВУМЯ способами:
 *    • Git/CLI-деплой: Netlify сам соберёт этот TS через esbuild;
 *    • Netlify Drop: предварительно собранный esbuild-бандл лежит в
 *      .netlify/functions/identify.zip (prebuilt-функции).
 *
 *  Зачем функция, а не прямой вызов из браузера:
 *    • токен AudD живёт в env Netlify (AUDD_API_TOKEN) и НЕ светится в бандле;
 *    • AudD не отдаёт CORS-заголовки — из браузера запрос невозможен;
 *    • функция лишь проксирует multipart-запрос → бесплатно на тарифе Free.
 *
 *  Вход:  POST, тело — сырые байты WAV-фрагмента (~30 c, моно 16 кГц, ~1 МБ),
 *         в event.body приходят как base64 (isBase64Encoded: true).
 *  Выход: { found, title, artist, album, year, artwork } | { found: false, error? }.
 * ═══════════════════════════════════════════════════════════════════════
 */

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface FnEvent {
  httpMethod?: string;
  body?: string | null;
  isBase64Encoded?: boolean;
}

interface FnResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function json(data: unknown, status = 200): FnResult {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
    body: JSON.stringify(data),
  };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Apple Music отдаёт шаблон artwork с {w}x{h} — подставляем конкретный размер */
function pickArtwork(r: Record<string, any> | null): string | null {
  const tpl = r?.apple_music?.artwork?.url;
  if (typeof tpl === 'string' && tpl) return tpl.replace('{w}x{h}', '500x500');
  if (typeof r?.artwork === 'string' && r.artwork) return r.artwork;
  return null;
}

export const handler = async (event: FnEvent): Promise<FnResult> => {
  try {
    if ((event.httpMethod ?? '').toUpperCase() === 'OPTIONS') {
      return { statusCode: 204, headers: CORS, body: '' };
    }
    if ((event.httpMethod ?? '').toUpperCase() !== 'POST') {
      return json({ error: 'Ожидается POST с байтами аудиофрагмента' }, 405);
    }

    const token = process.env.AUDD_API_TOKEN;
    if (!token) {
      return json(
        {
          found: false,
          error:
            'Сервис распознавания не настроен: добавьте переменную окружения AUDD_API_TOKEN ' +
            'в настройках сайта Netlify (бесплатный токен: https://audd.io) и сделайте redeploy.',
        },
        503,
      );
    }

    // Байты фрагмента приходят base64 — декодируем
    const raw = event.body ?? '';
    const bytes: Uint8Array = event.isBase64Encoded
      ? Buffer.from(raw, 'base64')
      : new TextEncoder().encode(raw);
    if (!bytes || bytes.byteLength < 1024) {
      return json({ error: 'Пустой или слишком маленький аудиофрагмент' }, 400);
    }
    if (bytes.byteLength > 5_000_000) {
      return json({ error: 'Фрагмент больше 5 МБ — уменьшите окно в клиенте' }, 413);
    }

    // multipart/form-data для AudD: api_token + file (+ apple_music для обложки)
    const form = new FormData();
    form.append('api_token', token);
    form.append('return', 'apple_music');
    form.append('file', new Blob([bytes as BlobPart], { type: 'audio/wav' }), 'snippet.wav');

    let data: any;
    try {
      const up = await fetch('https://api.audd.io/', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(20000),
      });
      data = await up.json();
    } catch (e) {
      return json({ found: false, error: 'AudD недоступен: ' + msg(e) }, 502);
    }

    if (data?.status !== 'success') {
      return json({ found: false, error: data?.error?.error_message ?? 'AudD вернул ошибку' }, 502);
    }
    const r = data.result;
    if (!r) return json({ found: false }); // база не узнала → клиент покажет "Track not found in database"

    return json({
      found: true,
      title: String(r.title ?? ''),
      artist: String(r.artist ?? ''),
      album: String(r.album ?? ''),
      year: String(r.release_date ?? '').slice(0, 4),
      artwork: pickArtwork(r),
    });
  } catch (e) {
    return json({ found: false, error: 'Внутренняя ошибка функции: ' + msg(e) }, 500);
  }
};
