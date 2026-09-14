import { useId } from 'react';
import Spinner from './Spinner';
import type { CoverState, TrackMeta } from '../types';

interface Props {
  meta: TrackMeta;
  onMeta: (patch: Partial<TrackMeta>) => void;
  cover: CoverState;
  onCoverFile: (f: File) => void;
  onCoverClear: () => void;
  note: string;
  hasFile: boolean;
  canExport: boolean;
  checking: boolean;
  identifying: boolean;
  exporting: boolean;
  exportPct: number;
  exportLabel: string;
  onCheck: () => void;
  onIdentify: () => void;
  onExport: () => void;
}

const FIELD_CLS =
  'w-full rounded-xl border border-line bg-panel2 px-3.5 py-3 text-sm text-snow outline-none transition ' +
  'placeholder:text-fog/50 focus:border-acc focus:ring-2 focus:ring-acc/25';

function Field({
  label,
  value,
  placeholder,
  onChange,
  maxLength = 200,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block text-xs text-fog">{label}</span>
      <input
        id={id}
        type="text"
        className={FIELD_CLS}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={e => onChange(e.target.value)}
      />
    </label>
  );
}

/* Форма метаданных + обложка + три действия: проверить / распознать / экспортировать */
export default function MetaForm(p: Props) {
  return (
    <div>
      {p.note && <p className="mb-3 text-xs leading-relaxed text-fog">{p.note}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Название трека *" value={p.meta.title} placeholder="Например: Blinding Lights" onChange={v => p.onMeta({ title: v })} />
        <Field label="Исполнитель *" value={p.meta.artist} placeholder="Например: The Weeknd" onChange={v => p.onMeta({ artist: v })} />
        <Field label="Альбом" value={p.meta.album} placeholder="Например: After Hours" onChange={v => p.onMeta({ album: v })} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Год" value={p.meta.year} placeholder="2020" maxLength={4} onChange={v => p.onMeta({ year: v.replace(/\D/g, '') })} />
          <Field label="Жанр" value={p.meta.genre} placeholder="Pop" onChange={v => p.onMeta({ genre: v })} />
        </div>
      </div>

      {/* Обложка: предпросмотр + загрузка вручную (байты остаются в браузере) */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-panel2 text-2xl">
          {p.cover.preview ? (
            <img src={p.cover.preview} alt="Обложка" className="h-full w-full object-cover" />
          ) : (
            <span aria-hidden="true">🖼️</span>
          )}
        </div>
        <div className="text-xs text-fog">
          <div className="mb-1.5 font-semibold text-snow">Обложка</div>
          <label className="cursor-pointer rounded-lg border border-line bg-panel2 px-3 py-1.5 text-xs text-snow transition hover:border-acc2">
            Загрузить изображение
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) p.onCoverFile(f);
                e.target.value = '';
              }}
            />
          </label>
          {(p.cover.bytes || p.cover.remoteUrl) && (
            <button type="button" onClick={p.onCoverClear} className="ml-2 text-fog underline decoration-dotted hover:text-snow">
              убрать
            </button>
          )}
        </div>
      </div>

      {/* Действия */}
      <div className="mt-5 flex flex-wrap gap-2.5">
        <button
          type="button"
          onClick={p.onCheck}
          disabled={p.checking || p.identifying || p.exporting}
          className="rounded-xl bg-gradient-to-br from-acc to-acc2 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-acc/25 transition hover:brightness-110 disabled:cursor-progress disabled:opacity-50"
        >
          {p.checking ? <Spinner className="h-4 w-4" /> : '🔍'} Проверить по базам
        </button>

        <button
          type="button"
          onClick={p.onIdentify}
          disabled={!p.hasFile || p.identifying || p.checking || p.exporting}
          title={p.hasFile ? 'Распознать трек по звуку (Web Audio + AudD)' : 'Сначала загрузите аудиофайл'}
          className="rounded-xl border border-line bg-panel2 px-5 py-3 text-sm font-semibold text-snow transition hover:border-acc2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {p.identifying ? (
            <>
              <Spinner className="h-4 w-4" /> Сканирую звук...
            </>
          ) : (
            '🎧 Identify by Audio'
          )}
        </button>

        <button
          type="button"
          onClick={p.onExport}
          disabled={!p.canExport || p.exporting || p.checking || p.identifying}
          title="Внедрить теги в исходный MP3 и скачать исправленный файл (локально, без сети)"
          className="rounded-xl border border-acc2/40 bg-acc2/10 px-5 py-3 text-sm font-semibold text-acc2 transition hover:bg-acc2/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {p.exporting ? (
            <>
              <Spinner className="h-4 w-4" /> Записываю...
            </>
          ) : (
            '🏷️ Fix & Download Track'
          )}
        </button>
      </div>

      {/* Прогресс перезаписи файла (FEATURE 2) */}
      {p.exporting && (
        <div className="mt-4" role="status" aria-live="polite">
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-acc2 transition-all duration-300" style={{ width: `${p.exportPct}%` }} />
          </div>
          <div className="mt-1.5 text-xs text-fog">
            {p.exportLabel} · {p.exportPct}%
          </div>
        </div>
      )}

      <p className="mt-3 text-[11px] text-fog">
        * достаточно названия или исполнителя для проверки; для экспорта нужны название и исполнитель (обложка — по желанию).
      </p>
    </div>
  );
}
