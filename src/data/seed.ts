import type {
  AuditEntity, AuditEvent, DemoData, ID, Invoice, InvoiceLine, IsoDateTime, LocationId, OrderLine, PaymentMethod,
  PrintedInvoice, Product, PurchaseOrder, Reception, SaleTicket, SourceDocument, StockCount, Supplier,
} from '@/domain/types';
import { addDays, addMinutes, atPanama, fmtDate, panamaDay } from '@/domain/time';
import { linesTotals, nextId, orderTotals, stockKey } from '@/domain/core';
import { composeOrderMessage, composeSupplierReply } from '@/domain/purchasing';
import { importTickets } from '@/domain/sales';
import { money, packs as fmtPacks, qty as fmtQty } from '@/domain/format';
import { businessMinutesBack, dayTicketCount, ticketsOfDay } from '@/adapters/pos';
import { between, rngFrom, unit } from '@/lib/rng';
import {
  ITEM_MIX, LAST_DELIVERY_AGO, LIMONADA_SINCE_DAYS, LOCATIONS, MIX_TWEAK, OFF_RECIPE_USAGE, POS_ITEMS, PRODUCTS,
  SUPPLIERS, SYSTEM_USER, USERS, seedRecipes,
} from './catalog';

export const SCHEMA_VERSION = 3;

/** Días de historial de inventario y compras. Las ventas guardan 60 para poder comparar períodos. */
const HISTORY_DAYS = 30;
const SALES_DAYS = 62;
/** Solo se guarda el registro de actividad de los últimos días (el resto vive en los propios documentos). */
const AUDIT_DAYS = 6;

const INVOICE_NUMBER_BASE: Record<string, number> = {
  's-baru': 412, 's-pradera': 4790, 's-molinos': 118150, 's-azuero': 7702, 's-canal': 20918, 's-pacifico': 598,
};

/** Numeración de facturas de cada proveedor ficticio. */
export function nextSupplierInvoiceNumber(d: DemoData, supplierId: ID, year: string): string {
  const key = `num:${supplierId}`;
  const n = (d.seq[key] ?? INVOICE_NUMBER_BASE[supplierId] ?? 100) + 1;
  d.seq[key] = n;
  switch (supplierId) {
    case 's-baru': return `TB-${year}-${String(n).padStart(4, '0')}`;
    case 's-pradera': return `LP-${String(n).padStart(6, '0')}`;
    case 's-molinos': return `MI-${n}`;
    case 's-azuero': return `HA-${n}`;
    case 's-canal': return `EC-F-${n}`;
    default: return `HP-${String(n).padStart(5, '0')}`;
  }
}

/** Proveedores que imprimen el vencimiento en la factura (los demás: se propone según sus condiciones). */
export const PRINTS_DUE_DATE = ['s-baru', 's-molinos', 's-canal', 's-pacifico'];
/** Proveedores que citan nuestra referencia de pedido en la factura. */
export const PRINTS_ORDER_REF = ['s-baru', 's-pradera', 's-molinos', 's-canal'];

const PAY_METHOD: Record<string, PaymentMethod> = {
  's-baru': 'ach', 's-pradera': 'ach', 's-molinos': 'ach', 's-azuero': 'yappy', 's-canal': 'cheque', 's-pacifico': 'ach',
};

export function paymentReference(method: PaymentMethod, seed: string): string {
  const n = Math.floor(unit(`ref:${seed}`) * 900000) + 100000;
  if (method === 'ach') return `ACH-${n}`;
  if (method === 'yappy') return `YAP-${String(n).slice(0, 5)}`;
  if (method === 'cheque') return `CK-${String(n).slice(0, 4)}`;
  if (method === 'tarjeta') return `TC-${String(n).slice(0, 4)}`;
  return `EF-${String(n).slice(0, 4)}`;
}

function niceLevel(v: number, base: Product['baseUnit']): number {
  if (base === 'un') {
    if (v >= 500) return Math.ceil(v / 100) * 100;
    if (v >= 100) return Math.ceil(v / 50) * 50;
    if (v >= 20) return Math.ceil(v / 10) * 10;
    return Math.max(5, Math.ceil(v / 5) * 5);
  }
  const d = v / 1000;
  const r = d >= 20 ? Math.ceil(d) : d >= 5 ? Math.ceil(d * 2) / 2 : Math.max(0.25, Math.ceil(d * 4) / 4);
  return r * 1000;
}

const CAPTIONS = [
  'Factura de {s} de hoy',
  'Aquí la factura de {s}',
  'Llegó {s}, todo completo ✅',
  'Factura {s}',
  'Buenas, adjunto factura de {s}',
];

