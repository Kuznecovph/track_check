/* Кольцо-спиннер (размер задаётся классами) */
export default function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block animate-spin rounded-full border-2 border-white/15 border-t-acc border-r-acc2 align-middle ${className}`}
    />
  );
}
