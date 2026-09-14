import type { CheckResult, MatchItem } from '../types';

interface Props {
  result: CheckResult;
  title: string;
  artist: string;
  fileName: string;
  onCopy: () => void;
  onReset: () => void;
}

function verdict(result: CheckResult): { cls: string; head: string; text: string } {
  const itOk = result.sources.itunes?.ok;
  const dzOk = result.sources.deezer?.ok;
  if (result.found) {
    return {
      cls: 'border-bad/40 bg-bad/10',
      head: '🔴 Найден в коммерческой базе. Использование без лицензии запрещено.',
      text: 'Трек распространяется на коммерческих площадках (iTunes / Deezer) — значит, права на него принадлежат лейблу или артисту. Для использования в видео нужна лицензия либо письменное разрешение правообладателя.',
    };
  }
  if (itOk || dzOk) {
    return {
      cls: 'border-warn/40 bg-warn/10',
      head: '🟡 Не найден. Запросите разрешение у автора вручную.',
      text: 'Точных совпадений в коммерческих базах нет. Это НЕ гарантирует, что трек свободен: он может не быть в каталогах, но оставаться защищённым авторским правом. Свяжитесь с автором и получите разрешение письменно.',
    };
  }
  return {
    cls: 'border-line bg-white/5',
    head: '⚪ Не удалось проверить — базы недоступны.',
    text: 'Ни iTunes, ни Deezer не ответили (сеть или блокировка). Повторите проверку позже или поищите вручную: itunes.apple.com и deezer.com.',
  };
}

function Badges({ m }: { m: MatchItem }) {
  return (
    <>
      {m.sources.map(s => (
        <span
          key={s}
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
            s === 'iTunes' ? 'bg-bad/15 text-[#ff8a95]' : 'bg-acc2/15 text-[#3ee0db]'
          }`}
        >
          {s}
        </span>
      ))}
    </>
  );
}

function MatchCard({ m }: { m: MatchItem }) {
  const sub = [m.artist, m.album, m.year].filter(Boolean).join(' · ');
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-panel2 px-3.5 py-3">
      <Badges m={m} />
      <div className="min-w-0 flex-1 basis-52">
        <div className="text-sm font-semibold [overflow-wrap:anywhere]">{m.title}</div>
        {sub && <div className="text-xs text-fog [overflow-wrap:anywhere]">{sub}</div>}
      </div>
      <span className="rounded-full border border-acc2/30 px-2.5 py-0.5 text-[11px] text-acc2" title="Схожесть с вашим запросом">
        ~{Math.round(m.score * 100)}%
      </span>
      {m.url && (
        <a className="text-xs text-acc2 hover:underline" href={m.url} target="_blank" rel="noopener">
          Открыть ↗
        </a>
      )}
    </div>
  );
}

function SrcChip({ name, s }: { name: string; s?: { ok: boolean; results: number; error: string | null } }) {
  if (!s) return <span className="rounded-full border border-line px-3 py-1 text-[11px] text-fog">✗ {name}: нет данных</span>;
  if (s.ok)
    return <span className="rounded-full border border-emerald-400/30 px-3 py-1 text-[11px] text-emerald-300">✓ {name}: {s.results} рез.</span>;
  return (
    <span className="rounded-full border border-orange-400/30 px-3 py-1 text-[11px] text-orange-300" title={s.error ?? ''}>
      ✗ {name}: {(s.error ?? 'недоступна').slice(0, 60)}
    </span>
  );
}

/* Карточка вердикта: 🔴 /  / ⚪ + совпадения + статус источников + отчёт */
export default function ResultCard({ result, title, artist, fileName, onCopy, onReset }: Props) {
  const v = verdict(result);
  const note =
    !title && artist
      ? 'Запрос был только по исполнителю — ниже треки из его каталога.'
      : title && !artist
        ? 'Запрос был без исполнителя — убедитесь, что найденный артист совпадает с автором вашего трека.'
        : '';

  return (
    <section className="rounded-2xl border border-line bg-panel p-5">
      <h2 className="mb-3.5 flex items-center gap-2.5 text-base font-semibold">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-acc to-acc2 text-xs font-bold text-white">3</span>
        Вердикт
      </h2>

      <div className={`rounded-xl border p-5 ${v.cls}`}>
        <div className="text-lg font-bold leading-snug">{v.head}</div>
        <p className="mt-2 text-sm leading-relaxed opacity-90">{v.text}</p>
        <div className="mt-3 border-t border-dashed border-white/10 pt-2.5 text-xs text-fog">
          Запрос: {title ? `«${title}»` : '—'}
          {artist ? ` — ${artist}` : ''}
          {fileName ? ` · файл: ${fileName}` : ''}
          {note && <><br />{note}</>}
        </div>
      </div>

      {result.matches.length > 0 && (
        <>
          <h3 className="mb-2.5 mt-5 text-xs font-semibold uppercase tracking-wider text-fog">Совпадения в базах</h3>
          <div className="flex flex-col gap-2">
            {result.matches.map((m, i) => (
              <MatchCard key={i} m={m} />
            ))}
          </div>
        </>
      )}

      {result.possible.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer select-none py-1.5 text-xs text-fog hover:text-snow">
            Похожие результаты ({result.possible.length}) — проверьте вручную
          </summary>
          <div className="mt-2 flex flex-col gap-2 opacity-80">
            {result.possible.map((m, i) => (
              <MatchCard key={i} m={m} />
            ))}
          </div>
        </details>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <SrcChip name="iTunes" s={result.sources.itunes} />
        <SrcChip name="Deezer" s={result.sources.deezer} />
        {result.fallback && (
          <span className="rounded-full border border-orange-400/30 px-3 py-1 text-[11px] text-orange-300" title={result.functionError ?? ''}>
            ⚠ резервный режим из браузера: /api/check — {(result.functionError ?? 'не ответила').slice(0, 46)}
          </span>
        )}
        <span className="rounded-full border border-line px-3 py-1 text-[11px] text-fog">
          проверено: {result.checkedAt ? result.checkedAt.replace('T', ' ').slice(0, 16) + ' UTC' : '—'}
        </span>
      </div>

      <div className="mt-5 flex flex-wrap gap-2.5">
        <button
          type="button"
          onClick={onCopy}
          className="rounded-xl bg-gradient-to-br from-acc to-acc2 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-acc/25 transition hover:brightness-110"
        >
          📋 Скопировать результат
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded-xl border border-line px-5 py-3 text-sm font-semibold text-snow transition hover:border-acc"
        >
          Новая проверка
        </button>
      </div>
    </section>
  );
}