export function createSeed(now: IsoDateTime): DemoData {
  const today = panamaDay(now);
  const year = today.slice(0, 4);
  const day = (k: number) => addDays(today, -k);

  const d: DemoData = {
    meta: { schema: SCHEMA_VERSION, seedDay: today, seededAt: now, touched: false },
    settings: { approvalEnabled: true, approvalThresholdCents: 50000 },
    locations: structuredClone(LOCATIONS),
    users: structuredClone(USERS),
    suppliers: structuredClone(SUPPLIERS),
    products: structuredClone(PRODUCTS),
    stockSettings: {},
    recipes: seedRecipes(atPanama(day(HISTORY_DAYS + 5), 10)),
    posItems: structuredClone(POS_ITEMS).map((it) => (it.id === 'LIM' ? { ...it, since: day(LIMONADA_SINCE_DAYS) } : it)),
    posConnections: [],
    orders: [], receptions: [], movements: [], counts: [],
    salesDays: {}, tickets: [], ticketIndex: {}, syncRuns: [], undeducted: {}, posDemoQueue: [],
    documents: [], invoices: [], payments: [], waMessages: [], audit: [],
    carts: { cv: [], sf: [], ce: [] },
    seq: {
      pedido: 1000, recepcion: 2000, factura: 3000, documento: 4000, pago: 5000, movimiento: 10000,
      conteo: 100, sync: 600, transferencia: 40, evento: 20000, mensaje: 800, receta: 100, demo: 0,
    },
  };

  const products = d.products;
  const menu = d.posItems;
  const recipeById = new Map(d.recipes.map((r) => [r.id, r]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const supplierById = new Map(d.suppliers.map((s) => [s.id, s]));
  const locIds = d.locations.map((l) => l.id);

  // ── Registro de actividad reciente (se ordena y numera al final) ──
  const auditCutoff = atPanama(day(AUDIT_DAYS), 0);
  const auditBuffer: Omit<AuditEvent, 'id'>[] = [];
  const log = (
    at: IsoDateTime, by: ID, entity: AuditEntity, action: string, summary: string, entityId?: ID, locationId?: LocationId,
  ) => {
    if (at >= auditCutoff && at <= now) auditBuffer.push({ at, by, entity, action, summary, entityId, locationId });
  };

  // ── Cajas: momento de la última sincronización ──
  const lastSync: Record<LocationId, IsoDateTime> = {
    cv: addMinutes(now, -6),
    sf: businessMinutesBack(now, 190),
    ce: addMinutes(now, -11),
  };

  // ───────────────────────────── 1. Ventas ─────────────────────────────

  interface DayStat { tickets: number; items: Record<ID, [number, number]>; cons: Record<ID, number> }
  const consOf = (items: Record<ID, [number, number]>): Record<ID, number> => {
    const out: Record<ID, number> = {};
    for (const [itemId, [q]] of Object.entries(items)) {
      const it = menu.find((m) => m.id === itemId);
      if (!it || it.mapping !== 'receta') continue;
      const rec = recipeById.get(it.recipeId!);
      if (!rec) continue;
      for (const ing of rec.ingredients) out[ing.productId] = (out[ing.productId] ?? 0) + ing.qty * q;
    }
    return out;
  };

  const stats = { cv: [], sf: [], ce: [] } as Record<LocationId, DayStat[]>;
  const recent = { cv: [], sf: [], ce: [] } as Record<LocationId, SaleTicket[]>;

  for (const loc of d.locations) {
    const L = loc.id;
    for (let k = SALES_DAYS - 1; k >= 2; k--) {
      const dd = day(k);
      const n = dayTicketCount(L, dd, today);
      const items: Record<ID, [number, number]> = {};
      let revenue = 0;
      for (const it of menu) {
        if (it.since && it.since > dd) continue;
        const q = Math.round(n * (ITEM_MIX[it.id] ?? 0) * (MIX_TWEAK[L][it.id] ?? 1) * (0.93 + 0.14 * unit(`q:${L}:${dd}:${it.id}`)));
        if (q <= 0) continue;
        items[it.id] = [q, q * it.priceCents];
        revenue += q * it.priceCents;
        if (it.mapping === 'pendiente') {
          const u = (d.undeducted[stockKey(L, it.id)] ??= { locationId: L, itemId: it.id, qty: 0, revenueCents: 0, firstDay: dd, lastDay: dd });
          u.qty += q;
          u.revenueCents += q * it.priceCents;
          if (dd < u.firstDay) u.firstDay = dd;
          if (dd > u.lastDay) u.lastDay = dd;
        }
      }
      d.salesDays[`${dd}|${L}`] = { day: dd, locationId: L, tickets: n, revenueCents: revenue, items };
      stats[L][k] = { tickets: n, items, cons: consOf(items) };
    }
    // Ayer y hoy: tickets individuales, solo los que la caja ya envió.
    for (const k of [1, 0]) {
      const ts = ticketsOfDay(L, loc.code, day(k), today, menu).filter((t) => t.at <= lastSync[L]);
      recent[L].push(...ts);
      const items: Record<ID, [number, number]> = {};
      for (const t of ts) for (const l of t.lines) {
        const a = (items[l.itemId] ??= [0, 0]);
        a[0] += l.qty;
        a[1] += l.qty * l.unitPriceCents;
      }
      stats[L][k] = { tickets: ts.length, items, cons: consOf(items) };
    }
  }

  /** Consumo real de un producto que no pasa por recetas (solo se ve en los conteos). */
  const offUsage = (L: LocationId, k: number, pid: ID): number => {
    const st = stats[L][k];
    if (!st) return 0;
    if (pid === 'p-limones') return 0.5 * st.tickets + 90 * (st.items.LIM?.[0] ?? 0);
    return (OFF_RECIPE_USAGE[pid] ?? 0) * st.tickets;
  };
  const trueUse = (L: LocationId, k: number, p: Product): number =>
    p.recipeTracked ? stats[L][k]?.cons[p.id] ?? 0 : offUsage(L, k, p.id);

  const avg = { cv: {}, sf: {}, ce: {} } as Record<LocationId, Record<ID, number>>;
  for (const L of locIds) {
    for (const p of products) {
      const from = 2;
      const to = p.id === 'p-limones' ? LIMONADA_SINCE_DAYS - 1 : 29;
      let s = 0;
      for (let k = from; k <= to; k++) s += trueUse(L, k, p);
      avg[L][p.id] = s / (to - from + 1);
    }
  }

  // ───────────────────────────── 2. Mínimos y niveles objetivo ─────────────────────────────

  for (const L of locIds) {
    for (const p of products) {
      const s = supplierById.get(p.offer.supplierId)!;
      const a = avg[L][p.id];
      const pack = p.offer.pack.baseQty;
      // Mínimo: lo que se consume mientras llega un pedido, más un día de seguridad.
      const minBase = niceLevel(a * (s.leadTimeDays + 1), p.baseUnit);
      // Objetivo: cubrir hasta la siguiente entrega sin bajar del mínimo.
      const parBase = Math.max(pack, Math.ceil((a * (s.cadenceDays + s.leadTimeDays + 1.15)) / pack) * pack);
      d.stockSettings[stockKey(L, p.id)] = { minBase, parBase: Math.max(parBase, minBase) };
    }
  }

  // ───────────────────────────── 3. Inventario y compras, día a día ─────────────────────────────

  const phys = { cv: {}, sf: {}, ce: {} } as Record<LocationId, Record<ID, number>>;
  const ledger = { cv: {}, sf: {}, ce: {} } as Record<LocationId, Record<ID, number>>;

  const move = (
    L: LocationId, pid: ID, type: DemoData['movements'][number]['type'], q: number, at: IsoDateTime, by: ID,
    extra: Partial<DemoData['movements'][number]> = {},
  ) => {
    const rounded = Math.round(q * 1000) / 1000;
    d.movements.push({ id: nextId(d, 'movimiento'), at, locationId: L, productId: pid, type, qty: rounded, by, ...extra });
    ledger[L][pid] = (ledger[L][pid] ?? 0) + rounded;
  };

  const lastAgo = (s: Supplier, L: LocationId) => LAST_DELIVERY_AGO[s.id][L];
  const isDeliveryDay = (s: Supplier, L: LocationId, k: number) => k >= lastAgo(s, L) && (k - lastAgo(s, L)) % s.cadenceDays === 0;
  const firstDeliveryK = (s: Supplier, L: LocationId) => {
    let k = lastAgo(s, L);
    if (k + s.leadTimeDays > HISTORY_DAYS) return -3;
    while (k + s.cadenceDays + s.leadTimeDays <= HISTORY_DAYS) k += s.cadenceDays;
    return k;
  };

  const WASTE: { L: LocationId; k: number; pid: ID; q: number; reason: string; note?: string }[] = [
    { L: 'cv', k: 22, pid: 'p-leche', q: 2000, reason: 'Producto vencido' },
    { L: 'cv', k: 9, pid: 'p-huevos', q: 12, reason: 'Rotura o derrame', note: 'Se cayó un cartón al descargar' },
    { L: 'cv', k: 4, pid: 'p-mantequilla', q: 1000, reason: 'Producto vencido', note: 'Falla del refrigerador n.º 2' },
    { L: 'sf', k: 17, pid: 'p-naranjas', q: 4000, reason: 'Mal estado al recibir' },
    { L: 'sf', k: 6, pid: 'p-leche', q: 3000, reason: 'Rotura o derrame' },
    { L: 'ce', k: 20, pid: 'p-queso', q: 500, reason: 'Error de preparación' },
    { L: 'ce', k: 12, pid: 'p-jamon', q: 800, reason: 'Producto vencido' },
    { L: 'ce', k: 3, pid: 'p-crema', q: 1000, reason: 'Producto vencido' },
  ];
  const TRANSFERS: { k: number; from: LocationId; to: LocationId; pid: ID; q: number; note: string }[] = [
    { k: 13, from: 'ce', to: 'cv', pid: 'p-baguette', q: 20, note: 'Refuerzo para un evento privado' },
    { k: 5, from: 'cv', to: 'sf', pid: 'p-cafe', q: 3000, note: 'Préstamo hasta la próxima entrega' },
  ];

  const pending: { k: number; L: LocationId; order: PurchaseOrder }[] = [];
  const storyInvoices: Record<string, Invoice> = {};
  const storyOrders: Record<string, PurchaseOrder> = {};
  const offsetMin: Record<LocationId, number> = { cv: 0, sf: 14, ce: 27 };

  for (let k = HISTORY_DAYS; k >= 0; k--) {
    const dd = day(k);

    for (const loc of d.locations) {
      const L = loc.id;
      const mgr = loc.managerId;

      // ── Inventario inicial: sin él no se puede conocer el stock de partida ──
      if (k === HISTORY_DAYS) {
        const at = atPanama(dd, 6, offsetMin[L] % 20);
        const count: StockCount = { id: nextId(d, 'conteo'), locationId: L, at, by: mgr, kind: 'inicial', lines: [], note: 'Inventario inicial al arrancar la plataforma' };
        for (const p of products) {
          const s = supplierById.get(p.offer.supplierId)!;
          const cover = s.leadTimeDays + 1.15 + (HISTORY_DAYS - firstDeliveryK(s, L)) + 1.5 * unit(`init:${L}:${p.id}`);
          const raw = avg[L][p.id] * cover;
          const step = p.baseUnit === 'un' ? (raw > 200 ? 10 : 1) : 100;
          const init = Math.max(step, Math.round(raw / step) * step);
          phys[L][p.id] = init;
          count.lines.push({ productId: p.id, theoreticalBase: 0, countedBase: init });
          move(L, p.id, 'inventario_inicial', init, at, mgr, { refKind: 'conteo', refId: count.id, reason: 'Primer conteo del producto' });
        }
        d.counts.push(count);
      }

      // ── Conteo físico semanal ──
      if (k < HISTORY_DAYS && k % 7 === 0 && k > 0) {
        const at = atPanama(dd, 6, 10 + (offsetMin[L] % 20));
        const count: StockCount = { id: nextId(d, 'conteo'), locationId: L, at, by: mgr, kind: 'ciclico', lines: [] };
        const r = rngFrom(`count:${L}:${k}`);
        const tracked = products.filter((p) => p.recipeTracked);
        const variance = new Set([tracked[Math.floor(r() * tracked.length)].id, tracked[Math.floor(r() * tracked.length)].id]);
        const exact = tracked[Math.floor(r() * tracked.length)].id;
        let adjusted = 0;
        for (const p of products) {
          const theoretical = Math.round((ledger[L][p.id] ?? 0) * 1000) / 1000;
          let counted: number | null = null;
          if (!p.recipeTracked) {
            const step = p.baseUnit === 'un' ? 1 : 50;
            counted = Math.max(0, Math.round(phys[L][p.id] / step) * step);
          } else if (variance.has(p.id)) {
            const step = p.baseUnit === 'un' ? 1 : 50;
            counted = Math.max(0, Math.round((theoretical * (1 - between(r, 0.004, 0.02))) / step) * step);
          } else if (p.id === exact) {
            counted = theoretical;
          }
          if (counted === null) continue;
          count.lines.push({ productId: p.id, theoreticalBase: theoretical, countedBase: counted });
          const diff = Math.round((counted - theoretical) * 1000) / 1000;
          phys[L][p.id] = counted;
          if (Math.abs(diff) > 1e-6) {
            adjusted++;
            move(L, p.id, 'ajuste_conteo', diff, at, mgr, {
              refKind: 'conteo', refId: count.id,
              reason: `Teórico ${fmtQty(theoretical, p.baseUnit)} → contado ${fmtQty(counted, p.baseUnit)}`,
            });
          }
        }
        d.counts.push(count);
        log(at, mgr, 'inventario', 'inventario.conteo', `Conteo físico ${count.id} en ${loc.name}: ${count.lines.length} productos contados, ${adjusted} con ajuste`, count.id, L);
      }

      // ── Entregas del día: la recepción es lo único que da entrada al inventario ──
      const due = pending.filter((x) => x.k === k && x.L === L);
      due.forEach(({ order }, idx) => {
        const s = supplierById.get(order.supplierId)!;
        const storyPartial = L === 'ce' && s.id === 's-molinos' && k === 1;
        const receivedAt = atPanama(dd, 7, 12 + idx * 24 + Math.round(unit(`rec:${order.id}`) * 14));
        const reception: Reception = {
          id: nextId(d, 'recepcion'), orderId: order.id, locationId: L, receivedAt, receivedBy: mgr,
          lines: order.lines.map((l) => {
            const received = storyPartial && l.productId === 'p-harina' ? l.packs - 2 : l.packs;
            return {
              productId: l.productId, packsExpected: l.packs, packsReceived: received, baseQty: received * l.packBaseQty,
              issue: received < l.packs ? ('faltante' as const) : undefined,
            };
          }),
          note: storyPartial ? 'Solo llegó 1 saco de harina. El repartidor dice que el resto sale esta semana.' : undefined,
        };
        d.receptions.push(reception);
        for (const rl of reception.lines) {
          if (rl.baseQty <= 0) continue;
          move(L, rl.productId, 'recepcion', rl.baseQty, receivedAt, mgr, { refKind: 'recepcion', refId: reception.id, note: `Pedido ${order.id} · ${s.name}` });
          phys[L][rl.productId] += rl.baseQty;
        }
        order.status = storyPartial ? 'recibido_parcial' : 'recibido';
        if (storyPartial) storyOrders.partial = order;
        log(
          receivedAt, mgr, 'recepcion', storyPartial ? 'recepcion.parcial' : 'recepcion.completa',
          storyPartial
            ? `Recepción ${reception.id} parcial del pedido ${order.id}: faltan 2 sacos de Harina de trigo`
            : `Recepción ${reception.id} completa del pedido ${order.id}`,
          reception.id, L,
        );
        if (storyPartial) return; // la factura todavía no ha llegado

        // Factura del proveedor: llega como foto por WhatsApp (simulado) desde el gerente.
        const priceStory = L === 'cv' && s.id === 's-baru' && k === 2;
        const invLines: InvoiceLine[] = reception.lines.filter((rl) => rl.packsReceived > 0).map((rl) => {
          const ol = order.lines.find((x) => x.productId === rl.productId)!;
          const p = productById.get(rl.productId)!;
          return {
            productId: rl.productId,
            description: `${p.name} · ${ol.packLabel}`,
            packs: rl.packsReceived,
            unitPriceCents: priceStory && rl.productId === 'p-cafe' ? 12400 : ol.unitPriceCents,
            taxRate: ol.taxRate,
          };
        });
        const totals = linesTotals(invLines);
        const number = nextSupplierInvoiceNumber(d, s.id, year);
        const dueDate = addDays(dd, s.paymentTermsDays);
        const printsDue = PRINTS_DUE_DATE.includes(s.id);
        const printsRef = PRINTS_ORDER_REF.includes(s.id);
        const printed: PrintedInvoice = {
          supplierId: s.id, number, issueDate: dd, dueDate: printsDue ? dueDate : undefined,
          orderRef: printsRef ? order.id : undefined, lines: invLines, ...totals,
        };
        const unprocessedStory = L === 'ce' && s.id === 's-azuero' && k === 1;
        const docAt = unprocessedStory ? addMinutes(now, -25) : addMinutes(receivedAt, 25 + Math.round(unit(`doc:${number}`) * 70));
        const doc: SourceDocument = {
          id: nextId(d, 'documento'), channel: 'whatsapp', senderId: mgr, locationId: L, receivedAt: docAt,
          fileName: `IMG-${dd.replace(/-/g, '')}-WA${String(1000 + Math.floor(unit(`f:${number}`) * 9000))}.jpg`,
          fingerprint: `seed:${number}:${L}`, kind: 'ejemplo', status: 'procesado', printed,
          caption: CAPTIONS[Math.floor(unit(`cap:${number}`) * CAPTIONS.length)].replace('{s}', s.short),
        };
        d.documents.push(doc);
        log(docAt, mgr, 'documento', 'documento.recibido', `Documento ${doc.id} recibido por WhatsApp (simulado) · ${loc.name}`, doc.id, L);
        if (unprocessedStory) {
          doc.status = 'recibido';
          doc.caption = 'Factura de Huerta Azuero de ayer, se me había pasado';
          doc.hints = { lowConfidence: ['number'] };
          return;
        }

        const inv: Invoice = {
          id: nextId(d, 'factura'), documentId: doc.id, status: 'validada', receivedAt: docAt, locationId: L,
          supplierId: s.id, number, issueDate: dd, dueDate, dueDateSource: printsDue ? 'documento' : 'propuesta',
          dueDateConfirmed: true, ...totals, lines: invLines.map((x) => ({ ...x })),
          confidence: { supplierId: 0.99, number: 0.98, issueDate: 0.98, dueDate: 0.97, locationId: 0.99, subtotalCents: 0.98, taxCents: 0.97, totalCents: 0.99 },
          corrections: [], orderId: order.id, orderMatch: printsRef ? 'referencia' : 'sugerido',
        };
        doc.invoiceId = inv.id;
        d.invoices.push(inv);

        if (priceStory) {
          // Guion: diferencia de precio pendiente de revisar.
          inv.status = 'por_revisar';
          storyInvoices.price = inv;
          return;
        }
        if (L === 'sf' && s.id === 's-azuero' && k === 4) {
          // Guion: factura en disputa.
          inv.status = 'en_disputa';
          const openedAt = atPanama(day(3), 10, 20);
          inv.dispute = { reason: 'Una malla de naranjas llegó en mal estado. Nota de crédito solicitada al proveedor.', amountCents: 1800, openedBy: 'u-rosa', openedAt };
          log(openedAt, 'u-rosa', 'factura', 'factura.en_disputa', `Factura ${number} en disputa por ${money(1800)} · naranjas en mal estado`, inv.id, L);
          storyInvoices.dispute = inv;
          return;
        }
        const validatedAt = addMinutes(docAt, 95 + Math.round(unit(`val:${number}`) * 240));
        inv.validatedBy = 'u-rosa';
        inv.validatedAt = validatedAt;
        log(validatedAt, 'u-rosa', 'factura', 'factura.validada', `Factura ${number} de ${s.name} validada · ${money(inv.totalCents)} · vence el ${fmtDate(dueDate)}`, inv.id, L);

        const overdueStory = L === 'ce' && s.id === 's-pradera' && k === 19;
        const partialStory = L === 'cv' && s.id === 's-molinos' && k === 12;
        if (overdueStory) {
          storyInvoices.overdue = inv; // validada y sin pagar: vencida
        } else if (partialStory) {
          const amount = Math.max(5000, Math.round((inv.totalCents * 0.45) / 5000) * 5000);
          const payDay = day(3);
          d.payments.push({
            id: nextId(d, 'pago'), invoiceId: inv.id, date: payDay, amountCents: amount, method: 'ach',
            reference: paymentReference('ach', number), by: 'u-rosa', createdAt: atPanama(payDay, 11, 5),
          });
          inv.status = 'parcialmente_pagada';
          log(atPanama(payDay, 11, 5), 'u-rosa', 'pago', 'pago.parcial', `Pago de ${money(amount)} a ${s.name} (factura ${number}) · saldo pendiente ${money(inv.totalCents - amount)}`, inv.id, L);
          storyInvoices.partial = inv;
        } else if (dueDate <= day(1)) {
          const method = PAY_METHOD[s.id];
          const createdAt = atPanama(dueDate, 10, 15 + Math.round(unit(`pay:${number}`) * 40));
          d.payments.push({
            id: nextId(d, 'pago'), invoiceId: inv.id, date: dueDate, amountCents: inv.totalCents, method,
            reference: paymentReference(method, number), by: 'u-rosa', createdAt,
          });
          inv.status = 'pagada';
          log(createdAt, 'u-rosa', 'pago', 'pago.total', `Pago de ${money(inv.totalCents)} a ${s.name} (factura ${number}) · factura saldada`, inv.id, L);
        }
      });

      // ── Mermas ──
      for (const w of WASTE) {
        if (w.L !== L || w.k !== k) continue;
        const p = productById.get(w.pid)!;
        const at = atPanama(dd, 14, 20 + (offsetMin[L] % 30));
        move(L, w.pid, 'merma', -w.q, at, mgr, { reason: w.reason, note: w.note });
        phys[L][w.pid] -= w.q;
        log(at, mgr, 'inventario', 'inventario.merma', `Merma de ${fmtQty(w.q, p.baseUnit)} de ${p.name} en ${loc.name} · ${w.reason}`, p.id, L);
      }

      // ── Pedidos del día (se entregarán `leadTimeDays` después) ──
      if (k < HISTORY_DAYS) {
        d.suppliers.forEach((s, si) => {
          const kd = k - s.leadTimeDays;
          if (kd < 1 || !isDeliveryDay(s, L, kd)) return;
          const r = rngFrom(`ord:${L}:${s.id}:${k}`);
          const lines: OrderLine[] = [];
          for (const p of products) {
            if (p.offer.supplierId !== s.id) continue;
            const pack = p.offer.pack.baseQty;
            let projected = phys[L][p.id];
            for (let j = 0; j < s.leadTimeDays; j++) projected -= trueUse(L, k - j, p);
            const par = d.stockSettings[stockKey(L, p.id)].parBase;
            const need = (par - projected) * between(r, 0.96, 1.05);
            let packs = need >= 0.35 * pack ? Math.ceil(need / pack - 0.02) : 0;

            // Guion: en San Francisco, el último pedido de leche se quedó corto → riesgo de quiebre hoy.
            if (L === 'sf' && p.id === 'p-leche' && kd === 3) {
              let after = 0;
              for (let j = 3; j >= 0; j--) after += trueUse(L, j, p);
              packs = Math.max(1, Math.ceil((10000 + after - projected) / pack));
            }
            // Guion: pedido de harina que llegará incompleto en Costa del Este.
            if (L === 'ce' && p.id === 'p-harina' && kd === 1) packs = Math.max(packs, 3);

            if (packs > 0) {
              lines.push({ productId: p.id, packs, packBaseQty: pack, packLabel: p.offer.pack.label, unitPriceCents: p.offer.priceCents, taxRate: p.offer.taxRate });
            }
          }
          if (lines.length === 0) return;
          const createdAt = atPanama(dd, 15, 5 + offsetMin[L] + si * 3);
          const totals = linesTotals(lines);
          const requiresApproval = totals.totalCents > d.settings.approvalThresholdCents;
          const order: PurchaseOrder = {
            id: nextId(d, 'pedido'), locationId: L, supplierId: s.id, status: 'confirmado', lines, createdAt, createdBy: mgr,
            requestedDelivery: day(kd), origin: 'historico', requiresApproval,
            approvedBy: requiresApproval ? 'u-antoine' : SYSTEM_USER,
            approvedAt: addMinutes(createdAt, requiresApproval ? 38 : 0),
            sentAt: addMinutes(createdAt, requiresApproval ? 41 : 4),
            confirmedAt: addMinutes(createdAt, requiresApproval ? 76 : 33),
          };
          d.orders.push(order);
          pending.push({ k: kd, L, order });
          log(createdAt, mgr, 'pedido', 'pedido.creado', `Pedido ${order.id} a ${s.name} para ${loc.name} ${requiresApproval ? `enviado a aprobación (supera ${money(d.settings.approvalThresholdCents)})` : 'creado (aprobación automática: bajo el umbral)'} · ${money(totals.totalCents)}`, order.id, L);
          if (requiresApproval) log(order.approvedAt!, 'u-antoine', 'pedido', 'pedido.aprobado', `Pedido ${order.id} aprobado por Antoine · ${money(totals.totalCents)}`, order.id, L);
          log(order.sentAt!, requiresApproval ? 'u-antoine' : mgr, 'pedido', 'pedido.enviado', `Pedido ${order.id} enviado a ${s.name} por WhatsApp (simulado)`, order.id, L);
        });
      }

      // ── Guion: pedido cancelado y borrador ──
      if (L === 'ce' && k === 6) {
        const createdAt = atPanama(dd, 10, 12);
        const cancelled: PurchaseOrder = {
          id: nextId(d, 'pedido'), locationId: 'ce', supplierId: 's-pacifico', status: 'cancelado', createdAt, createdBy: mgr,
          requestedDelivery: day(3), origin: 'manual', requiresApproval: false, approvedBy: SYSTEM_USER, approvedAt: createdAt,
          sentAt: addMinutes(createdAt, 5), cancelledAt: addMinutes(createdAt, 88), cancelledBy: mgr, cancelReason: 'Pedido duplicado por error',
          lines: [orderLine(productById.get('p-detergente')!, 2), orderLine(productById.get('p-guantes')!, 4)],
        };
        d.orders.push(cancelled);
        log(cancelled.cancelledAt!, mgr, 'pedido', 'pedido.cancelado', `Pedido ${cancelled.id} cancelado · Pedido duplicado por error`, cancelled.id, 'ce');
      }
      if (L === 'cv' && k === 1) {
        const createdAt = atPanama(dd, 16, 5);
        const draft: PurchaseOrder = {
          id: nextId(d, 'pedido'), locationId: 'cv', supplierId: 's-canal', status: 'borrador', createdAt, createdBy: mgr,
          requestedDelivery: day(-3), origin: 'manual', requiresApproval: false,
          lines: [orderLine(productById.get('p-vaso12')!, 2), orderLine(productById.get('p-tapa12')!, 2), orderLine(productById.get('p-bolsa')!, 1)],
        };
        d.orders.push(draft);
        log(createdAt, mgr, 'pedido', 'pedido.creado', `Pedido ${draft.id} a Empaques Canal para Casco Viejo guardado como borrador · ${money(orderTotals(draft).totalCents)}`, draft.id, 'cv');
      }

      // ── Consumo del día ──
      for (const p of products) {
        const use = trueUse(L, k, p);
        if (use <= 0) continue;
        phys[L][p.id] -= use;
        // Días completos: un movimiento por producto y día. Ayer y hoy se registran al importar los tickets.
        if (p.recipeTracked && k >= 2) {
          move(L, p.id, 'venta', -use, atPanama(dd, 20, 5), SYSTEM_USER, { refKind: 'ventas_dia', refId: `${dd}|${L}`, note: `${stats[L][k].tickets} tickets` });
        }
      }
    }

    // ── Transferencias entre locales ──
    for (const t of TRANSFERS) {
      if (t.k !== k) continue;
      const p = productById.get(t.pid)!;
      const id = nextId(d, 'transferencia');
      const at = atPanama(dd, 16, 30);
      const from = d.locations.find((l) => l.id === t.from)!;
      const to = d.locations.find((l) => l.id === t.to)!;
      move(t.from, t.pid, 'transferencia_salida', -t.q, at, from.managerId, { refKind: 'transferencia', refId: id, reason: `Hacia ${to.name}`, note: t.note });
      move(t.to, t.pid, 'transferencia_entrada', t.q, at, from.managerId, { refKind: 'transferencia', refId: id, reason: `Desde ${from.name}`, note: t.note });
      phys[t.from][t.pid] -= t.q;
      phys[t.to][t.pid] += t.q;
      log(at, from.managerId, 'inventario', 'inventario.transferencia', `Transferencia ${id}: ${fmtQty(t.q, p.baseUnit)} de ${p.name} de ${from.name} a ${to.name}`, id, t.from);
    }
  }

  function orderLine(p: Product, packs: number): OrderLine {
    return { productId: p.id, packs, packBaseQty: p.offer.pack.baseQty, packLabel: p.offer.pack.label, unitPriceCents: p.offer.priceCents, taxRate: p.offer.taxRate };
  }
  const P = (id: ID) => productById.get(id)!;

  // ───────────────────────────── 4. Situaciones del guion ─────────────────────────────

  // Posible duplicado: el gerente reenvía la misma factura de Empaques Canal.
  const canalSf = d.invoices.find((i) => i.supplierId === 's-canal' && i.locationId === 'sf');
  if (canalSf) {
    const original = d.documents.find((x) => x.id === canalSf.documentId)!;
    const at = atPanama(day(1), 16, 42);
    const doc: SourceDocument = {
      ...structuredClone(original), id: nextId(d, 'documento'), receivedAt: at, status: 'procesado',
      fileName: `IMG-${day(1).replace(/-/g, '')}-WA7731.jpg`, fingerprint: `seed:${canalSf.number}:sf:reenvio`,
      caption: 'Reenvío la de Empaques Canal, creo que no la había mandado',
    };
    const dup: Invoice = {
      ...structuredClone(canalSf), id: nextId(d, 'factura'), documentId: doc.id, status: 'por_revisar', receivedAt: at,
      validatedBy: undefined, validatedAt: undefined, corrections: [],
    };
    doc.invoiceId = dup.id;
    d.documents.push(doc);
    d.invoices.push(dup);
    log(at, 'u-luis', 'documento', 'documento.recibido', `Documento ${doc.id} recibido por WhatsApp (simulado) · San Francisco`, doc.id, 'sf');
    storyInvoices.duplicate = dup;
  }

  // Factura sin pedido: compra urgente hecha fuera de la plataforma.
  {
    const s = supplierById.get('s-pacifico')!;
    const at = atPanama(day(1), 17, 20);
    const lines: InvoiceLine[] = [
      { productId: 'p-desinfectante', description: `${P('p-desinfectante').name} · Garrafa 5 L`, packs: 2, unitPriceCents: P('p-desinfectante').offer.priceCents, taxRate: 0.07 },
      { productId: 'p-guantes', description: `${P('p-guantes').name} · Caja 100 un`, packs: 3, unitPriceCents: P('p-guantes').offer.priceCents, taxRate: 0.07 },
    ];
    const totals = linesTotals(lines);
    const number = nextSupplierInvoiceNumber(d, s.id, year);
    const dueDate = addDays(day(1), s.paymentTermsDays);
    const doc: SourceDocument = {
      id: nextId(d, 'documento'), channel: 'whatsapp', senderId: 'u-mariela', locationId: 'cv', receivedAt: at,
      fileName: `IMG-${day(1).replace(/-/g, '')}-WA5512.jpg`, fingerprint: `seed:${number}:cv`, kind: 'ejemplo', status: 'procesado',
      printed: { supplierId: s.id, number, issueDate: day(1), dueDate, lines, ...totals },
      caption: 'Compra urgente de limpieza, no dio tiempo de hacer pedido',
    };
    const inv: Invoice = {
      id: nextId(d, 'factura'), documentId: doc.id, status: 'por_revisar', receivedAt: at, locationId: 'cv', supplierId: s.id,
      number, issueDate: day(1), dueDate, dueDateSource: 'documento', dueDateConfirmed: true, ...totals, lines: lines.map((x) => ({ ...x })),
      confidence: { supplierId: 0.98, number: 0.97, issueDate: 0.98, dueDate: 0.96, locationId: 0.99, subtotalCents: 0.98, taxCents: 0.97, totalCents: 0.98 },
      corrections: [],
    };
    doc.invoiceId = inv.id;
    d.documents.push(doc);
    d.invoices.push(inv);
    log(at, 'u-mariela', 'documento', 'documento.recibido', `Documento ${doc.id} recibido por WhatsApp (simulado) · Casco Viejo`, doc.id, 'cv');
    storyInvoices.noOrder = inv;
  }

  // Pedidos en curso con distintos estados.
  const pushMsg = (order: PurchaseOrder, direction: 'out' | 'in', at: IsoDateTime, body: string) => {
    d.waMessages.push({ id: nextId(d, 'mensaje'), threadId: order.supplierId, direction, at, body, orderId: order.id, status: direction === 'out' ? 'entregado' : 'leido', simulated: true });
  };
  {
    // Confirmado, entrega mañana (Casco Viejo ← La Pradera).
    const createdAt = addMinutes(now, -182);
    const o: PurchaseOrder = {
      id: nextId(d, 'pedido'), locationId: 'cv', supplierId: 's-pradera', status: 'confirmado', createdAt, createdBy: 'u-mariela',
      requestedDelivery: day(-1), origin: 'sugerencia', requiresApproval: false, approvedBy: SYSTEM_USER, approvedAt: createdAt,
      sentAt: addMinutes(createdAt, 6), confirmedAt: addMinutes(createdAt, 31),
      lines: [orderLine(P('p-leche'), 8), orderLine(P('p-mantequilla'), 2), orderLine(P('p-queso'), 7), orderLine(P('p-crema'), 1)],
    };
    d.orders.push(o);
    pushMsg(o, 'out', o.sentAt!, composeOrderMessage(d, o));
    pushMsg(o, 'in', o.confirmedAt!, composeSupplierReply(d, o));
    log(createdAt, 'u-mariela', 'pedido', 'pedido.creado', `Pedido ${o.id} a Lácteos La Pradera para Casco Viejo creado (aprobación automática: bajo el umbral) · ${money(orderTotals(o).totalCents)}`, o.id, 'cv');
    log(o.confirmedAt!, 's-pradera', 'pedido', 'pedido.confirmado', `Lácteos La Pradera confirmó el pedido ${o.id} (respuesta simulada)`, o.id, 'cv');
    storyOrders.confirmed = o;
  }
  {
    // Aprobado, por enviar (San Francisco ← Molinos).
    const createdAt = addMinutes(now, -125);
    const o: PurchaseOrder = {
      id: nextId(d, 'pedido'), locationId: 'sf', supplierId: 's-molinos', status: 'aprobado', createdAt, createdBy: 'u-luis',
      requestedDelivery: day(-4), origin: 'manual', requiresApproval: false, approvedBy: SYSTEM_USER, approvedAt: createdAt,
      lines: [orderLine(P('p-harina'), 2), orderLine(P('p-baguette'), 6), orderLine(P('p-levadura'), 3)],
    };
    d.orders.push(o);
    log(createdAt, 'u-luis', 'pedido', 'pedido.creado', `Pedido ${o.id} a Molinos del Istmo para San Francisco creado (aprobación automática: bajo el umbral) · ${money(orderTotals(o).totalCents)}`, o.id, 'sf');
    storyOrders.approved = o;
  }
  {
    // Pendiente de aprobación: supera el umbral (Costa del Este ← Tostadores del Barú).
    const createdAt = addMinutes(now, -70);
    const o: PurchaseOrder = {
      id: nextId(d, 'pedido'), locationId: 'ce', supplierId: 's-baru', status: 'pendiente_aprobacion', createdAt, createdBy: 'u-daniela',
      requestedDelivery: day(-2), origin: 'sugerencia', requiresApproval: true, note: 'Semana de eventos corporativos en la plaza.',
      lines: [orderLine(P('p-cafe'), 5), orderLine(P('p-cacao'), 3)],
    };
    d.orders.push(o);
    log(createdAt, 'u-daniela', 'pedido', 'pedido.creado', `Pedido ${o.id} a Tostadores del Barú para Costa del Este enviado a aprobación (supera ${money(d.settings.approvalThresholdCents)}) · ${money(orderTotals(o).totalCents)}`, o.id, 'ce');
    storyOrders.pendingApproval = o;
  }
  {
    // Enviado, a la espera de confirmación (San Francisco ← Huerta Azuero).
    const createdAt = addMinutes(now, -52);
    const o: PurchaseOrder = {
      id: nextId(d, 'pedido'), locationId: 'sf', supplierId: 's-azuero', status: 'enviado', createdAt, createdBy: 'u-luis',
      requestedDelivery: day(-2), origin: 'sugerencia', requiresApproval: false, approvedBy: SYSTEM_USER, approvedAt: createdAt,
      sentAt: addMinutes(createdAt, 12),
      lines: [orderLine(P('p-huevos'), 4), orderLine(P('p-naranjas'), 3), orderLine(P('p-jamon'), 8)],
    };
    d.orders.push(o);
    pushMsg(o, 'out', o.sentAt!, composeOrderMessage(d, o));
    log(createdAt, 'u-luis', 'pedido', 'pedido.creado', `Pedido ${o.id} a Huerta Azuero para San Francisco creado (aprobación automática: bajo el umbral) · ${money(orderTotals(o).totalCents)}`, o.id, 'sf');
    log(o.sentAt!, 'u-luis', 'pedido', 'pedido.enviado', `Pedido ${o.id} enviado a Huerta Azuero por WhatsApp (simulado)`, o.id, 'sf');
    storyOrders.sent = o;
  }

  // ───────────────────────────── 5. Cajas y ventas recientes ─────────────────────────────

  d.posConnections = d.locations.map((l) => ({
    id: `caja-${l.id}`, locationId: l.id, label: 'Caja principal', status: 'conectado' as const,
    lastSyncAt: atPanama(day(2), 20, 5), lastSeq: 0, autoSync: true,
  }));
  for (const loc of d.locations) {
    const L = loc.id;
    const runTimes = [atPanama(day(1), 20, 5), ...[9.5, 12.5, 15.5, 18.5].map((h) => atPanama(today, Math.floor(h), 30))]
      .filter((t) => t < lastSync[L])
      .concat(lastSync[L]);
    let prev = '';
    for (const t of runTimes) {
      const batch = recent[L].filter((x) => x.at > prev && x.at <= t);
      prev = t;
      importTickets(d, { now: t, userId: SYSTEM_USER }, L, batch, 'auto');
    }
  }
  // La caja de San Francisco dejó de enviar ventas: necesita una sincronización manual.
  const sfConn = d.posConnections.find((c) => c.locationId === 'sf')!;
  sfConn.status = 'requiere_sync';
  sfConn.autoSync = false;
  sfConn.issue = 'La caja dejó de enviar ventas. El conector necesita volver a iniciar sesión.';
  sfConn.lastSyncAt = lastSync.sf;

  // ───────────────────────────── 6. Registro de actividad ─────────────────────────────

  const fromImports = d.audit.splice(0).map(({ id: _id, ...rest }) => rest);
  for (const ev of [...auditBuffer, ...fromImports].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))) {
    d.audit.push({ id: nextId(d, 'evento'), ...ev });
  }

  d.meta.touched = false;
  return d;
}

/** Texto corto para describir líneas de pedido (mensajes y registro). */
export function describeLines(d: DemoData, lines: OrderLine[]): string {
  return lines
    .map((l) => {
      const p = d.products.find((x) => x.id === l.productId)!;
      return `${fmtPacks(l.packs, p.offer.pack)} de ${p.name}`;
    })
    .join(', ');
}
