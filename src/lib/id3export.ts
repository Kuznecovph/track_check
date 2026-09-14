/*
 * ═══════════════════════════════════════════════════════════════════════
 *  FEATURE 2 — ID3 Tag Writer & Export («Fix & Download Track»)
 * ═══════════════════════════════════════════════════════════════════════
 *  ПРИВАТНОСТЬ (обещание сервиса):
 *    Аудиофайл НИКОГДА не покидает браузер пользователя.
 *    • Файл читается в память локально: file.arrayBuffer() (File API).
 *    • Теги внедряются локально библиотекой browser-id3-writer (WASM не нужен).
 *    • Исправленный файл скачивается через Blob/object URL — без сети.
 *    Ни одного сетевого запроса с содержимым файла в этой функции нет.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { ID3Writer } from 'browser-id3-writer';
import type { TrackMeta } from '../types';

export type ProgressFn = (percent: number, label: string) => void;

const nextTick = (): Promise<void> => new Promise(r => setTimeout(r, 0));

function isMp3(file: File): boolean {
  return file.type === 'audio/mpeg' || /\.mp3$/i.test(file.name);
}

/** Байты обложки → ArrayBuffer ровно её размера (требование APIC-фрейма) */
function coverBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : bytes.slice().buffer;
}

/**
 * Читает исходный файл, внедряет ID3v2-теги (TIT2, TPE1, TALB, TYER, TCON, APIC)
 * и автоматически скачивает исправленный MP3. Возвращает имя скачанного файла.
 * Бросает исключение при любом сбое — вызывающий код покажет сообщение
 * «Failed to write tags. Please use an MP3 file.»
 */
export async function exportFixedMp3(
  file: File,
  meta: TrackMeta,
  coverBytes: Uint8Array | null,
  onProgress: ProgressFn,
): Promise<string> {
  if (!isMp3(file)) throw new Error('not-mp3');

  onProgress(15, 'Читаю файл в память браузера...');
  await nextTick(); // даём прогресс-бару отрисоваться
  const buffer = await file.arrayBuffer(); // ЛОКАЛЬНОЕ чтение, без сети

  onProgress(45, 'Записываю ID3v2-теги...');
  await nextTick();
  const writer = new ID3Writer(buffer);
  writer.setFrame('TIT2', meta.title.trim());
  writer.setFrame('TPE1', [meta.artist.trim()]);
  if (meta.album.trim()) writer.setFrame('TALB', meta.album.trim());
  const year = parseInt(meta.year, 10);
  if (Number.isFinite(year) && year >= 1000 && year <= 2999) writer.setFrame('TYER', year);
  if (meta.genre.trim()) writer.setFrame('TCON', [meta.genre.trim()]);
  if (coverBytes && coverBytes.byteLength) {
    writer.setFrame('APIC', {
      type: 3, // ImageType.CoverFront (литерал, т.к. ambient const enum недоступен с isolatedModules)
      data: coverBuffer(coverBytes),
      description: 'Cover',
    });
  }
  const tagged: ArrayBuffer = writer.addTag();

  onProgress(80, 'Готовлю ссылку для скачивания...');
  await nextTick();
  const blob = new Blob([tagged], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);

  const safeArtist = meta.artist.trim().replace(/[\\/:*?"<>|]/g, '_') || 'track';
  const safeTitle = meta.title.trim().replace(/[\\/:*?"<>|]/g, '_') || 'untitled';
  const fileName = `${safeArtist} - ${safeTitle}.mp3`;

  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  onProgress(100, 'Готово');
  return fileName;
}
