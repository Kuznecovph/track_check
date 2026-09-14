/* Типы для jsmediatags (пакет поставляется без .d.ts) */
declare module 'jsmediatags' {
  export interface TagPicture {
    data: number[] | Uint8Array;
    format: string;
  }
  export interface MediaTags {
    title?: string;
    artist?: string;
    album?: string;
    year?: string;
    genre?: string;
    picture?: TagPicture;
  }
  export interface ReadCallbacks {
    onSuccess: (result: { tags: MediaTags }) => void;
    onError: (error: { type: string; info: unknown }) => void;
  }
  const jsmediatags: {
    read(file: File | string, callbacks: ReadCallbacks): void;
  };
  export default jsmediatags;
}
