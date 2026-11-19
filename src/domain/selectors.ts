import type {
  Cents, DayStr, DemoData, ID, Invoice, IsoDateTime, LocationFilter, LocationId, PeriodId, PosConnection,
  Product, StockMovement, Supplier, User,
} from './types';
import { addDays, atPanama, diffDays, fmtAgo, fmtDate, fmtWhen, minutesBetween, monthName, panamaDay } from './time';
import { linesTotals, orderTotals, receivedPacks, stockKey, sum } from './core';
import { costPerBase, days as fmtDays, money, packs as fmtPacks, plural, qty as fmtQty } from './format';
import { analyzeInvoice, isPayable, paidCents, type Anomaly } from './invoices';
import { isOpenOrder, pendingLines } from './purchasing';

// ───────────────────────────── Memoización por identidad ─────────────────────────────

/**
 * Memoriza por identidad del argumento. Para los arreglos que solo crecen (el libro de movimientos)
 * se comprueba también la longitud, de modo que el resultado es correcto aunque se añada en sitio.
 */
function memo<A extends object, R>(fn: (a: A) => R): (a: A) => R {
  const cache = new WeakMap<A, { len: number; value: R }>();
  return (a) => {
    const len = Array.isArray(a) ? a.length : -1;
    const hit = cache.get(a);
    if (hit && hit.len === len) return hit.value;
    const value = fn(a);
    cache.set(a, { len, value });
    return value;
  };
}

export const inLocation = (filter: LocationFilter, id: LocationId) => filter === 'all' || filter === id;

// ───────────────────────────── Períodos ─────────────────────────────

export interface PeriodRange {
  id: PeriodId;
  from: DayStr;
  to: DayStr;
  days: number;
  label: string;
  prevFrom: DayStr;
  prevTo: DayStr;
  prevLabel: string;
}

export const PERIOD_LABEL: Record<PeriodId, string> = {
  hoy: 'Hoy',
  '7d': 'Últimos 7 días',
  '30d': 'Últimos 30 días',
  mes: 'Este mes',
};

export function periodRange(id: PeriodId, today: DayStr): PeriodRange {
  let from = today;
  if (id === '7d') from = addDays(today, -6);
  if (id === '30d') from = addDays(today, -29);
  if (id === 'mes') from = `${today.slice(0, 8)}01`;
  const n = diffDays(from, today) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(n - 1));
  const label = id === 'mes' ? `${monthName(today)} (hasta hoy)` : PERIOD_LABEL[id].toLowerCase();
  const prevLabel = id === 'hoy' ? 'ayer' : `${n} días previos`;
  return { id, from, to: today, days: n, label, prevFrom, prevTo, prevLabel };
}

const inRange = (day: DayStr, from: DayStr, to: DayStr) => day >= from && day <= to;

// ───────────────────────────── Existencias ─────────────────────────────

export const stockIndex = memo((movements: StockMovement[]) => {
  const m = new Map<string, number>();
  for (const mv of movements) {
    const k = stockKey(mv.locationId, mv.productId);
    m.set(k, (m.get(k) ?? 0) + mv.qty);
  }
  for (const [k, v] of m) m.set(k, Math.round(v * 1000) / 1000);
  return m;
});

export const lastMovementIndex = memo((movements: StockMovement[]) => {
  const m = new Map<string, StockMovement>();
  for (const mv of movements) {
    const k = stockKey(mv.locationId, mv.productId);
    const cur = m.get(k);
    if (!cur || mv.at >= cur.at) m.set(k, mv);
  }
  return m;
});

export function stockQty(d: DemoData, locationId: LocationId, productId: ID): number {
  return stockIndex(d.movements).get(stockKey(locationId, productId)) ?? 0;
}

let consCache: { movements: StockMovement[]; len: number; today: DayStr; value: Map<string, number> } | null = null;

/**
 * Consumo medio diario por producto y local.
 *  · Productos con receta: salidas por ventas y mermas de los últimos 28 días completos.
 *  · Productos sin receta: lo que revelan los conteos físicos (diferencia entre conteos / días transcurridos).
 */
export function consumptionIndex(movements: StockMovement[], today: DayStr): Map<string, number> {
  if (consCache && consCache.movements === movements && consCache.len === movements.length && consCache.today === today) return consCache.value;
  const from = atPanama(addDays(today, -28), 0);
  const to = atPanama(today, 0);
  const countFrom = atPanama(addDays(today, -29), 0);
  const flow = new Map<string, number>();
  const counts = new Map<string, { day: DayStr; qty: number }[]>();
  for (const mv of movements) {
    const k = stockKey(mv.locationId, mv.productId);
    if ((mv.type === 'venta' || mv.type === 'merma') && mv.at >= from && mv.at < to) {
      flow.set(k, (flow.get(k) ?? 0) - mv.qty);
    } else if (mv.type === 'ajuste_conteo' && mv.at >= countFrom) {
      const list = counts.get(k) ?? [];
      list.push({ day: panamaDay(mv.at), qty: mv.qty });
      counts.set(k, list);
    }
  }
  const out = new Map<string, number>();
  for (const [k, v] of flow) out.set(k, Math.max(0, v) / 28);
  for (const [k, list] of counts) {
    list.sort((a, b) => (a.day < b.day ? -1 : 1));
    let rate = 0;
    if (list.length >= 2) {
      const span = Math.max(1, diffDays(list[0].day, list[list.length - 1].day));
      rate = -sum(list.slice(1), (x) => x.qty) / span;
    } else {
      rate = -list[0].qty / 7;
    }
    if (rate > 0) out.set(k, (out.get(k) ?? 0) + rate);
  }
  consCache = { movements, len: movements.length, today, value: out };
  return out;
}

