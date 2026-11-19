import type {
  AuditEntity, AuditEvent, Cents, Ctx, DemoData, ID, InvoiceLine, Location, LocationId, OrderLine,
  PosItem, Product, PurchaseOrder, Reception, Recipe, Supplier, User,
} from './types';
import { DomainError } from './types';

// ───────────────────────────── Búsquedas ─────────────────────────────

export function productOf(d: DemoData, id: ID): Product {
  const p = d.products.find((x) => x.id === id);
  if (!p) throw new DomainError(`Producto desconocido: ${id}`);
  return p;
}

export function supplierOf(d: DemoData, id: ID): Supplier {
  const s = d.suppliers.find((x) => x.id === id);
  if (!s) throw new DomainError(`Proveedor desconocido: ${id}`);
  return s;
}

export function locationOf(d: DemoData, id: LocationId): Location {
  const l = d.locations.find((x) => x.id === id);
  if (!l) throw new DomainError(`Local desconocido: ${id}`);
  return l;
}

export function userOf(d: DemoData, id: ID): User | undefined {
  return d.users.find((x) => x.id === id);
}

export function userName(d: DemoData, id: ID): string {
  if (id === 'sistema') return 'Sistema';
  const u = d.users.find((x) => x.id === id);
  if (u) return u.name;
  const s = d.suppliers.find((x) => x.id === id);
  return s ? s.name : id;
}

export function orderOf(d: DemoData, id: ID): PurchaseOrder {
  const o = d.orders.find((x) => x.id === id);
  if (!o) throw new DomainError(`Pedido desconocido: ${id}`);
  return o;
}

export function recipeOf(d: DemoData, id: ID | undefined): Recipe | undefined {
  return id ? d.recipes.find((x) => x.id === id) : undefined;
}

export function posItemOf(d: DemoData, id: ID): PosItem | undefined {
  return d.posItems.find((x) => x.id === id);
}

export function requireUser(d: DemoData, ctx: Ctx): User {
  const u = userOf(d, ctx.userId);
  if (!u) throw new DomainError('Usuario no reconocido.');
  return u;
}

export const stockKey = (locationId: LocationId, productId: ID) => `${locationId}:${productId}`;

// ───────────────────────────── Identificadores y auditoría ─────────────────────────────

const PREFIX: Record<string, string> = {
  pedido: 'PED', recepcion: 'REC', factura: 'FAC', documento: 'DOC', pago: 'PAG', movimiento: 'MV',
  conteo: 'CON', sync: 'SYN', transferencia: 'TRF', evento: 'EV', mensaje: 'WA', receta: 'r',
};

export function nextId(d: DemoData, kind: keyof typeof PREFIX | string): ID {
  const n = (d.seq[kind] ?? 0) + 1;
  d.seq[kind] = n;
  return `${PREFIX[kind] ?? kind.toUpperCase()}-${n}`;
}

export function audit(
  d: DemoData,
  ctx: Ctx,
  entity: AuditEntity,
  action: string,
  summary: string,
  extra: { entityId?: ID; locationId?: LocationId; by?: ID } = {},
): AuditEvent {
  const ev: AuditEvent = {
    id: nextId(d, 'evento'),
    at: ctx.now,
    by: extra.by ?? ctx.userId,
    action,
    summary,
    entity,
    entityId: extra.entityId,
    locationId: extra.locationId,
  };
  d.audit.push(ev);
  if (ev.by !== 'sistema') d.meta.touched = true;
  return ev;
}

// ───────────────────────────── Totales ─────────────────────────────

export interface Totals {
  subtotalCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
}

export function lineSubtotal(l: { packs: number; unitPriceCents: Cents }): Cents {
  return Math.round(l.packs * l.unitPriceCents);
}

export function lineTax(l: { packs: number; unitPriceCents: Cents; taxRate: number }): Cents {
  return Math.round(l.packs * l.unitPriceCents * l.taxRate);
}

export function linesTotals(lines: (OrderLine | InvoiceLine)[]): Totals {
  let subtotalCents = 0;
  let taxCents = 0;
  for (const l of lines) {
    subtotalCents += lineSubtotal(l);
    taxCents += lineTax(l);
  }
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

export function orderTotals(o: PurchaseOrder): Totals {
  return linesTotals(o.lines);
}

// ───────────────────────────── Existencias ─────────────────────────────

/** Existencia teórica = suma de todos los movimientos del producto en el local. */
export function stockOf(d: DemoData, locationId: LocationId, productId: ID): number {
  let q = 0;
  for (const m of d.movements) {
    if (m.locationId === locationId && m.productId === productId) q += m.qty;
  }
  return Math.round(q * 1000) / 1000;
}

/** Presentaciones ya recibidas de cada línea de un pedido (suma de sus recepciones). */
export function receivedPacks(receptions: Reception[], orderId: ID): Map<ID, number> {
  const out = new Map<ID, number>();
  for (const r of receptions) {
    if (r.orderId !== orderId) continue;
    for (const l of r.lines) out.set(l.productId, (out.get(l.productId) ?? 0) + l.packsReceived);
  }
  return out;
}

export function groupBy<T, K extends string>(items: T[], key: (item: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const it of items) {
    const k = key(it);
    (out[k] ??= []).push(it);
  }
  return out;
}

export function sum<T>(items: T[], fn: (item: T) => number): number {
  let s = 0;
  for (const it of items) s += fn(it);
  return s;
}
