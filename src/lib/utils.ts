/* Строковые утилиты: чистка ввода, разбор имён файлов, форматирование */

export function cleanStr(v: unknown): string {
  return String(v ?? '')
    .replace(/\0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ссылки в тексте запроса только мешают поиску — вырезаем их */
export function stripUrls(s: string): string {
  return s.replace(/https?:\/\/\S+/gi, ' ').replace(/\s{2,}/g, ' ').trim();
}

export function fmtSize(bytes: number): string {
  if (!bytes && bytes !== 0) return '';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' МБ';
  return Math.max(1, Math.round(bytes / 1024)) + ' КБ';
}

export function fmtDate(d: Date): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

/**
 * Разбор имени файла вида
 *   «DJ Gringo — 01 Flowers (Remake) - MERENGUE (www.lightaudio.ru)_061634.mp3»
 * Чистим мусор ДО поиска, иначе каталожные номера и домены портят запрос:
 *   1) расширение и подчёркивания → пробелы;
 *   2) содержимое скобок (версии, сайты) — долой;
 *   3) URL и домены без схемы;
 *   4) хвостовые и длинные числовые ID (060911-7, 55529319), но НЕ годы (1999);
 *   5) ведущий номер трека («01. », «01) »);
 *   6) делим по первому тире на «Артист - Название»;
 *   7) у названия отрезаем всё после второго тире (там обычно альбом/жанр).
 */
export function fromFileName(name: string): { title: string; artist: string } {
  let base = String(name || '').replace(/\.[^.]+$/, '');
  base = base.replace(/_/g, ' ');
  base = base.replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, ' ');
  base = base.replace(/https?:\/\/\S+/gi, ' ');
  base = base.replace(/\b(?:www\.)?[a-z0-9-]+\.(?:ru|com|net|org|io)\b/gi, ' ');
  base = base.replace(/[\s\-–—]+\d{5,}[\d\-.]*$/g, ' ');
  base = base.replace(/\b\d{5,}\b/g, ' ');
  base = base.replace(/^\s*\d{1,3}\s*[.\-)_]?\s+/, '');
  base = cleanStr(base);

  const m = base.match(/^(.{2,}?)\s+[-–—]\s+(.{2,})$/);
  if (m) {
    const artist = cleanStr(m[1]);
    let title = cleanStr(m[2]).split(/\s+[-–—]\s+/)[0];
    title = cleanStr(title).replace(/^\d{1,3}\s*[.\-)_]?\s+/, '');
    return { title: cleanStr(title), artist };
  }
  return { title: base, artist: '' };
}
