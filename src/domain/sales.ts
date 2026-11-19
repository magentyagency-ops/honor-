import type { Ctx, DemoData, ID, LocationId, SaleTicket, SyncRun } from './types';
import { DomainError } from './types';
import { audit, locationOf, nextId, posItemOf, recipeOf, requireUser, stockKey } from './core';
import { addDays, fmtDate, panamaDay } from './time';
import { round } from './format';

/** Cuántos días de tickets individuales se conservan (el resto queda como totales diarios). */
const TICKET_RETENTION_DAYS = 1;

/**
 * Importa tickets de una caja.
 *
 * Garantías:
 *  · Idempotencia: cada ticket tiene un identificador único de caja; si ya se importó, se omite.
 *    Volver a sincronizar la misma ventana nunca duplica ventas ni descuentos de inventario.
 *  · El inventario se descuenta según la receta asociada al artículo, en el local del ticket.
 *  · Un artículo sin receta NO descuenta nada: se registra el ingreso y queda como anomalía a resolver.
 */
export function importTickets(
  d: DemoData,
  ctx: Ctx,
  locationId: LocationId,
  tickets: SaleTicket[],
  trigger: SyncRun['trigger'],
): SyncRun {
  const conn = d.posConnections.find((c) => c.locationId === locationId);
  if (!conn) throw new DomainError('Este local no tiene una caja configurada.');

  const run: SyncRun = {
    id: nextId(d, 'sync'),
    locationId,
    at: ctx.now,
    trigger,
    fetched: tickets.length,
    imported: 0,
    duplicates: 0,
    revenueCents: 0,
    itemsSold: {},
    consumption: [],
    unmapped: {},
    by: trigger === 'auto' ? 'sistema' : ctx.userId,
  };

  const consumption = new Map<ID, number>();

  for (const t of tickets) {
    if (t.locationId !== locationId) continue;
    if (d.ticketIndex[t.id]) {
      run.duplicates++;
      continue;
    }
    d.ticketIndex[t.id] = 1;
    d.tickets.push({ ...t, syncId: run.id });
    run.imported++;
    run.revenueCents += t.totalCents;

    const day = panamaDay(t.at);
    const key = `${day}|${locationId}`;
    const sd = (d.salesDays[key] ??= { day, locationId, tickets: 0, revenueCents: 0, items: {} });
    sd.tickets++;
    sd.revenueCents += t.totalCents;

    for (const line of t.lines) {
      const lineRevenue = line.qty * line.unitPriceCents;
      const agg = (sd.items[line.itemId] ??= [0, 0]);
      agg[0] += line.qty;
      agg[1] += lineRevenue;
      run.itemsSold[line.itemId] = (run.itemsSold[line.itemId] ?? 0) + line.qty;

      const item = posItemOf(d, line.itemId);
      if (!item || item.mapping === 'pendiente') {
        run.unmapped[line.itemId] = (run.unmapped[line.itemId] ?? 0) + line.qty;
        const uk = stockKey(locationId, line.itemId);
        const u = (d.undeducted[uk] ??= { locationId, itemId: line.itemId, qty: 0, revenueCents: 0, firstDay: day, lastDay: day });
        u.qty += line.qty;
        u.revenueCents += lineRevenue;
        if (day < u.firstDay) u.firstDay = day;
        if (day > u.lastDay) u.lastDay = day;
        continue;
      }
      if (item.mapping === 'sin_impacto') continue;
      const recipe = recipeOf(d, item.recipeId);
      if (!recipe) continue;
      for (const ing of recipe.ingredients) {
        consumption.set(ing.productId, (consumption.get(ing.productId) ?? 0) + ing.qty * line.qty);
      }
    }
  }

  for (const [productId, q] of consumption) {
    const qtyBase = round(q, 3);
    run.consumption.push({ productId, qty: qtyBase });
    d.movements.push({
      id: nextId(d, 'movimiento'),
      at: ctx.now,
      locationId,
      productId,
      type: 'venta',
      qty: -qtyBase,
      refKind: 'sync',
      refId: run.id,
      note: `${run.imported} tickets`,
      by: 'sistema',
    });
  }

  conn.lastSyncAt = ctx.now;
  conn.status = 'conectado';
  conn.autoSync = true;
  delete conn.issue;
  for (const t of tickets) {
    const seq = Number(t.id.split('-')[1]);
    if (Number.isFinite(seq) && seq > conn.lastSeq) conn.lastSeq = seq;
  }

  // Los tickets antiguos se conservan solo como totales diarios; su identificador sigue en el índice.
  const keepFrom = addDays(panamaDay(ctx.now), -TICKET_RETENTION_DAYS);
  if (d.tickets.length > 0 && panamaDay(d.tickets[0].at) < keepFrom) {
    d.tickets = d.tickets.filter((t) => panamaDay(t.at) >= keepFrom);
  }

  d.syncRuns.push(run);
  if (d.syncRuns.length > 120) d.syncRuns.splice(0, d.syncRuns.length - 120);

  if (trigger === 'manual' || run.imported > 0) {
    audit(
      d, ctx, 'caja', 'caja.sincronizada',
      `Sincronización ${trigger === 'auto' ? 'automática' : 'manual'} de ${locationOf(d, locationId).name}: ${run.imported} tickets nuevos` +
        (run.duplicates > 0 ? `, ${run.duplicates} ya importados (omitidos)` : ''),
      { entityId: run.id, locationId, by: run.by },
    );
  }
  if (trigger === 'manual') d.meta.touched = true;
  return run;
}

