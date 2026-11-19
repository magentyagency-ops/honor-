import type { BaseUnit, Cents, Pack, Product } from './types';

// ───────────────────────────── Dinero (USD) ─────────────────────────────

const usd = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** $1,234.56 */
export function money(cents: Cents): string {
  const sign = cents < 0 ? '−' : '';
  return `${sign}$${usd.format(Math.abs(cents) / 100)}`;
}

/** $1,235 (sin decimales, para cifras de resumen) */
export function money0(cents: Cents): string {
  const sign = cents < 0 ? '−' : '';
  return `${sign}$${usd0.format(Math.abs(cents) / 100)}`;
}

/** $12.4K — solo para ejes de gráficos */
export function moneyCompact(cents: Cents): string {
  const v = cents / 100;
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1)}K`;
  return `$${usd0.format(v)}`;
}

export function parseMoney(text: string): Cents | null {
  const clean = text.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  if (!clean || clean === '-' || clean === '.') return null;
  const n = Number(clean);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function percent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)} %`;
}

export function signedPercent(ratio: number, digits = 1): string {
  const v = (ratio * 100).toFixed(digits);
  return `${ratio > 0 ? '+' : ratio < 0 ? '−' : ''}${v.replace('-', '')} %`;
}

// ───────────────────────────── Unidades ─────────────────────────────
//
// El inventario se lleva siempre en una unidad de referencia por producto (g, ml o un).
// Las presentaciones de compra (caja, saco, cartón…) se convierten al recibir.
// Para leer mejor las cifras se muestran en kg y L, pero nunca se mezclan unidades al calcular.

const num = (digits: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });
const n0 = num(0);
const n1 = num(1);
const n2 = num(2);

export type DisplayUnit = 'kg' | 'L' | 'un';

export function displayUnit(base: BaseUnit): DisplayUnit {
  return base === 'g' ? 'kg' : base === 'ml' ? 'L' : 'un';
}

export function displayFactor(base: BaseUnit): number {
  return base === 'un' ? 1 : 1000;
}

/** Cantidad en unidad de referencia → cifra en unidad de lectura (sin la unidad). */
export function toDisplay(qtyBase: number, base: BaseUnit): number {
  return qtyBase / displayFactor(base);
}

export function fromDisplay(value: number, base: BaseUnit): number {
  return value * displayFactor(base);
}

/** 9 L · 14.2 kg · 320 un */
export function qty(qtyBase: number, base: BaseUnit, opts: { sign?: boolean } = {}): string {
  const v = toDisplay(qtyBase, base);
  const abs = Math.abs(v);
  const f = base === 'un' ? (Number.isInteger(abs) ? n0 : n1) : abs >= 100 ? n0 : abs >= 10 ? n1 : n2;
  const sign = v < 0 ? '−' : opts.sign && v > 0 ? '+' : '';
  return `${sign}${f.format(abs)} ${displayUnit(base)}`;
}

/** Cantidades pequeñas de receta, en la unidad de referencia: 18 g · 150 ml · 1 un */
export function qtyBase(q: number, base: BaseUnit): string {
  return `${(Number.isInteger(q) ? n0 : n2).format(q)} ${base}`;
}

/** 5 cajas · 1 saco */
export function packs(n: number, pack: Pack): string {
  return `${n1.format(n)} ${n === 1 ? pack.noun : pack.nounPlural}`;
}

/** 5 cajas = 60 L */
export function packsWithBase(n: number, product: Product): string {
  return `${packs(n, product.offer.pack)} = ${qty(n * product.offer.pack.baseQty, product.baseUnit)}`;
}

/** $1.45 / L */
export function unitCost(product: Product): string {
  const perDisplay = (product.offer.priceCents / product.offer.pack.baseQty) * displayFactor(product.baseUnit);
  const digits = perDisplay < 100 ? 3 : 2;
  return `$${(perDisplay / 100).toFixed(perDisplay < 10 ? digits : 2)} / ${displayUnit(product.baseUnit)}`;
}

/** Costo por unidad de referencia, en centavos (fraccionario). */
export function costPerBase(product: Product): number {
  return product.offer.priceCents / product.offer.pack.baseQty;
}

export function days(n: number): string {
  if (n >= 10) return `${n0.format(n)} días`;
  return `${n1.format(n)} ${n === 1 ? 'día' : 'días'}`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n0.format(n)} ${n === 1 ? one : many}`;
}

export const fmtInt = (n: number) => n0.format(n);
export const fmtNum1 = (n: number) => n1.format(n);

export function round(n: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
