/** Generador pseudoaleatorio determinista: mismos datos de demostración en cada reinicio del mismo día. */
export function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export type Rng = () => number;

export function rngFrom(seed: string): Rng {
  let a = hashString(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Valor estable en [0, 1) para una clave. */
export function unit(seed: string): number {
  return hashString(seed) / 4294967296;
}

export function between(r: Rng, min: number, max: number): number {
  return min + r() * (max - min);
}

export function intBetween(r: Rng, min: number, max: number): number {
  return Math.floor(between(r, min, max + 1));
}

export function pickWeighted<T>(r: Rng, items: T[], weight: (item: T) => number): T {
  let total = 0;
  for (const it of items) total += weight(it);
  let x = r() * total;
  for (const it of items) {
    x -= weight(it);
    if (x <= 0) return it;
  }
  return items[items.length - 1];
}