/** Cantidad pedida y aún no recibida, en unidad de referencia, por producto y local. */
export function inboundIndex(d: DemoData): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of d.orders) {
    if (!isOpenOrder(o)) continue;
    const got = receivedPacks(d.receptions, o.id);
    for (const l of o.lines) {
      const pending = l.packs - (got.get(l.productId) ?? 0);
      if (pending <= 0) continue;
      const k = stockKey(o.locationId, l.productId);
      m.set(k, (m.get(k) ?? 0) + pending * l.packBaseQty);
    }
  }
  return m;
}

export type StockLevel = 'agotado' | 'critico' | 'bajo' | 'ok';

export const STOCK_LEVEL_LABEL: Record<StockLevel, string> = {
  agotado: 'Agotado',
  critico: 'Crítico',
  bajo: 'Bajo mínimo',
  ok: 'Correcto',
};

export interface StockRow {
  product: Product;
  locationId: LocationId;
  qty: number;
  minBase: number;
  parBase: number;
  /** Consumo medio por día (unidad de referencia); 0 si no hay datos. */
  avgDaily: number;
  /** Días de cobertura; null si no hay datos de consumo suficientes. */
  coverageDays: number | null;
  inboundBase: number;
  last?: StockMovement;
  valueCents: Cents;
  level: StockLevel;
}

export function stockRows(d: DemoData, today: DayStr, filter: LocationFilter): StockRow[] {
  const stock = stockIndex(d.movements);
  const cons = consumptionIndex(d.movements, today);
  const last = lastMovementIndex(d.movements);
  const inbound = inboundIndex(d);
  const rows: StockRow[] = [];
  for (const loc of d.locations) {
    if (!inLocation(filter, loc.id)) continue;
    for (const product of d.products) {
      const k = stockKey(loc.id, product.id);
      const qty = stock.get(k) ?? 0;
      const setting = d.stockSettings[k] ?? { minBase: 0, parBase: 0 };
      const avgDaily = cons.get(k) ?? 0;
      const coverageDays = avgDaily > 0 ? Math.max(0, qty) / avgDaily : null;
      const level: StockLevel =
        qty <= 0 ? 'agotado' : qty < setting.minBase ? (coverageDays !== null && coverageDays < 1 ? 'critico' : 'bajo') : 'ok';
      rows.push({
        product, locationId: loc.id, qty, minBase: setting.minBase, parBase: setting.parBase, avgDaily, coverageDays,
        inboundBase: inbound.get(k) ?? 0, last: last.get(k),
        valueCents: Math.round(Math.max(0, qty) * costPerBase(product)), level,
      });
    }
  }
  return rows;
}

export function stockValueCents(d: DemoData, filter: LocationFilter): Cents {
  const stock = stockIndex(d.movements);
  let total = 0;
  for (const loc of d.locations) {
    if (!inLocation(filter, loc.id)) continue;
    for (const p of d.products) total += Math.max(0, stock.get(stockKey(loc.id, p.id)) ?? 0) * costPerBase(p);
  }
  return Math.round(total);
}

/** Existencia al cierre de cada día para un producto (para explicar su evolución). */
export function stockHistory(d: DemoData, locationId: LocationId, productId: ID, today: DayStr, nDays = 30): { day: DayStr; qty: number }[] {
  const from = addDays(today, -(nDays - 1));
  const byDay = new Map<DayStr, number>();
  let before = 0;
  for (const mv of d.movements) {
    if (mv.locationId !== locationId || mv.productId !== productId) continue;
    const day = panamaDay(mv.at);
    if (day < from) before += mv.qty;
    else byDay.set(day, (byDay.get(day) ?? 0) + mv.qty);
  }
  const out: { day: DayStr; qty: number }[] = [];
  let running = before;
  for (let day = from; day <= today; day = addDays(day, 1)) {
    running += byDay.get(day) ?? 0;
    out.push({ day, qty: Math.round(running * 1000) / 1000 });
  }
  return out;
}

// ───────────────────────────── Sugerencias de reabastecimiento ─────────────────────────────

export interface SuggestionLine {
  product: Product;
  packs: number;
  qty: number;
  avgDaily: number;
  coverageDays: number | null;
  inboundBase: number;
  minBase: number;
  parBase: number;
  level: StockLevel;
  reason: string;
}

