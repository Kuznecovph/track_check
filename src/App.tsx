import { useCallback, useRef, useState } from 'react';
import Dropzone from './components/Dropzone';
import MetaForm from './components/MetaForm';
import ResultCard from './components/ResultCard';
import Spinner from './components/Spinner';
import Toasts from './components/Toasts';
import { apiCheck } from './lib/checkClient';
import { buildFingerprintSnippet } from './lib/fingerprint';
import { exportFixedMp3 } from './lib/id3export';
import { identifyByAudio } from './lib/identifyClient';
import { buildReport } from './lib/report';
import { readTags } from './lib/tags';
import { stripUrls } from './lib/utils';
import type { CheckResult, CoverState, ToastItem, ToastKind, TrackMeta } from './types';

const EMPTY_META: TrackMeta = { title: '', artist: '', album: '', year: '', genre: '' };
const EMPTY_COVER: CoverState = { bytes: null, mime: '', remoteUrl: null, preview: null };

interface ReportMeta {
  title: string;
  artist: string;
  fileName: string;
  when: Date;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<TrackMeta>(EMPTY_META);
  const [cover, setCover] = useState<CoverState>(EMPTY_COVER);
  const [note, setNote] = useState('');
  const [statusText, setStatusText] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportPct, setExportPct] = useState(0);
  const [exportLabel, setExportLabel] = useState('');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [reportMeta, setReportMeta] = useState<ReportMeta | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);

  const busy = reading || checking || identifying || exporting;
  const canExport = !!file && !!meta.title.trim() && !!meta.artist.trim();

  /* ─────────────── тосты ─────────────── */
  const toast = useCallback((kind: ToastKind, text: string) => {
    const id = ++toastId.current;
    setToasts(t => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4500);
  }, []);

  /* ─────────────── проверка по базам ─────────────── */
  const runCheck = useCallback(
    async (m: TrackMeta, fileName: string): Promise<boolean> => {
      const title = stripUrls(m.title);
      const artist = stripUrls(m.artist);
      if (!title && !artist) return false;
      setChecking(true);
      setResult(null);
      setStatusText('Проверяю в базах: iTunes, Deezer...');
      try {
        const data = await apiCheck(title, artist);
        setResult(data);
        setReportMeta({ title, artist, fileName, when: new Date() });
        return true;
      } catch (e) {
        toast('error', `Не удалось выполнить проверку: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      } finally {
        setChecking(false);
        setStatusText(null);
      }
    },
    [toast],
  );

  /* ─────────────── шаг 1: файл и теги ─────────────── */
  const handleFile = useCallback(
    async (f: File) => {
      if (busy) {
        toast('info', 'Дождитесь окончания текущей операции');
        return;
      }
      const looksAudio = f.type.startsWith('audio/') || /\.(mp3|m4a|aac|flac|wav|ogg|opus|webm)$/i.test(f.name);
      if (!looksAudio) toast('info', 'Файл не похож на аудио — всё равно пробую прочитать теги');

      setFile(f);
      setResult(null);
      setReportMeta(null);
      setReading(true);
      setStatusText('Читаю теги...');

      const r = await readTags(f);
      setReading(false);
      setStatusText(null);

      const next: TrackMeta = { ...EMPTY_META, ...r.meta };
      setMeta(next);

      // Обложка из тегов файла (если есть) — байты остаются локальными
      setCover(prev => {
        if (prev.preview?.startsWith('blob:')) URL.revokeObjectURL(prev.preview);
        if (r.coverBytes && r.coverBytes.byteLength) {
          const preview = URL.createObjectURL(new Blob([r.coverBytes], { type: r.coverMime || 'image/jpeg' }));
          return { bytes: r.coverBytes, mime: r.coverMime, remoteUrl: null, preview };
        }
        return EMPTY_COVER;
      });

      if (r.via === 'tags') {
        setNote('✓ Теги (ID3) прочитаны из файла. Проверьте значения — их можно поправить.');
      } else if (next.title || next.artist) {
        setNote('⚠ Тегов в файле нет (или формат не поддерживается). Данные разобраны из имени файла — проверьте их.');
      } else {
        setNote('⚠ Тегов нет, имя файла разобрать не удалось. Введите название и исполнителя вручную.');
      }

      if (next.title || next.artist) void runCheck(next, f.name);
    },
    [busy, runCheck, toast],
  );

  /* ─────────────── FEATURE 1: распознать по звуку ─────────────── */
  const handleIdentify = useCallback(async () => {
    if (!file) {
      toast('error', 'Сначала загрузите аудиофайл');
      return;
    }
    if (busy) return;
    setIdentifying(true);
    setStatusText('Сканирую звук: декодирую и беру фрагмент для отпечатка...');
    try {
      const snippet = await buildFingerprintSnippet(file);
      setStatusText('Распознаю трек через AudD...');
      const res = await identifyByAudio(snippet);
      if (!res.found) {
        toast('error', 'Track not found in database');
        return;
      }
      const patch: Partial<TrackMeta> = {};
      if (res.title) patch.title = res.title;
      if (res.artist) patch.artist = res.artist;
      if (res.album) patch.album = res.album;
      if (res.year) patch.year = res.year;
      const next = { ...meta, ...patch };
      setMeta(next);
      if (res.artwork) {
        setCover(c => ({ ...c, remoteUrl: res.artwork ?? null, preview: res.artwork ?? c.preview }));
      }
      toast('success', `Распознано: ${res.title || '—'} — ${res.artist || '—'}`);
      await runCheck(next, file.name); // сразу проверяем права по свежим данным
    } catch (e) {
      toast('error', e instanceof Error ? e.message : String(e));
    } finally {
      setIdentifying(false);
      setStatusText(null);
    }
  }, [file, meta, busy, runCheck, toast]);

  /* ─────────────── FEATURE 2: записать теги и скачать ─────────────── */
  const handleExport = useCallback(async () => {
    if (!file || !canExport) return;
    setExporting(true);
    setExportPct(5);
    setExportLabel('Подготовка...');
    try {
      let coverBytes = cover.bytes;
      if (!coverBytes && cover.remoteUrl) {
        setExportLabel('Скачиваю обложку...');
        try {
          const r = await fetch(cover.remoteUrl);
          if (r.ok) coverBytes = new Uint8Array(await r.arrayBuffer());
          else toast('info', 'Обложку с URL получить не удалось — экспортирую без неё');
        } catch {
          toast('info', 'Обложку с URL получить не удалось — экспортирую без неё');
        }
      }
      const name = await exportFixedMp3(file, meta, coverBytes, (pct, label) => {
        setExportPct(pct);
        setExportLabel(label);
      });
      toast('success', `Файл сохранён: ${name}`);
    } catch (e) {
      console.error('[TrackCheck] export failed:', e);
      toast('error', 'Failed to write tags. Please use an MP3 file.');
    } finally {
      setExporting(false);
      setExportPct(0);
      setExportLabel('');
    }
  }, [file, meta, cover, canExport, toast]);

  /* ─────────────── обложка вручную ─────────────── */
  const handleCoverFile = useCallback(
    async (f: File) => {
      if (!f.type.startsWith('image/')) {
        toast('error', 'Обложка должна быть изображением');
        return;
      }
      const bytes = new Uint8Array(await f.arrayBuffer());
      setCover(prev => {
        if (prev.preview?.startsWith('blob:')) URL.revokeObjectURL(prev.preview);
        return { bytes, mime: f.type || 'image/jpeg', remoteUrl: null, preview: URL.createObjectURL(new Blob([bytes], { type: f.type || 'image/jpeg' })) };
      });
    },
    [toast],
  );

  const handleCoverClear = useCallback(() => {
    setCover(prev => {
      if (prev.preview?.startsWith('blob:')) URL.revokeObjectURL(prev.preview);
      return EMPTY_COVER;
    });
  }, []);

  /* ─────────────── отчёт и сброс ─────────────── */
  const handleCopy = useCallback(async () => {
    if (!result || !reportMeta) return;
    const text = buildReport({ data: result, ...reportMeta });
    const ok = 'Отчёт скопирован — можно отправлять клиенту';
    try {
      await navigator.clipboard.writeText(text);
      toast('success', ok);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        toast('success', ok);
      } catch {
        toast('error', 'Не удалось скопировать отчёт');
      }
      ta.remove();
    }
  }, [result, reportMeta, toast]);

  const handleReset = useCallback(() => {
    setCover(prev => {
      if (prev.preview?.startsWith('blob:')) URL.revokeObjectURL(prev.preview);
      return EMPTY_COVER;
    });
    setFile(null);
    setMeta(EMPTY_META);
    setNote('');
    setResult(null);
    setReportMeta(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  /* ─────────────── разметка ─────────────── */
  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-8">
      <header className="mb-7 text-center">
        <h1 className="bg-gradient-to-br from-[#a29bfe] to-[#81ecec] bg-clip-text text-3xl font-extrabold tracking-wide text-transparent">
          🎧 TrackCheck
        </h1>
        <p className="mx-auto mt-2 max-w-lg text-sm text-fog">
          Проверка треков перед использованием в видео, распознавание по звуку и исправление тегов.
          Бесплатные базы iTunes и Deezer, без ключей и платных API.
        </p>
        <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-acc2/30 bg-acc2/5 px-3 py-1 text-xs text-acc2">
          🔒 Теги и файлы обрабатываются в вашем браузере
        </span>
      </header>

      <section className="mb-4 rounded-2xl border border-line bg-panel p-5">
        <h2 className="mb-3.5 flex items-center gap-2.5 text-base font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-acc to-acc2 text-xs font-bold text-white">1</span>
          Загрузите трек <span className="text-xs font-normal text-fog">(или введите данные вручную ниже)</span>
        </h2>
        <Dropzone onFile={f => void handleFile(f)} disabled={busy} fileName={file?.name ?? null} fileSize={file?.size ?? null} />
      </section>

      <section className="mb-4 rounded-2xl border border-line bg-panel p-5">
        <h2 className="mb-3.5 flex items-center gap-2.5 text-base font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-acc to-acc2 text-xs font-bold text-white">2</span>
          Данные трека
        </h2>
        <MetaForm
          meta={meta}
          onMeta={patch => setMeta(m => ({ ...m, ...patch }))}
          cover={cover}
          onCoverFile={f => void handleCoverFile(f)}
          onCoverClear={handleCoverClear}
          note={note}
          hasFile={!!file}
          canExport={canExport}
          checking={checking}
          identifying={identifying}
          exporting={exporting}
          exportPct={exportPct}
          exportLabel={exportLabel}
          onCheck={() => void runCheck(meta, file?.name ?? '')}
          onIdentify={() => void handleIdentify()}
          onExport={() => void handleExport()}
        />
      </section>

      {statusText && (
        <div className="flex flex-col items-center gap-3.5 py-7 text-center" role="status" aria-live="polite">
          <Spinner className="h-10 w-10" />
          <div className="text-sm text-fog">{statusText}</div>
        </div>
      )}

      {result && reportMeta && (
        <ResultCard
          result={result}
          title={reportMeta.title}
          artist={reportMeta.artist}
          fileName={reportMeta.fileName}
          onCopy={() => void handleCopy()}
          onReset={handleReset}
        />
      )}

      <footer className="mt-8 border-t border-line pt-4 text-center text-[11px] leading-relaxed text-fog">
        ⚠️ Сервис носит информационный характер и не является юридической консультацией.
        «Не найден» ≠ «свободен от авторских прав»: трек может не индексироваться в iTunes/Deezer, но оставаться
        защищённым. Перед публикацией видео получайте письменное разрешение правообладателя или лицензию
        музыкальной библиотеки.
      </footer>

      <Toasts toasts={toasts} />
    </div>
  );
}
