/* Текстовый отчёт о проверке — для кнопки «Скопировать результат» */
import { fmtDate } from './utils';
import type { ReportInfo, SourceStatus } from '../types';

function mark(s: SourceStatus | undefined): string {
  if (!s) return 'нет данных';
  return s.ok ? `✓ (${s.results} рез.)` : `✗ (${s.error ?? 'ошибка'})`;
}

export function buildReport(r: ReportInfo): string {
  const d = r.data;
  const L: string[] = [];

  L.push('🎵 ОТЧЁТ О ПРОВЕРКЕ ТРЕКА — TrackCheck');
  L.push(`Дата: ${fmtDate(r.when)}`);
  if (r.fileName) L.push(`Файл: ${r.fileName}`);
  L.push(`Запрос: ${r.title ? `«${r.title}»` : '—'}${r.artist ? ` — ${r.artist}` : ''}`);
  L.push(`Источники: iTunes ${mark(d.sources.itunes)}, Deezer ${mark(d.sources.deezer)}`);
  if (d.fallback) {
    L.push(`Режим: резервный (запрос из браузера через JSONP); функция /api/check: ${d.functionError ?? 'недоступна'}`);
  }
  L.push('');

  if (d.found) {
    L.push('ВЕРДИКТ: 🔴 Найден в коммерческой базе. Использование без лицензии запрещено.');
  } else if (d.sources.itunes?.ok || d.sources.deezer?.ok) {
    L.push('ВЕРДИКТ: 🟡 Не найден. Запросите разрешение у автора вручную.');
  } else {
    L.push('ВЕРДИКТ: ⚪ Не удалось проверить — базы недоступны.');
  }

  if (d.matches.length) {
    L.push('');
    L.push('Совпадения:');
    d.matches.forEach(m => {
      L.push(
        `• [${m.sources.join('+')}] ${m.title} — ${m.artist}` +
          (m.album ? ` (${m.album}${m.year ? ', ' + m.year : ''})` : '') +
          ` — схожесть ${Math.round(m.score * 100)}%` +
          (m.url ? ` — ${m.url}` : ''),
      );
    });
  }

  L.push('');
  L.push('Примечание: результат носит информационный характер. «Не найден» ≠ «свободен от авторских прав».');
  L.push('Для финального решения получите письменное разрешение автора или лицензию музыкальной библиотеки.');
  return L.join('\n');
}