/**
 * Asocia un artículo de caja a una receta (o lo marca sin impacto en inventario).
 * Si hay ventas pendientes de descontar, se pueden regularizar: queda un movimiento explícito y trazable.
 */
export function mapPosItem(
  d: DemoData,
  ctx: Ctx,
  itemId: ID,
  mapping: { kind: 'receta'; recipeId: ID } | { kind: 'sin_impacto' },
  applyRetroactive: boolean,
): void {
  const user = requireUser(d, ctx);
  if (user.role === 'contabilidad') throw new DomainError('Contabilidad no modifica las correspondencias de caja.');
  const item = posItemOf(d, itemId);
  if (!item) throw new DomainError('Artículo de caja desconocido.');

  if (mapping.kind === 'receta') {
    const recipe = recipeOf(d, mapping.recipeId);
    if (!recipe) throw new DomainError('Receta desconocida.');
    item.mapping = 'receta';
    item.recipeId = recipe.id;
    let regularized = 0;
    for (const [key, u] of Object.entries(d.undeducted)) {
      if (u.itemId !== itemId) continue;
      if (applyRetroactive && u.qty > 0) {
        for (const ing of recipe.ingredients) {
          d.movements.push({
            id: nextId(d, 'movimiento'), at: ctx.now, locationId: u.locationId, productId: ing.productId,
            type: 'venta', qty: -round(ing.qty * u.qty, 3), refKind: 'regularizacion', refId: itemId,
            reason: `Regularización: ${u.qty} ventas de «${item.name}» del ${fmtDate(u.firstDay)} al ${fmtDate(u.lastDay)}`,
            by: ctx.userId,
          });
        }
        regularized += u.qty;
      }
      delete d.undeducted[key];
    }
    audit(
      d, ctx, 'caja', 'caja.correspondencia',
      `Artículo de caja «${item.name}» asociado a la receta «${recipe.name}»` +
        (regularized > 0 ? ` · ${regularized} ventas anteriores regularizadas en inventario` : ''),
      { entityId: itemId },
    );
    return;
  }

  item.mapping = 'sin_impacto';
  delete item.recipeId;
  for (const [key, u] of Object.entries(d.undeducted)) {
    if (u.itemId === itemId) delete d.undeducted[key];
  }
  audit(d, ctx, 'caja', 'caja.correspondencia', `Artículo de caja «${item.name}» marcado sin impacto en inventario`, { entityId: itemId });
}

/** Consumo teórico de una lista de artículos vendidos (para explicar una sincronización). */
export function explainConsumption(
  d: DemoData,
  itemsSold: Record<ID, number>,
): { itemId: ID; qty: number; recipeName?: string; ingredients: { productId: ID; perUnit: number; total: number }[] }[] {
  return Object.entries(itemsSold)
    .map(([itemId, qty]) => {
      const item = posItemOf(d, itemId);
      const recipe = item?.mapping === 'receta' ? recipeOf(d, item.recipeId) : undefined;
      return {
        itemId,
        qty,
        recipeName: recipe?.name,
        ingredients: (recipe?.ingredients ?? []).map((ing) => ({ productId: ing.productId, perUnit: ing.qty, total: round(ing.qty * qty, 3) })),
      };
    })
    .sort((a, b) => b.qty - a.qty);
}

/**
 * Herramienta de demostración: teclea una venta en la caja simulada.
 * No toca ventas ni inventario: la venta queda «en la caja» hasta la siguiente sincronización.
 */
export function queueDemoSale(d: DemoData, ctx: Ctx, locationId: LocationId, lines: { itemId: ID; qty: number }[]): SaleTicket {
  const loc = locationOf(d, locationId);
  const clean = lines.filter((l) => l.qty > 0);
  if (clean.length === 0) throw new DomainError('Indica al menos un artículo vendido.');
  const n = (d.seq.demo ?? 0) + 1;
  d.seq.demo = n;
  const tl = clean.map((l) => {
    const item = posItemOf(d, l.itemId);
    if (!item) throw new DomainError('Artículo de caja desconocido.');
    return { itemId: item.id, qty: Math.round(l.qty), unitPriceCents: item.priceCents };
  });
  const t: SaleTicket = {
    id: `${loc.code}-D${String(n).padStart(3, '0')}`, locationId, at: ctx.now, lines: tl,
    totalCents: tl.reduce((s, l) => s + l.qty * l.unitPriceCents, 0),
  };
  d.posDemoQueue.push(t);
  d.meta.touched = true;
  return t;
}
