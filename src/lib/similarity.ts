/*
 * Нечёткое сравнение строк (зеркало логики netlify/functions/check.py).
 * Используется в резервном режиме, когда serverless-функция недоступна
 * и проверки идут прямо из браузера через JSONP.
 */

export const NOISE_WORDS = new Set(['remastered', 'remaster', 'explicit', 'mono', 'stereo']);

/** Регистр + диакритика вниз: 'Björk' → 'bjork' */
export function fold(s: string): string {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Нормализация для сравнения: скобки/пунктуация/«шум»/числовые токены — долой */
export function clean(s: string): string {
  let t = fold(s);
  t = t.replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, ' ');
  t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  return t
    .split(/\s+/)
    .filter(w => w && !NOISE_WORDS.has(w) && !/^\d+$/.test(w))
    .join(' ');
}

/** Аппроксимация difflib.ratio через длину LCS (строки короткие — O(n·m) приемлемо) */
function lcsRatio(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return 0;
  let prev = new Array<number>(m + 1).fill(0);
  let cur = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
    cur.fill(0);
  }
  return (2 * prev[m]) / (n + m);
}

/** Схожесть 0..1: максимум из посимвольной, токенов (Жаккар) и вхождения */
export function sim(a: string, b: string): number {
  const na = clean(a);
  const nb = clean(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const A = new Set(na.split(' '));
  const B = new Set(nb.split(' '));
  let inter = 0;
  A.forEach(x => {
    if (B.has(x)) inter++;
  });
  const jac = inter / (A.size + B.size - inter);
  const cont = na.includes(nb) || nb.includes(na) ? 0.9 : 0;
  return Math.max(lcsRatio(na, nb), jac, cont);
}

export interface Dedupable {
  sources: string[];
  title: string;
  artist: string;
  score: number;
  confirmed: boolean;
}

/** Один и тот же трек из iTunes и Deezer → одна карточка с двумя бейджами */
export function dedupeItems<T extends Dedupable>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const it of items) {
    const key = clean(it.title) + '|' + clean(it.artist);
    const cur = map.get(key);
    if (cur) {
      if (!cur.sources.includes(it.sources[0])) cur.sources.push(...it.sources);
      if (it.score > cur.score) Object.assign(cur, { score: it.score, confirmed: it.confirmed });
    } else {
      map.set(key, it);
    }
  }
  return Array.from(map.values());
}
