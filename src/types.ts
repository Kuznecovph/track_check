/* Общие типы приложения TrackCheck v2 */

export interface TrackMeta {
  title: string;
  artist: string;
  album: string;
  year: string;
  genre: string;
}

export interface CoverState {
  /** Байты обложки (из тегов файла или загруженные вручную) — для APIC-фрейма */
  bytes: Uint8Array | null;
  /** MIME-тип байтов обложки (для preview-блоба) */
  mime: string;
  /** Удалённый URL обложки (из AudD), если байтов локально нет */
  remoteUrl: string | null;
  /** URL для предпросмотра (object URL байтов или remoteUrl) */
  preview: string | null;
}

export interface MatchItem {
  sources: string[];
  title: string;
  artist: string;
  album: string;
  year: string;
  url: string;
  score: number;
  confirmed: boolean;
}

export interface SourceStatus {
  ok: boolean;
  results: number;
  error: string | null;
}

export interface CheckResult {
  found: boolean;
  matches: MatchItem[];
  possible: MatchItem[];
  sources: { itunes?: SourceStatus; deezer?: SourceStatus };
  checkedAt: string;
  fallback?: boolean;
  functionError?: string | null;
}

export interface IdentifyResult {
  found: boolean;
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  artwork?: string | null;
  error?: string;
}

export interface ReportInfo {
  data: CheckResult;
  title: string;
  artist: string;
  fileName: string;
  when: Date;
}

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

/** Читаемые теги + обложка из файла */
export interface ReadTagsResult {
  meta: Partial<TrackMeta>;
  coverBytes: Uint8Array | null;
  coverMime: string;
  via: 'tags' | 'filename';
}
