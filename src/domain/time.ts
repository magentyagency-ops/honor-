import type { DayStr, IsoDateTime } from './types';

/**
 * Panamá no aplica horario de verano: UTC−5 todo el año.
 * Todos los instantes se guardan en UTC y se muestran en hora de Panamá, sea cual sea
 * la zona horaria del equipo que abre la demostración.
 */
export const PANAMA_TZ = 'America/Panama';
const OFFSET_MS = -5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, '0');

function shifted(iso: IsoDateTime | Date): Date {
  const t = typeof iso === 'string' ? Date.parse(iso) : iso.getTime();
  return new Date(t + OFFSET_MS);
}

/** Día de calendario en Panamá para un instante dado. */
export function panamaDay(iso: IsoDateTime | Date): DayStr {
  const d = shifted(iso);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function panamaHour(iso: IsoDateTime | Date): number {
  const d = shifted(iso);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

/** Instante UTC correspondiente a una hora local de Panamá. */
export function atPanama(day: DayStr, hour = 0, minute = 0, second = 0): IsoDateTime {
  const [y, m, d] = day.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d, hour, minute, second) - OFFSET_MS;
  return new Date(utc).toISOString();
}

export function addDays(day: DayStr, n: number): DayStr {
  const [y, m, d] = day.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + n * DAY_MS;
  const x = new Date(t);
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
}

/** b − a en días de calendario. */
export function diffDays(a: DayStr, b: DayStr): number {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / DAY_MS);
}

/** 0 = domingo … 6 = sábado */
export function weekday(day: DayStr): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addMinutes(iso: IsoDateTime, minutes: number): IsoDateTime {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

export function minutesBetween(a: IsoDateTime, b: IsoDateTime): number {
  return (Date.parse(b) - Date.parse(a)) / 60_000;
}

export function daysRange(from: DayStr, to: DayStr): DayStr[] {
  const out: DayStr[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// ───────────────────────────── Formato (español, Panamá) ─────────────────────────────

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function toDay(value: DayStr | IsoDateTime): DayStr {
  return value.length <= 10 ? value : panamaDay(value);
}

/** 11/11/2026 */
export function fmtDate(value: DayStr | IsoDateTime | undefined): string {
  if (!value) return '—';
  const [y, m, d] = toDay(value).split('-');
  return `${d}/${m}/${y}`;
}

/** 11 nov */
export function fmtDayShort(value: DayStr | IsoDateTime): string {
  const [, m, d] = toDay(value).split('-').map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

/** mié 11 nov */
export function fmtDayWeek(value: DayStr | IsoDateTime): string {
  const day = toDay(value);
  return `${WEEKDAYS_SHORT[weekday(day)]} ${fmtDayShort(day)}`;
}

/** miércoles, 11 de noviembre de 2026 */
export function fmtDayLong(value: DayStr | IsoDateTime): string {
  const day = toDay(value);
  const [y, m, d] = day.split('-').map(Number);
  return `${WEEKDAYS[weekday(day)]}, ${d} de ${MONTHS[m - 1]} de ${y}`;
}

export function monthName(day: DayStr): string {
  const [, m] = day.split('-').map(Number);
  return MONTHS[m - 1];
}

/** 2:35 p. m. */
export function fmtTime(iso: IsoDateTime): string {
  const d = shifted(iso);
  const h24 = d.getUTCHours();
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${pad(d.getUTCMinutes())} ${h24 < 12 ? 'a. m.' : 'p. m.'}`;
}

/** 11/11/2026 · 2:35 p. m. */
export function fmtDateTime(iso: IsoDateTime | undefined): string {
  if (!iso) return '—';
  return `${fmtDate(iso)} · ${fmtTime(iso)}`;
}

/** hoy 2:35 p. m. · ayer 8:00 p. m. · 09/11/2026 */
export function fmtWhen(iso: IsoDateTime, now: IsoDateTime): string {
  const delta = diffDays(panamaDay(iso), panamaDay(now));
  if (delta === 0) return `hoy, ${fmtTime(iso)}`;
  if (delta === 1) return `ayer, ${fmtTime(iso)}`;
  if (delta === -1) return `mañana, ${fmtTime(iso)}`;
  return `${fmtDayShort(iso)}, ${fmtTime(iso)}`;
}

/** hace 4 min · hace 3 h 12 min · hace 2 días */
export function fmtAgo(iso: IsoDateTime, now: IsoDateTime): string {
  const mins = Math.max(0, Math.round(minutesBetween(iso, now)));
  if (mins < 1) return 'ahora mismo';
  if (mins < 60) return `hace ${mins} min`;
  if (mins < 24 * 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `hace ${h} h` : `hace ${h} h ${m} min`;
  }
  const days = Math.floor(mins / (24 * 60));
  return days === 1 ? 'hace 1 día' : `hace ${days} días`;
}

/** Vence hoy · Vence en 3 días · Vencida hace 4 días */
export function fmtDue(due: DayStr, today: DayStr): string {
  const d = diffDays(today, due);
  if (d === 0) return 'Vence hoy';
  if (d === 1) return 'Vence mañana';
  if (d > 1) return `Vence en ${d} días`;
  if (d === -1) return 'Vencida desde ayer';
  return `Vencida hace ${-d} días`;
}

export function greeting(now: IsoDateTime): string {
  const h = panamaHour(now);
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

export const DAY_MILLIS = DAY_MS;
