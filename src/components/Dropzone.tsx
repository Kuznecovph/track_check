import { useEffect, useRef } from 'react';
import { fmtSize } from '../lib/utils';

interface Props {
  onFile: (f: File) => void;
  disabled: boolean;
  fileName: string | null;
  fileSize: number | null;
}

/* Зона drag & drop + кнопка выбора файла (файл остаётся в браузере) */
export default function Dropzone({ onFile, disabled, fileName, fileSize }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);

  // Не даём браузеру открыть файл, брошенный мимо зоны
  useEffect(() => {
    const prevent = (e: DragEvent): void => e.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  useEffect(() => {
    const zone = zoneRef.current;
    if (!zone) return;
    const enter = (e: DragEvent): void => {
      e.preventDefault();
      zone.classList.add('border-acc', 'bg-acc/5');
    };
    const leave = (e: DragEvent): void => {
      e.preventDefault();
      zone.classList.remove('border-acc', 'bg-acc/5');
    };
    const drop = (e: DragEvent): void => {
      e.preventDefault();
      zone.classList.remove('border-acc', 'bg-acc/5');
      const f = e.dataTransfer?.files?.[0];
      if (f && !disabled) onFile(f);
    };
    zone.addEventListener('dragenter', enter);
    zone.addEventListener('dragover', enter);
    zone.addEventListener('dragleave', leave);
    zone.addEventListener('drop', drop);
    return () => {
      zone.removeEventListener('dragenter', enter);
      zone.removeEventListener('dragover', enter);
      zone.removeEventListener('dragleave', leave);
      zone.removeEventListener('drop', drop);
    };
  }, [onFile, disabled]);

  return (
    <div>
      <div
        ref={zoneRef}
        role="button"
        tabIndex={0}
        aria-label="Перетащите аудиофайл сюда или нажмите для выбора"
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={e => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className="cursor-pointer rounded-2xl border-2 border-dashed border-line bg-panel2 px-5 py-9 text-center transition-colors hover:border-acc"
      >
        <svg
          className="mx-auto h-11 w-11 text-acc2"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
        <div className="mt-2.5 text-base font-semibold">Перетащите аудиофайл сюда</div>
        <div className="mt-0.5 text-xs text-fog">— или —</div>
        <span className="mt-3 inline-flex rounded-xl bg-gradient-to-br from-acc to-acc2 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-acc/25">
          Выбрать файл
        </span>
        <div className="mt-3.5 text-[11px] text-fog">
          MP3 · M4A · AAC · WAV · OGG · FLAC — теги читаются локально, файл никуда не отправляется
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.aac,.flac,.wav,.ogg,.opus,.webm"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f && !disabled) onFile(f);
          e.target.value = '';
        }}
      />

      {fileName && (
        <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-panel2 px-3.5 py-1.5 text-xs text-fog">
          🎵 <b className="font-semibold text-snow [overflow-wrap:anywhere]">{fileName}</b>
          {fileSize !== null && <span>· {fmtSize(fileSize)}</span>}
        </div>
      )}
    </div>
  );
}