export interface Suggestion {
  supplier: Supplier;
  locationId: LocationId;
  lines: SuggestionLine[];
  subtotalCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
  deliveryDay: DayStr;
  worst: StockLevel;
}

const LEVEL_RANK: Record<StockLevel, number> = { agotado: 0, critico: 1, bajo: 2, ok: 3 };

/**
 * Sugiere qué pedir: productos cuya existencia (más lo ya pedido) no cubre hasta la siguiente entrega
 * posible con un día de margen. La cantidad lleva el stock al nivel objetivo, redondeada a presentaciones.
 */
export function suggestions(d: DemoData, locationId: LocationId, today: DayStr): Suggestion[] {
  const rows = stockRows(d, today, locationId);
  const bySupplier = new Map<ID, SuggestionLine[]>();
  for (const r of rows) {
    const supplier = d.suppliers.find((s) => s.id === r.product.offer.supplierId)!;
    const available = r.qty + r.inboundBase;
    const reorderPoint = r.minBase + r.avgDaily * supplier.leadTimeDays;
    if (available >= reorderPoint || r.parBase <= available) continue;
    const pack = r.product.offer.pack.baseQty;
    const packs = Math.max(1, Math.ceil((r.parBase - available) / pack - 0.02));
    const reason =
      r.level === 'agotado' ? 'Sin existencia'
      : r.coverageDays !== null ? `Cobertura de ${fmtDays(r.coverageDays)}; la entrega tarda ${fmtDays(supplier.leadTimeDays)}`
      : 'Por debajo del punto de pedido';
    const list = bySupplier.get(supplier.id) ?? [];
    list.push({
      product: r.product, packs, qty: r.qty, avgDaily: r.avgDaily, coverageDays: r.coverageDays, inboundBase: r.inboundBase,
      minBase: r.minBase, parBase: r.parBase, level: r.level, reason,
    });
    bySupplier.set(supplier.id, list);
  }
  const out: Suggestion[] = [];
  for (const [supplierId, lines] of bySupplier) {
    const supplier = d.suppliers.find((s) => s.id === supplierId)!;
    lines.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || (a.coverageDays ?? 99) - (b.coverageDays ?? 99));
    const totals = linesTotals(
      lines.map((l) => ({
        productId: l.product.id, packs: l.packs, packBaseQty: l.product.offer.pack.baseQty, packLabel: l.product.offer.pack.label,
        unitPriceCents: l.product.offer.priceCents, taxRate: l.product.offer.taxRate,
      })),
    );
    out.push({ supplier, locationId, lines, ...totals, deliveryDay: addDays(today, supplier.leadTimeDays), worst: lines[0].level });
  }
  return out.sort((a, b) => LEVEL_RANK[a.worst] - LEVEL_RANK[b.worst] || b.totalCents - a.totalCents);
}

/** Presentaciones sugeridas por producto (para la columna «necesidad estimada» del catálogo). */
export function suggestedPacks(d: DemoData, locationId: LocationId, today: DayStr): Map<ID, number> {
  const m = new Map<ID, number>();
  for (const s of suggestions(d, locationId, today)) for (const l of s.lines) m.set(l.product.id, l.packs);
  return m;
}

// ───────────────────────────── Ventas ─────────────────────────────

export interface SalesTotals {
  revenueCents: Cents;
  tickets: number;
  avgTicketCents: Cents;
}

export function salesTotals(d: DemoData, from: DayStr, to: DayStr, filter: LocationFilter): SalesTotals {
  let revenueCents = 0;
  let tickets = 0;
  for (const sd of Object.values(d.salesDays)) {
    if (!inRange(sd.day, from, to) || !inLocation(filter, sd.locationId)) continue;
    revenueCents += sd.revenueCents;
    tickets += sd.tickets;
  }
  return { revenueCents, tickets, avgTicketCents: tickets ? Math.round(revenueCents / tickets) : 0 };
}

export const earliestSalesDay = memo((salesDays: DemoData['salesDays']) => {
  let min = '9999-12-31';
  for (const sd of Object.values(salesDays)) if (sd.day < min) min = sd.day;
  return min;
});

export interface SalesPoint {
  day: DayStr;
  cv: number;
  sf: number;
  ce: number;
  total: number;
}

export function salesSeries(d: DemoData, from: DayStr, to: DayStr): SalesPoint[] {
  const out: SalesPoint[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const cv = d.salesDays[`${day}|cv`]?.revenueCents ?? 0;
    const sf = d.salesDays[`${day}|sf`]?.revenueCents ?? 0;
    const ce = d.salesDays[`${day}|ce`]?.revenueCents ?? 0;
    out.push({ day, cv, sf, ce, total: cv + sf + ce });
  }
  return out;
}

export interface ItemSales {
  itemId: ID;
  qty: number;
  revenueCents: Cents;
}

