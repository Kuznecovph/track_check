import type { ToastItem, ToastKind } from '../types';

const KIND_STYLE: Record<ToastKind, string> = {
  success: 'border-emerald-400/40 text-emerald-100',
  error: 'border-bad/50 text-red-100',
  info: 'border-line text-snow',
};

const KIND_ICON: Record<ToastKind, string> = {
  success: '✅',
  error: '⛔',
  info: 'ℹ️',
};

/* Стек тостов внизу экрана */
export default function Toasts({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex w-[min(92vw,30rem)] -translate-x-1/2 flex-col gap-2">
      {toasts.map(t => (
        <div
          key={t.id}
          role="alert"
          className={`pointer-events-auto rounded-xl border bg-panel/95 px-4 py-3 text-sm shadow-2xl backdrop-blur ${KIND_STYLE[t.kind]}`}
        >
          <span className="mr-2">{KIND_ICON[t.kind]}</span>
          {t.text}
        </div>
      ))}
    </div>
  );
}
