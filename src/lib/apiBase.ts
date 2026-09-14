/*
 * Базовый URL серверных функций.
 *
 * • Деплой на Netlify: переменная VITE_API_BASE не задана → функции
 *   вызываются с того же домена: /api/check, /api/identify.
 * • GitHub Pages (чистая статика, функций там нет): можно при сборке
 *   указать работающий Netlify-деплой как бэкенд:
 *       VITE_API_BASE=https://<ваш-сайт>.netlify.app
 *   Обе функции отдают Access-Control-Allow-Origin: *, поэтому
 *   кросс-доменные вызовы разрешены (preflight для POST обработан).
 * • Если бэкенда нет вовсе: /api/check прозрачно падает в JSONP-резерв
 *   (iTunes + Deezer прямо из браузера), а распознавание по звуку
 *   покажет понятную подсказку.
 */
export const API_BASE = String(import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');
export const API_CHECK_URL = `${API_BASE}/api/check`;
export const API_IDENTIFY_URL = `${API_BASE}/api/identify`;