export function itemSales(d: DemoData, from: DayStr, to: DayStr, filter: LocationFilter): ItemSales[] {
  const m = new Map<ID, ItemSales>();
  for (const sd of Object.values(d.salesDays)) {
    if (!inRange(sd.day, from, to) || !inLocation(filter, sd.locationId)) continue;
    for (const [itemId, [q, rev]] of Object.entries(sd.items)) {
      const cur = m.get(itemId) ?? { itemId, qty: 0, revenueCents: 0 };
      cur.qty += q;
      cur.revenueCents += rev;
      m.set(itemId, cur);
    }
  }
  return [...m.values()].sort((a, b) => b.revenueCents - a.revenueCents);
}

/** Minutos sin sincronizar a partir de los cuales una caja se considera desactualizada. */
export const POS_STALE_MINUTES = 120;

export function posNeedsAttention(conn: PosConnection, now: IsoDateTime): boolean {
  return conn.status === 'requiere_sync' || minutesBetween(conn.lastSyncAt, now) > POS_STALE_MINUTES;
}

export function undeductedByItem(d: DemoData, filter: LocationFilter): { itemId: ID; qty: number; revenueCents: Cents; firstDay: DayStr; lastDay: DayStr }[] {
  const m = new Map<ID, { itemId: ID; qty: number; revenueCents: Cents; firstDay: DayStr; lastDay: DayStr }>();
  for (const u of Object.values(d.undeducted)) {
    if (!inLocation(filter, u.locationId) || u.qty <= 0) continue;
    const cur = m.get(u.itemId) ?? { itemId: u.itemId, qty: 0, revenueCents: 0, firstDay: u.firstDay, lastDay: u.lastDay };
    cur.qty += u.qty;
    cur.revenueCents += u.revenueCents;
    if (u.firstDay < cur.firstDay) cur.firstDay = u.firstDay;
    if (u.lastDay > cur.lastDay) cur.lastDay = u.lastDay;
    m.set(u.itemId, cur);
  }
  return [...m.values()];
}

// ───────────────────────────── Compras: tres cifras que no se mezclan ─────────────────────────────

export interface PurchaseFlow {
  /** Pedidos aprobados o enviados cuya mercancía aún no ha llegado (valor pendiente de recibir, sin impuestos). */
  committedCents: Cents;
  committedOrders: number;
  /** Pedidos a la espera de aprobación: todavía no comprometen compra. */
  awaitingApprovalCents: Cents;
  awaitingApprovalOrders: number;
  /** Mercancía realmente recibida en el período, a precio de pedido y sin impuestos. */
  receivedCents: Cents;
  receptions: number;
  /** Facturas con fecha de emisión en el período (total con impuestos). */
  invoicedCents: Cents;
  invoices: number;
  /** Pagos registrados en el período. */
  paidCents: Cents;
  payments: number;
}

export function purchaseFlow(d: DemoData, from: DayStr, to: DayStr, filter: LocationFilter): PurchaseFlow {
  const f: PurchaseFlow = {
    committedCents: 0, committedOrders: 0, awaitingApprovalCents: 0, awaitingApprovalOrders: 0,
    receivedCents: 0, receptions: 0, invoicedCents: 0, invoices: 0, paidCents: 0, payments: 0,
  };
  const orderById = new Map(d.orders.map((o) => [o.id, o]));
  for (const o of d.orders) {
    if (!inLocation(filter, o.locationId)) continue;
    if (o.status === 'pendiente_aprobacion') {
      f.awaitingApprovalCents += orderTotals(o).subtotalCents;
      f.awaitingApprovalOrders++;
    } else if (isOpenOrder(o)) {
      const pend = sum(pendingLines(d, o), (p) => Math.round(p.pending * p.line.unitPriceCents));
      if (pend > 0) {
        f.committedCents += pend;
        f.committedOrders++;
      }
    }
  }
  for (const r of d.receptions) {
    if (!inLocation(filter, r.locationId) || !inRange(panamaDay(r.receivedAt), from, to)) continue;
    const o = orderById.get(r.orderId);
    if (!o) continue;
    f.receptions++;
    for (const l of r.lines) {
      const ol = o.lines.find((x) => x.productId === l.productId);
      if (ol) f.receivedCents += Math.round(l.packsReceived * ol.unitPriceCents);
    }
  }
  const invById = new Map(d.invoices.map((i) => [i.id, i]));
  for (const i of d.invoices) {
    if (i.status === 'descartada' || !inLocation(filter, i.locationId) || !inRange(i.issueDate, from, to)) continue;
    f.invoicedCents += i.totalCents;
    f.invoices++;
  }
  for (const p of d.payments) {
    if (p.voidedAt || !inRange(p.date, from, to)) continue;
    const inv = invById.get(p.invoiceId);
    if (!inv || !inLocation(filter, inv.locationId)) continue;
    f.paidCents += p.amountCents;
    f.payments++;
  }
  return f;
}

