import type { IsoDateTime, LocationId, PosItem, SaleTicket, TicketLine } from '@/domain/types';
import { addMinutes, panamaDay } from '@/domain/time';

/**
 * Importación de ventas desde un archivo exportado de la caja.
 * Es la segunda opción de integración: se usa cuando la caja no ofrece API.
 *
 * Formato esperado (CSV con encabezado):
 *   ticket_id,fecha_hora,articulo,cantidad,precio_unitario
 *   CV-F0001,2026-11-11T14:35:00-05:00,CAP,2,3.75
 *
 * Varias filas con el mismo ticket_id forman un solo ticket. La deduplicación la hace la plataforma:
 * importar dos veces el mismo archivo no duplica nada.
 */
export const CSV_HEADER = 'ticket_id,fecha_hora,articulo,cantidad,precio_unitario';

function panamaIso(iso: IsoDateTime): string {
  const d = new Date(Date.parse(iso) - 5 * 3600_000);
  return d.toISOString().slice(0, 19) + '-05:00';
}

/** Archivo de ejemplo para un local y un día: siempre el mismo contenido, para poder reimportarlo. */
export function samplePosCsv(code: string, now: IsoDateTime): string {
  const day = panamaDay(now).replace(/-/g, '');
  const start = addMinutes(now, -55);
  const sample: [string, number][][] = [
    [['CAP', 2], ['CRO', 2]],
    [['LAT', 1]],
    [['ESP', 1], ['SAN', 1]],
    [['CAP', 1], ['JUG', 1], ['QUI', 1]],
    [['AME', 2]],
    [['CHO', 1], ['CRO', 1]],
  ];
  const price: Record<string, string> = { ESP: '2.25', AME: '2.75', CAP: '3.75', LAT: '4.25', CHO: '3.95', CRO: '2.95', QUI: '5.50', SAN: '6.75', JUG: '4.50', LIM: '3.50' };
  const rows = [CSV_HEADER];
  sample.forEach((lines, i) => {
    const at = panamaIso(addMinutes(start, i * 8));
    for (const [item, q] of lines) rows.push(`${code}-F${day}${String(i + 1).padStart(2, '0')},${at},${item},${q},${price[item]}`);
  });
  return rows.join('\n');
}

export function parsePosCsv(text: string, locationId: LocationId, menu: PosItem[]): { tickets: SaleTicket[]; errors: string[] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errors: string[] = [];
  if (lines.length === 0) return { tickets: [], errors: ['El archivo está vacío.'] };
  const head = lines[0].toLowerCase().replace(/\s/g, '');
  const body = head.startsWith('ticket_id') ? lines.slice(1) : lines;
  if (!head.startsWith('ticket_id')) errors.push('El archivo no tiene el encabezado esperado; se intenta leer igualmente.');
  const byId = new Map<string, SaleTicket>();
  body.forEach((line, idx) => {
    const [id, at, item, qty, price] = line.split(/[;,]/).map((x) => x.trim());
    const q = Number(qty);
    const t = Date.parse(at);
    if (!id || !item || !(q > 0) || Number.isNaN(t)) {
      errors.push(`Línea ${idx + 2}: no se pudo interpretar («${line.slice(0, 60)}»).`);
      return;
    }
    const known = menu.find((m) => m.id === item.toUpperCase());
    const unitPriceCents = Number.isFinite(Number(price)) && price !== '' ? Math.round(Number(price) * 100) : known?.priceCents ?? 0;
    const ticket = byId.get(id) ?? { id, locationId, at: new Date(t).toISOString(), lines: [] as TicketLine[], totalCents: 0 };
    ticket.lines.push({ itemId: item.toUpperCase(), qty: q, unitPriceCents });
    ticket.totalCents += q * unitPriceCents;
    byId.set(id, ticket);
  });
  return { tickets: [...byId.values()], errors };
}
