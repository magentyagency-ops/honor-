import type { DayStr, IsoDateTime, LocationId, PosItem, SaleTicket, TicketLine } from '@/domain/types';
import { addDays, atPanama, daysRange, diffDays, panamaDay, panamaHour, weekday } from '@/domain/time';
import { BASE_TICKETS, CLOSE_HOUR, HOUR_SHARE, ITEM_MIX, MIX_TWEAK, OPEN_HOUR, WEEKDAY_FACTOR } from '@/data/catalog';
import { pickWeighted, rngFrom, unit } from '@/lib/rng';

/**
 * Conector de caja.
 *
 * La plataforma solo conoce esta interfaz. En producción habría una implementación por proveedor de
 * caja (API oficial, importación de archivos o, como último recurso, conector de navegador).
 * En la demostración se usa `simulatedPos`, que genera tickets ficticios y no contacta ningún servicio.
 */
export interface PosConnector {
  readonly mode: 'simulado' | 'api' | 'archivo' | 'navegador';
  readonly label: string;
  fetchTickets(req: PosFetchRequest): Promise<SaleTicket[]>;
}

export interface PosFetchRequest {
  locationId: LocationId;
  code: string;
  /** Ventana solicitada. Se pide siempre con solape: la deduplicación es responsabilidad de la plataforma. */
  since: IsoDateTime;
  until: IsoDateTime;
  menu: PosItem[];
  today: DayStr;
}

// ───────────────────────────── Caja simulada ─────────────────────────────
//
// Cada ticket ficticio queda determinado por (local, día, posición en el día): pedir dos veces la
// misma ventana devuelve exactamente los mismos tickets, con los mismos identificadores.
// Eso permite demostrar de verdad que una resincronización no duplica nada.

const EPOCH: DayStr = '2026-01-01';

/** Tickets de un día completo en un local. */
export function dayTicketCount(locationId: LocationId, day: DayStr, today: DayStr): number {
  const daysAgo = Math.max(0, diffDays(day, today));
  const trend = 1 - 0.0009 * daysAgo;
  const noise = 0.94 + 0.12 * unit(`n:${locationId}:${day}`);
  return Math.round(BASE_TICKETS[locationId] * WEEKDAY_FACTOR[locationId][weekday(day)] * trend * noise);
}

/** Fracción de los tickets del día ya emitidos a una hora local dada. */
export function cumShare(hour: number): number {
  if (hour <= OPEN_HOUR) return 0;
  if (hour >= CLOSE_HOUR) return 1;
  let c = 0;
  for (let h = 6; h < CLOSE_HOUR; h++) {
    const start = h === 6 ? OPEN_HOUR : h;
    const end = h + 1;
    if (hour >= end) c += HOUR_SHARE[h];
    else {
      if (hour > start) c += (HOUR_SHARE[h] * (hour - start)) / (end - start);
      break;
    }
  }
  return c;
}

function hourAtShare(share: number): number {
  let c = 0;
  for (let h = 6; h < CLOSE_HOUR; h++) {
    const start = h === 6 ? OPEN_HOUR : h;
    const end = h + 1;
    const s = HOUR_SHARE[h];
    if (share <= c + s) return start + ((share - c) / s) * (end - start);
    c += s;
  }
  return CLOSE_HOUR - 0.01;
}

export function ticketId(code: string, day: DayStr, index: number): string {
  return `${code}-${diffDays(EPOCH, day) * 400 + index + 1}`;
}

function itemWeights(locationId: LocationId, menu: PosItem[], day: DayStr): { item: PosItem; w: number }[] {
  return menu
    .filter((it) => !it.since || it.since <= day)
    .map((item) => ({ item, w: (ITEM_MIX[item.id] ?? 0.05) * (MIX_TWEAK[locationId][item.id] ?? 1) }))
    .filter((x) => x.w > 0);
}

/** Tickets de un día cuya hora cae en (fromHour, toHour]. */
export function ticketsOfDay(
  locationId: LocationId,
  code: string,
  day: DayStr,
  today: DayStr,
  menu: PosItem[],
  fromHour = 0,
  toHour = 24,
): SaleTicket[] {
  const total = dayTicketCount(locationId, day, today);
  const weights = itemWeights(locationId, menu, day);
  const out: SaleTicket[] = [];
  for (let i = 0; i < total; i++) {
    const r = rngFrom(`t:${locationId}:${day}:${i}`);
    const hour = hourAtShare((i + r()) / total);
    if (hour <= fromHour || hour > toHour) continue;
    const nLines = (() => {
      const x = r();
      return x < 0.52 ? 1 : x < 0.88 ? 2 : 3;
    })();
    const lines: TicketLine[] = [];
    for (let k = 0; k < nLines; k++) {
      const { item } = pickWeighted(r, weights, (x) => x.w);
      const existing = lines.find((l) => l.itemId === item.id);
      const q = r() < 0.9 ? 1 : 2;
      if (existing) existing.qty += q;
      else lines.push({ itemId: item.id, qty: q, unitPriceCents: item.priceCents });
    }
    const h = Math.floor(hour);
    const m = Math.floor((hour - h) * 60);
    const s = Math.floor(((hour - h) * 60 - m) * 60);
    out.push({
      id: ticketId(code, day, i),
      locationId,
      at: atPanama(day, h, m, s),
      lines,
      totalCents: lines.reduce((t, l) => t + l.qty * l.unitPriceCents, 0),
    });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : 1));
}

/** Tickets emitidos en la ventana (since, until]. */
export function generateTickets(req: PosFetchRequest): SaleTicket[] {
  if (req.until <= req.since) return [];
  const dFrom = panamaDay(req.since);
  const dTo = panamaDay(req.until);
  const out: SaleTicket[] = [];
  for (const day of daysRange(dFrom, dTo)) {
    const a = day === dFrom ? panamaHour(req.since) : 0;
    const b = day === dTo ? panamaHour(req.until) : 24;
    if (cumShare(b) <= cumShare(a)) continue;
    out.push(...ticketsOfDay(req.locationId, req.code, day, req.today, req.menu, a, b));
  }
  return out;
}

/**
 * Retrocede `minutes` minutos de horario de atención desde `now`.
 * Sirve para situar «la última sincronización» de una caja con ventas pendientes, sea cual sea la hora
 * a la que se abra la demostración.
 */
export function businessMinutesBack(now: IsoDateTime, minutes: number): IsoDateTime {
  let remaining = minutes;
  let day = panamaDay(now);
  let hour = Math.min(panamaHour(now), CLOSE_HOUR);
  for (let guard = 0; guard < 5; guard++) {
    const available = Math.max(0, hour - OPEN_HOUR) * 60;
    if (available >= remaining) {
      const target = hour - remaining / 60;
      const h = Math.floor(target);
      return atPanama(day, h, Math.floor((target - h) * 60));
    }
    remaining -= available;
    day = addDays(day, -1);
    hour = CLOSE_HOUR;
  }
  return atPanama(day, OPEN_HOUR);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const simulatedPos: PosConnector = {
  mode: 'simulado',
  label: 'Caja simulada (modo demostración)',
  async fetchTickets(req) {
    await wait(900);
    return generateTickets(req);
  },
};