export function purchasesBySupplier(d: DemoData, from: DayStr, to: DayStr, filter: LocationFilter): { supplier: Supplier; cents: Cents }[] {
  const orderById = new Map(d.orders.map((o) => [o.id, o]));
  const m = new Map<ID, number>();
  for (const r of d.receptions) {
    if (!inLocation(filter, r.locationId) || !inRange(panamaDay(r.receivedAt), from, to)) continue;
    const o = orderById.get(r.orderId);
    if (!o) continue;
    for (const l of r.lines) {
      const ol = o.lines.find((x) => x.productId === l.productId);
      if (ol) m.set(o.supplierId, (m.get(o.supplierId) ?? 0) + Math.round(l.packsReceived * ol.unitPriceCents));
    }
  }
  return d.suppliers.map((supplier) => ({ supplier, cents: m.get(supplier.id) ?? 0 })).sort((a, b) => b.cents - a.cents);
}

// ───────────────────────────── Cuentas por pagar ─────────────────────────────

export type PayBucket = 'vencida' | 'semana' | 'despues';

export interface PayableRow {
  invoice: Invoice;
  supplier?: Supplier;
  balanceCents: Cents;
  paidCents: Cents;
  /** Días hasta el vencimiento (negativo = vencida). */
  daysToDue: number;
  bucket: PayBucket;
}

export interface Payables {
  overdue: PayableRow[];
  week: PayableRow[];
  later: PayableRow[];
  /** Facturas recibidas que aún no son deuda reconocida. */
  pendingValidation: Invoice[];
  disputed: Invoice[];
  paid: Invoice[];
  totals: {
    overdueCents: Cents;
    weekCents: Cents;
    laterCents: Cents;
    payableCents: Cents;
    pendingValidationCents: Cents;
    disputedCents: Cents;
    paidCents: Cents;
  };
}

export function payables(d: DemoData, filter: LocationFilter, today: DayStr): Payables {
  const p: Payables = {
    overdue: [], week: [], later: [], pendingValidation: [], disputed: [], paid: [],
    totals: { overdueCents: 0, weekCents: 0, laterCents: 0, payableCents: 0, pendingValidationCents: 0, disputedCents: 0, paidCents: 0 },
  };
  const weekEnd = addDays(today, 7);
  for (const inv of d.invoices) {
    if (!inLocation(filter, inv.locationId)) continue;
    if (inv.status === 'por_revisar') {
      p.pendingValidation.push(inv);
      p.totals.pendingValidationCents += inv.totalCents;
    } else if (inv.status === 'en_disputa') {
      p.disputed.push(inv);
      p.totals.disputedCents += inv.dispute?.amountCents ?? inv.totalCents;
    } else if (inv.status === 'pagada') {
      p.paid.push(inv);
      p.totals.paidCents += inv.totalCents;
    } else if (isPayable(inv)) {
      const paid = paidCents(d, inv.id);
      const balance = inv.totalCents - paid;
      const daysToDue = diffDays(today, inv.dueDate);
      const bucket: PayBucket = inv.dueDate < today ? 'vencida' : inv.dueDate <= weekEnd ? 'semana' : 'despues';
      const row: PayableRow = { invoice: inv, supplier: d.suppliers.find((s) => s.id === inv.supplierId), balanceCents: balance, paidCents: paid, daysToDue, bucket };
      p.totals.payableCents += balance;
      if (bucket === 'vencida') {
        p.overdue.push(row);
        p.totals.overdueCents += balance;
      } else if (bucket === 'semana') {
        p.week.push(row);
        p.totals.weekCents += balance;
      } else {
        p.later.push(row);
        p.totals.laterCents += balance;
      }
    }
  }
  const byDue = (a: PayableRow, b: PayableRow) => (a.invoice.dueDate < b.invoice.dueDate ? -1 : a.invoice.dueDate > b.invoice.dueDate ? 1 : b.balanceCents - a.balanceCents);
  p.overdue.sort(byDue);
  p.week.sort(byDue);
  p.later.sort(byDue);
  p.paid.sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
  p.pendingValidation.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  return p;
}

export interface SupplierBalance {
  supplier: Supplier;
  balanceCents: Cents;
  overdueCents: Cents;
  weekCents: Cents;
  nextDue?: DayStr;
  openInvoices: number;
  pendingValidationCents: Cents;
  disputedCents: Cents;
  paid30Cents: Cents;
}

