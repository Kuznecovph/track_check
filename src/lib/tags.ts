/*
 * Чтение тегов из аудиофайла ЛОКАЛЬНО (в браузере) через jsmediatags.
 * Файл никуда не загружается: jsmediatags работает с File-объектом через File API.
 * Три уровня надёжности:
 *   1) теги есть (ID3v1/ID3v2, MP4-атомы) — берём их, включая встроенную обложку;
 *   2) тегов нет / формат не поддерживается (FLAC, WAV, OGG) — разбор имени файла;
 *   3) чтение зависло — таймаут 15 секунд и тоже разбор имени файла.
 */
import jsmediatags from 'jsmediatags';
import { cleanStr, fromFileName } from './utils';
import type { ReadTagsResult } from '../types';

export const TAGS_TIMEOUT_MS = 15000;

export function readTags(file: File): Promise<ReadTagsResult> {
  return new Promise<ReadTagsResult>(resolve => {
    let settled = false;
    const timer = setTimeout(() => finish(fromFile()), TAGS_TIMEOUT_MS);

    function finish(r: ReadTagsResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    }

    function fromFile(): ReadTagsResult {
      const { title, artist } = fromFileName(file.name);
      return { meta: { title, artist }, coverBytes: null, coverMime: '', via: 'filename' };
    }

    try {
      jsmediatags.read(file, {
        onSuccess: ({ tags }) => {
          const meta = {
            title: cleanStr(tags.title),
            artist: cleanStr(tags.artist),
            album: cleanStr(tags.album),
            year: cleanStr(tags.year),
            genre: cleanStr(tags.genre),
          };
          if (meta.title || meta.artist || meta.album) {
            let coverBytes: Uint8Array | null = null;
            let coverMime = '';
            if (tags.picture && tags.picture.data) {
              coverBytes = new Uint8Array(tags.picture.data as number[]);
              coverMime = tags.picture.format || 'image/jpeg';
            }
            finish({ meta, coverBytes, coverMime, via: 'tags' });
          } else {
            finish(fromFile());
          }
        },
        onError: () => finish(fromFile()),
      });
    } catch {
      finish(fromFile());
    }
  });
}
