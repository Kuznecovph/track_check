/*
 * FEATURE 1 (транспорт): отправляет WAV-фрагмент в нашу Netlify Function
 * POST /api/identify. Функция хранит токен AudD в переменных окружения
 * (в браузере он был бы виден каждому) и сама ходит в AudD, обходя CORS.
 */
import type { IdentifyResult } from '../types';
import { API_BASE, API_IDENTIFY_URL } from './apiBase';

const IDENTIFY_TIMEOUT_MS = 30000;

export async function identifyByAudio(snippet: Uint8Array): Promise<IdentifyResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IDENTIFY_TIMEOUT_MS);
  try {
    const res = await fetch(API_IDENTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: snippet,
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => null)) as (IdentifyResult & { error?: string }) | null;
    if (!res.ok) {
      const hint =
        res.status === 404 && !API_BASE
          ? ' Серверные функции не найдены: на GitHub Pages соберите сайт с VITE_API_BASE=<URL вашего Netlify-деплоя>.'
          : '';
      throw new Error((data?.error ?? `Сервис распознавания: HTTP ${res.status}`) + hint);
    }
    if (!data || typeof data.found !== 'boolean') {
      throw new Error('Неожиданный формат ответа /api/identify');
    }
    return data;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error('Распознавание заняло слишком долго — повторите попытку');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