export function supplierBalances(d: DemoData, filter: LocationFilter, today: DayStr): SupplierBalance[] {
  const p = payables(d, filter, today);
  const from30 = addDays(today, -29);
  return d.suppliers.map((supplier) => {
    const rows = [...p.overdue, ...p.week, ...p.later].filter((r) => r.invoice.supplierId === supplier.id);
    const invIds = new Set(d.invoices.filter((i) => i.supplierId === supplier.id && inLocation(filter, i.locationId)).map((i) => i.id));
    return {
      supplier,
      balanceCents: sum(rows, (r) => r.balanceCents),
      overdueCents: sum(rows.filter((r) => r.bucket === 'vencida'), (r) => r.balanceCents),
      weekCents: sum(rows.filter((r) => r.bucket === 'semana'), (r) => r.balanceCents),
      nextDue: rows.length ? rows.map((r) => r.invoice.dueDate).sort()[0] : undefined,
      openInvoices: rows.length,
      pendingValidationCents: sum(p.pendingValidation.filter((i) => i.supplierId === supplier.id), (i) => i.totalCents),
      disputedCents: sum(p.disputed.filter((i) => i.supplierId === supplier.id), (i) => i.dispute?.amountCents ?? i.totalCents),
      paid30Cents: sum(d.payments.filter((x) => !x.voidedAt && invIds.has(x.invoiceId) && x.date >= from30), (x) => x.amountCents),
    };
  });
}

// ───────────────────────────── Indicadores del resumen ─────────────────────────────

export interface Kpis {
  range: PeriodRange;
  sales: SalesTotals;
  /** null si no hay datos suficientes del período anterior. */
  salesDelta: number | null;
  salesDeltaLabel: string;
  flow: PurchaseFlow;
  /** Compras recibidas / ventas del período. */
  costRatio: number | null;
  stockValueCents: Cents;
  due7Cents: Cents;
  due7Count: number;
  overdueCents: Cents;
  overdueCount: number;
  belowMin: number;
  critical: number;
}

export function kpis(d: DemoData, filter: LocationFilter, period: PeriodId, today: DayStr): Kpis {
  const range = periodRange(period, today);
  const sales = salesTotals(d, range.from, range.to, filter);
  // La tendencia se calcula sobre días completos (hoy está en curso y sesgaría la comparación).
  const n = period === 'hoy' ? 0 : period === 'mes' ? diffDays(range.from, today) : range.days;
  const curTo = addDays(today, -1);
  const curFrom = addDays(curTo, -(n - 1));
  const prevTo = addDays(curFrom, -1);
  const prevFrom = addDays(prevTo, -(n - 1));
  const hasPrev = n > 0 && earliestSalesDay(d.salesDays) <= prevFrom;
  const cur = hasPrev ? salesTotals(d, curFrom, curTo, filter) : null;
  const prev = hasPrev ? salesTotals(d, prevFrom, prevTo, filter) : null;
  const flow = purchaseFlow(d, range.from, range.to, filter);
  const pay = payables(d, filter, today);
  const rows = stockRows(d, today, filter);
  return {
    range,
    sales,
    salesDelta: cur && prev && prev.revenueCents > 0 ? cur.revenueCents / prev.revenueCents - 1 : null,
    salesDeltaLabel: n > 0 ? `vs. ${n} días previos (días completos)` : '',
    flow,
    costRatio: sales.revenueCents > 0 && period !== 'hoy' ? flow.receivedCents / sales.revenueCents : null,
    stockValueCents: sum(rows, (r) => r.valueCents),
    due7Cents: pay.totals.weekCents,
    due7Count: pay.week.length,
    overdueCents: pay.totals.overdueCents,
    overdueCount: pay.overdue.length,
    belowMin: rows.filter((r) => r.level !== 'ok').length,
    critical: rows.filter((r) => r.level === 'critico' || r.level === 'agotado').length,
  };
}

export interface LocationStat {
  locationId: LocationId;
  sales: SalesTotals;
  receivedCents: Cents;
  costRatio: number | null;
  belowMin: number;
  stockValueCents: Cents;
  pos?: PosConnection;
}

export function locationStats(d: DemoData, period: PeriodId, today: DayStr): LocationStat[] {
  const range = periodRange(period, today);
  return d.locations.map((loc) => {
    const sales = salesTotals(d, range.from, range.to, loc.id);
    const flow = purchaseFlow(d, range.from, range.to, loc.id);
    const rows = stockRows(d, today, loc.id);
    return {
      locationId: loc.id,
      sales,
      receivedCents: flow.receivedCents,
      costRatio: sales.revenueCents > 0 && period !== 'hoy' ? flow.receivedCents / sales.revenueCents : null,
      belowMin: rows.filter((r) => r.level !== 'ok').length,
      stockValueCents: sum(rows, (r) => r.valueCents),
      pos: d.posConnections.find((c) => c.locationId === loc.id),
    };
  });
}

// ───────────────────────────── Alertas: «lo que requiere tu atención» ─────────────────────────────

export type AlertKind =
  | 'stock'
  | 'aprobacion'
  | 'factura'
  | 'recepcion_parcial'
  | 'caja'
  | 'pagos_vencidos'
  | 'pagos_semana'
  | 'sin_receta'
  | 'documento';

export type AlertSeverity = 'alta' | 'media' | 'info';

export interface Alert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail: string;
  cta: string;
  /** Ruta a la que lleva la acción. */
  to: string;
  locationId?: LocationId;
  /** Marcador para el recorrido guiado. */
  tourKey?: string;
}

