/*
 * FEATURE 1 (часть клиента): аудио-фингерпринтинг через Web Audio API.
 *
 * Тяжёлая обработка идёт В БРАУЗЕРЕ: файл декодируется локально
 * (AudioContext.decodeAudioData), из него вырезается информативный фрагмент
 * (~30 секунд из середины трека), сводится в моно и ресемплируется до 16 кГц,
 * затем упаковывается в WAV (PCM16). Такой фрагмент весит ~1 МБ вместо 10 МБ
 * целого файла — его дешево передать в нашу serverless-функцию, которая
 * уже сама спросит AudD (ключ не светится в браузере, CORS не мешает).
 *
 * Честность о приватности: для РАСПОЗНАВАНИЯ фрагмент звука неизбежно
 * уходит в сервис распознавания (через нашу функцию). Всё остальное
 * (теги, проверка прав, запись тегов) остаётся локальным.
 */

export const SNIPPET_SECONDS = 30;
const TARGET_RATE = 16000; // моно 16 кГц · PCM16 ≈ 30 с → ~0.96 МБ

interface AudioContextCtor {
  new (): AudioContext;
}

/** Декодирует файл и возвращает байты WAV-фрагмента для распознавания */
export async function buildFingerprintSnippet(file: File): Promise<Uint8Array> {
  const raw = await file.arrayBuffer();

  const Ctor: AudioContextCtor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio API недоступен в этом браузере');

  const ctx = new Ctor();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(raw);
  } catch {
    throw new Error('Не удалось декодировать аудиофайл (повреждён или Unsupported format)');
  } finally {
    void ctx.close().catch(() => undefined);
  }

  // Берём ~30 с из середины: начало часто содержит тишину/интро без «отпечатка»
  const start = decoded.duration > SNIPPET_SECONDS * 1.5 ? Math.floor(decoded.duration * 0.3) : 0;
  const length = Math.min(SNIPPET_SECONDS, Math.max(3, decoded.duration - start));

  // OfflineAudioContext одновременно ресемплирует и сводит в моно
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(length * TARGET_RATE)), TARGET_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0, start, length);
  const rendered = await offline.startRendering();

  return pcmToWav(rendered.getChannelData(0), TARGET_RATE);
}

/** Минимальный WAV-контейнер (PCM16, моно) — распознаватели принимают его лучше всего */
function pcmToWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataLen = samples.length * 2;
  const buf = new Uint8Array(44 + dataLen);
  const view = new DataView(buf.buffer);
  const writeStr = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // размер fmt-чанка
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // каналов: 1
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // бит на сэмпл
  writeStr(36, 'data');
  view.setUint32(40, dataLen, true);

  let o = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    o += 2;
  }
  return buf;
}