function invoiceAlertText(a: Anomaly): { title: string; cta: string } {
  switch (a.kind) {
    case 'precio': return { title: 'Factura con diferencia de precio', cta: 'Revisar' };
    case 'cantidad': return { title: 'Factura por más de lo recibido', cta: 'Revisar' };
    case 'duplicado': return { title: 'Posible factura duplicada', cta: 'Comparar' };
    case 'sin_pedido': return { title: 'Factura sin pedido', cta: 'Revisar' };
    default: return { title: 'Factura con diferencias', cta: 'Revisar' };
  }
}

const ANOMALY_RANK: Record<string, number> = { precio: 0, cantidad: 1, duplicado: 2, sin_pedido: 3, no_pedido: 4, total: 5 };

export function alerts(d: DemoData, user: User, now: IsoDateTime): Alert[] {
  const today = panamaDay(now);
  const scope: LocationFilter = user.role === 'gerente' && user.locationId ? user.locationId : 'all';
  const locName = (id: LocationId) => d.locations.find((l) => l.id === id)!.name;
  const out: Alert[] = [];
  const canOps = user.role !== 'contabilidad';
  const canFinance = user.role !== 'gerente';

  // 1 · Riesgo de quiebre
  if (canOps) {
    const risky = stockRows(d, today, scope)
      .filter((r) => (r.level === 'critico' || r.level === 'agotado') && r.product.recipeTracked)
      .sort((a, b) => (a.coverageDays ?? 0) - (b.coverageDays ?? 0));
    for (const r of risky.slice(0, 2)) {
      const hasInbound = r.inboundBase > 0;
      out.push({
        id: `stock:${r.locationId}:${r.product.id}`,
        kind: 'stock',
        severity: 'alta',
        title: `${r.product.name} está por agotarse en ${locName(r.locationId)}`,
        detail:
          `Quedan ${fmtQty(r.qty, r.product.baseUnit)}` +
          (r.coverageDays !== null ? ` · cobertura de ${fmtDays(r.coverageDays)}` : '') +
          (hasInbound ? ` · en camino: ${fmtQty(r.inboundBase, r.product.baseUnit)}` : ' · sin pedido en curso'),
        cta: hasInbound ? 'Ver inventario' : 'Preparar pedido',
        to: hasInbound
          ? `/inventario?local=${r.locationId}&producto=${r.product.id}`
          : `/compras?local=${r.locationId}&sugerencia=${r.product.offer.supplierId}`,
        locationId: r.locationId,
        tourKey: r.locationId === 'sf' && r.product.id === 'p-leche' ? 'alerta-leche' : undefined,
      });
    }
  }

  // 2 · Facturas en revisión con diferencias de precio o cantidad (las demás, más abajo)
  const flagged = canFinance
    ? d.invoices
        .filter((i) => i.status === 'por_revisar' && inLocation(scope, i.locationId))
        .map((i) => ({ inv: i, anomalies: analyzeInvoice(d, i).anomalies }))
        .filter((x) => x.anomalies.length > 0)
        .map((x) => ({ ...x, top: [...x.anomalies].sort((a, b) => ANOMALY_RANK[a.kind] - ANOMALY_RANK[b.kind])[0] }))
        .sort((a, b) => ANOMALY_RANK[a.top.kind] - ANOMALY_RANK[b.top.kind])
    : [];
  const pushInvoice = ({ inv, top }: (typeof flagged)[number]) => {
    const t = invoiceAlertText(top);
    const supplier = d.suppliers.find((s) => s.id === inv.supplierId);
    out.push({
      id: `factura:${inv.id}`, kind: 'factura', severity: top.kind === 'sin_pedido' ? 'media' : 'alta',
      title: t.title,
      detail:
        `${inv.number} · ${supplier?.name ?? 'Proveedor por identificar'} · ${locName(inv.locationId)}` +
        (top.amountCents && top.kind !== 'duplicado' ? ` · ${top.amountCents > 0 ? '+' : ''}${money(top.amountCents)}` : ` · ${money(inv.totalCents)}`),
      cta: t.cta, to: `/facturas/${inv.id}`, locationId: inv.locationId,
    });
  };
  const urgent = (k: string) => k === 'precio' || k === 'cantidad';
  flagged.filter((x) => urgent(x.top.kind)).slice(0, 2).forEach(pushInvoice);

  // 3 · Entregas parciales
  if (canOps) {
    for (const o of d.orders.filter((x) => x.status === 'recibido_parcial' && inLocation(scope, x.locationId)).slice(0, 2)) {
      const missing = pendingLines(d, o).filter((p) => p.pending > 0);
      const first = missing[0];
      const p = first ? d.products.find((x) => x.id === first.line.productId)! : undefined;
      out.push({
        id: `parcial:${o.id}`, kind: 'recepcion_parcial', severity: 'media',
        title: 'Pedido entregado parcialmente',
        detail:
          `${o.id} · ${d.suppliers.find((s) => s.id === o.supplierId)!.name} · ${locName(o.locationId)}` +
          (p && first ? ` · faltan ${fmtPacks(first.pending, p.offer.pack)} de ${p.name}` : '') +
          (missing.length > 1 ? ` y ${missing.length - 1} más` : ''),
        cta: 'Ver recepción', to: `/compras/pedidos/${o.id}`, locationId: o.locationId,
      });
    }
  }

  // 4 · Cajas sin sincronizar
  for (const c of d.posConnections) {
    if (!inLocation(scope, c.locationId) || !posNeedsAttention(c, now)) continue;
    out.push({
      id: `caja:${c.locationId}`, kind: 'caja', severity: 'media',
      title: `Caja de ${locName(c.locationId)} sin sincronizar`,
      detail: `Última sincronización: ${fmtWhen(c.lastSyncAt, now)} (${fmtAgo(c.lastSyncAt, now)}). Las ventas posteriores aún no descuentan inventario.`,
      cta: 'Ver estado', to: `/ventas?local=${c.locationId}`, locationId: c.locationId,
    });
  }

  // 5 · Pagos
  if (canFinance) {
    const pay = payables(d, scope, today);
    if (pay.overdue.length > 0) {
      const first = pay.overdue[0];
      out.push({
        id: 'pagos:vencidos', kind: 'pagos_vencidos', severity: 'alta',
        title: pay.overdue.length === 1 ? 'Una factura vencida' : `${pay.overdue.length} facturas vencidas`,
        detail: `${money(pay.totals.overdueCents)} · ${first.supplier?.name ?? ''}, vencida el ${fmtDate(first.invoice.dueDate)}`,
        cta: 'Ver pagos', to: '/facturas/pagos?vista=vencidas',
      });
    }
    if (pay.week.length > 0) {
      const first = pay.week[0];
      out.push({
        id: 'pagos:semana', kind: 'pagos_semana', severity: 'info',
        title: `${plural(pay.week.length, 'factura vence', 'facturas vencen')} en los próximos 7 días`,
        detail: `${money(pay.totals.weekCents)} · la primera el ${fmtDate(first.invoice.dueDate)} (${first.supplier?.name ?? ''})`,
        cta: 'Ver pagos', to: '/facturas/pagos?vista=semana',
      });
    }
  }

  // 7 · Pedidos que esperan aprobación (solo Dirección)
  if (user.role === 'direccion') {
    const waiting = d.orders.filter((o) => o.status === 'pendiente_aprobacion');
    if (waiting.length === 1) {
      const o = waiting[0];
      out.push({
        id: `aprobacion:${o.id}`, kind: 'aprobacion', severity: 'media',
        title: 'Un pedido espera tu aprobación',
        detail: `${o.id} · ${d.suppliers.find((s) => s.id === o.supplierId)!.name} · ${locName(o.locationId)} · ${money(orderTotals(o).totalCents)}`,
        cta: 'Revisar y aprobar', to: `/compras/pedidos/${o.id}`, locationId: o.locationId,
      });
    } else if (waiting.length > 1) {
      out.push({
        id: 'aprobacion:varios', kind: 'aprobacion', severity: 'media',
        title: `${waiting.length} pedidos esperan tu aprobación`,
        detail: `Importe total ${money(sum(waiting, (o) => orderTotals(o).totalCents))}`,
        cta: 'Ver pedidos', to: '/compras/pedidos?estado=pendiente_aprobacion',
      });
    }
  }

  // 8 · Otras facturas con alertas (posible duplicado, sin pedido)
  flagged.filter((x) => !urgent(x.top.kind)).slice(0, 2).forEach(pushInvoice);

  // 9 · Artículos de caja sin receta
  if (canOps) {
    for (const u of undeductedByItem(d, scope)) {
      const item = d.posItems.find((x) => x.id === u.itemId);
      out.push({
        id: `receta:${u.itemId}`, kind: 'sin_receta', severity: 'media',
        title: `Artículo de caja sin receta: ${item?.name ?? u.itemId}`,
        detail: `${plural(u.qty, 'venta', 'ventas')} desde el ${fmtDate(u.firstDay)} sin descontar del inventario`,
        cta: 'Asignar receta', to: '/ventas?vista=correspondencias',
      });
    }
  }

  // 10 · Documentos sin procesar
  if (canFinance) {
    const raw = d.documents.filter((x) => x.status === 'recibido' && !x.invoiceId && inLocation(scope, x.locationId));
    if (raw.length > 0) {
      out.push({
        id: 'documentos:nuevos', kind: 'documento', severity: 'info',
        title: raw.length === 1 ? 'Una factura recibida sin procesar' : `${raw.length} facturas recibidas sin procesar`,
        detail: `Recibida ${fmtAgo(raw[raw.length - 1].receivedAt, now)} desde ${locName(raw[raw.length - 1].locationId)}`,
        cta: 'Procesar', to: '/facturas',
      });
    }
  }

  return out;
}

