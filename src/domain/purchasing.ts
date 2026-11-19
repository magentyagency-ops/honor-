import type {
  CartLine, Cents, Ctx, DayStr, DemoData, ID, LocationId, OrderLine, OrderStatus, PurchaseOrder,
  Reception, ReceptionIssue, ReceptionLine, Settings, User, WaMessage,
} from './types';
import { DomainError } from './types';
import {
  audit, groupBy, linesTotals, locationOf, nextId, orderOf, orderTotals, productOf, receivedPacks,
  requireUser, supplierOf, userName,
} from './core';
import { addDays, fmtDayLong, fmtDate, panamaDay } from './time';
import { money, packs as fmtPacks } from './format';

// ───────────────────────────── Estados ─────────────────────────────

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  borrador: 'Borrador',
  pendiente_aprobacion: 'Pendiente de aprobación',
  aprobado: 'Aprobado · por enviar',
  enviado: 'Enviado',
  confirmado: 'Confirmado',
  recibido_parcial: 'Recibido parcialmente',
  recibido: 'Recibido',
  cancelado: 'Cancelado',
};

/** Pedidos que comprometen compra pero aún no han entrado (del todo) en inventario. */
export const OPEN_STATUSES: OrderStatus[] = ['aprobado', 'enviado', 'confirmado', 'recibido_parcial'];

export function isOpenOrder(o: PurchaseOrder): boolean {
  return OPEN_STATUSES.includes(o.status);
}

export function canReceive(o: PurchaseOrder): boolean {
  return o.status === 'enviado' || o.status === 'confirmado' || o.status === 'recibido_parcial';
}

export function canCancel(o: PurchaseOrder): boolean {
  return ['borrador', 'pendiente_aprobacion', 'aprobado', 'enviado', 'confirmado'].includes(o.status);
}

export function canEditLines(o: PurchaseOrder): boolean {
  return o.status === 'borrador' || o.status === 'pendiente_aprobacion';
}

// ───────────────────────────── Regla de aprobación ─────────────────────────────

/** Por encima del umbral, un pedido creado por alguien que no es Dirección requiere su aprobación. */
export function needsApproval(settings: Settings, totalCents: Cents, user: User): boolean {
  if (!settings.approvalEnabled) return false;
  if (user.role === 'direccion') return false;
  return totalCents > settings.approvalThresholdCents;
}

export function setApprovalRule(d: DemoData, ctx: Ctx, rule: Partial<Settings>): void {
  const user = requireUser(d, ctx);
  if (user.role !== 'direccion') throw new DomainError('Solo Dirección puede cambiar la regla de aprobación.');
  if (rule.approvalThresholdCents !== undefined) {
    if (!(rule.approvalThresholdCents >= 0)) throw new DomainError('El umbral debe ser un importe válido.');
    d.settings.approvalThresholdCents = Math.round(rule.approvalThresholdCents);
  }
  if (rule.approvalEnabled !== undefined) d.settings.approvalEnabled = rule.approvalEnabled;
  audit(
    d, ctx, 'configuracion', 'regla_aprobacion',
    d.settings.approvalEnabled
      ? `Regla de aprobación: los pedidos de más de ${money(d.settings.approvalThresholdCents)} requieren aprobación de Dirección`
      : 'Regla de aprobación desactivada',
  );
}

// ───────────────────────────── Carrito ─────────────────────────────

export function setCartQty(d: DemoData, locationId: LocationId, productId: ID, packs: number): void {
  productOf(d, productId);
  const cart = d.carts[locationId];
  const idx = cart.findIndex((l) => l.productId === productId);
  const q = Math.max(0, Math.round(packs));
  if (q === 0) {
    if (idx >= 0) cart.splice(idx, 1);
    return;
  }
  if (idx >= 0) cart[idx].packs = q;
  else cart.push({ productId, packs: q });
  d.meta.touched = true;
}

export function addToCart(d: DemoData, locationId: LocationId, productId: ID, packs: number): void {
  const current = d.carts[locationId].find((l) => l.productId === productId)?.packs ?? 0;
  setCartQty(d, locationId, productId, current + packs);
}

export function clearCart(d: DemoData, locationId: LocationId): void {
  d.carts[locationId] = [];
}

export function cartLinesToOrderLines(d: DemoData, cart: CartLine[]): OrderLine[] {
  return cart.map((c) => {
    const p = productOf(d, c.productId);
    return {
      productId: p.id,
      packs: c.packs,
      packBaseQty: p.offer.pack.baseQty,
      packLabel: p.offer.pack.label,
      unitPriceCents: p.offer.priceCents,
      taxRate: p.offer.taxRate,
    };
  });
}

/** Vista previa del carrito: un pedido por proveedor, con su total y si requerirá aprobación. */
export interface CartGroup {
  supplierId: ID;
  lines: OrderLine[];
  subtotalCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
  requiresApproval: boolean;
  requestedDelivery: DayStr;
}

export function cartGroups(d: DemoData, locationId: LocationId, user: User, today: DayStr): CartGroup[] {
  const lines = cartLinesToOrderLines(d, d.carts[locationId]);
  const bySupplier = groupBy(lines, (l) => productOf(d, l.productId).offer.supplierId);
  return d.suppliers
    .filter((s) => bySupplier[s.id])
    .map((s) => {
      const totals = linesTotals(bySupplier[s.id]);
      return {
        supplierId: s.id,
        lines: bySupplier[s.id],
        ...totals,
        requiresApproval: needsApproval(d.settings, totals.totalCents, user),
        requestedDelivery: addDays(today, s.leadTimeDays),
      };
    });
}

// ───────────────────────────── Creación y aprobación ─────────────────────────────

export interface SubmitCartOptions {
  asDraft?: boolean;
  origin?: PurchaseOrder['origin'];
  note?: string;
  /** Fecha de entrega solicitada por proveedor (por defecto: hoy + plazo del proveedor). */
  delivery?: Record<ID, DayStr>;
}

/**
 * Convierte el carrito en pedidos: uno por proveedor.
 * Cada pedido se evalúa por separado frente a la regla de aprobación.
 */
export function submitCart(d: DemoData, ctx: Ctx, locationId: LocationId, opts: SubmitCartOptions = {}): ID[] {
  const user = requireUser(d, ctx);
  if (user.role === 'contabilidad') throw new DomainError('Contabilidad no puede crear pedidos.');
  if (user.role === 'gerente' && user.locationId !== locationId) {
    throw new DomainError('Un gerente solo puede pedir para su local.');
  }
  const groups = cartGroups(d, locationId, user, panamaDay(ctx.now));
  if (groups.length === 0) throw new DomainError('El pedido está vacío.');
  const loc = locationOf(d, locationId);
  const ids: ID[] = [];
  for (const g of groups) {
    const supplier = supplierOf(d, g.supplierId);
    const status: OrderStatus = opts.asDraft ? 'borrador' : g.requiresApproval ? 'pendiente_aprobacion' : 'aprobado';
    const order: PurchaseOrder = {
      id: nextId(d, 'pedido'),
      locationId,
      supplierId: g.supplierId,
      status,
      lines: g.lines,
      createdAt: ctx.now,
      createdBy: ctx.userId,
      requestedDelivery: opts.delivery?.[g.supplierId] ?? g.requestedDelivery,
      note: opts.note,
      origin: opts.origin ?? 'manual',
      requiresApproval: g.requiresApproval,
    };
    if (status === 'aprobado') {
      order.approvedAt = ctx.now;
      order.approvedBy = user.role === 'direccion' ? user.id : 'sistema';
    }
    d.orders.push(order);
    ids.push(order.id);
    const what =
      status === 'borrador' ? 'guardado como borrador'
      : status === 'pendiente_aprobacion' ? `enviado a aprobación (supera ${money(d.settings.approvalThresholdCents)})`
      : user.role === 'direccion' ? 'creado y aprobado' : 'creado (aprobación automática: bajo el umbral)';
    audit(d, ctx, 'pedido', 'pedido.creado', `Pedido ${order.id} a ${supplier.name} para ${loc.name} ${what} · ${money(g.totalCents)}`, {
      entityId: order.id, locationId,
    });
  }
  d.carts[locationId] = [];
  return ids;
}

export function submitDraft(d: DemoData, ctx: Ctx, orderId: ID): void {
  const o = orderOf(d, orderId);
  const user = requireUser(d, ctx);
  if (o.status !== 'borrador') throw new DomainError('Solo se puede enviar a validación un borrador.');
  if (o.lines.length === 0) throw new DomainError('El pedido no tiene artículos.');
  const total = orderTotals(o).totalCents;
  o.requiresApproval = needsApproval(d.settings, total, user);
  if (o.requiresApproval) {
    o.status = 'pendiente_aprobacion';
    audit(d, ctx, 'pedido', 'pedido.enviado_aprobacion', `Pedido ${o.id} enviado a aprobación · ${money(total)}`, { entityId: o.id, locationId: o.locationId });
  } else {
    o.status = 'aprobado';
    o.approvedAt = ctx.now;
    o.approvedBy = user.role === 'direccion' ? user.id : 'sistema';
    audit(d, ctx, 'pedido', 'pedido.aprobado', `Pedido ${o.id} validado · ${money(total)}`, { entityId: o.id, locationId: o.locationId });
  }
}

export function updateOrderLines(d: DemoData, ctx: Ctx, orderId: ID, lines: { productId: ID; packs: number }[]): void {
  const o = orderOf(d, orderId);
  if (!canEditLines(o)) throw new DomainError('Este pedido ya no se puede modificar.');
  const next: OrderLine[] = [];
  for (const l of lines) {
    const q = Math.max(0, Math.round(l.packs));
    if (q === 0) continue;
    const existing = o.lines.find((x) => x.productId === l.productId);
    if (existing) next.push({ ...existing, packs: q });
    else next.push(cartLinesToOrderLines(d, [{ productId: l.productId, packs: q }])[0]);
  }
  if (next.length === 0) throw new DomainError('El pedido debe conservar al menos un artículo.');
  o.lines = next;
  audit(d, ctx, 'pedido', 'pedido.modificado', `Pedido ${o.id} modificado · nuevo total ${money(orderTotals(o).totalCents)}`, { entityId: o.id, locationId: o.locationId });
}

export function approveOrder(d: DemoData, ctx: Ctx, orderId: ID): void {
  const o = orderOf(d, orderId);
  const user = requireUser(d, ctx);
  if (user.role !== 'direccion') throw new DomainError('Solo Dirección puede aprobar pedidos.');
  if (o.status !== 'pendiente_aprobacion') throw new DomainError('Este pedido no está pendiente de aprobación.');
  o.status = 'aprobado';
  o.approvedBy = user.id;
  o.approvedAt = ctx.now;
  audit(d, ctx, 'pedido', 'pedido.aprobado', `Pedido ${o.id} aprobado por ${user.name} · ${money(orderTotals(o).totalCents)}`, { entityId: o.id, locationId: o.locationId });
}

export function cancelOrder(d: DemoData, ctx: Ctx, orderId: ID, reason: string): void {
  const o = orderOf(d, orderId);
  const user = requireUser(d, ctx);
  if (!canCancel(o)) throw new DomainError('Un pedido con recepciones no se puede cancelar: ciérralo con faltante.');
  if (user.role === 'contabilidad') throw new DomainError('Contabilidad no puede cancelar pedidos.');
  const wasSent = o.status === 'enviado' || o.status === 'confirmado';
  o.status = 'cancelado';
  o.cancelledAt = ctx.now;
  o.cancelledBy = ctx.userId;
  o.cancelReason = reason.trim() || 'Sin motivo indicado';
  if (wasSent) {
    pushMessage(d, ctx, {
      threadId: o.supplierId, direction: 'out', orderId: o.id,
      body: `Buenas, por favor anular el pedido *${o.id}* de Saint-Honoré ${locationOf(d, o.locationId).name}. Motivo: ${o.cancelReason}. Gracias.`,
    });
  }
  audit(d, ctx, 'pedido', 'pedido.cancelado', `Pedido ${o.id} cancelado · ${o.cancelReason}`, { entityId: o.id, locationId: o.locationId });
}

// ───────────────────────────── WhatsApp (contenido del mensaje) ─────────────────────────────

/**
 * Texto del mensaje al proveedor: local, referencia, artículos, cantidades y fecha de entrega.
 * La composición es parte del dominio; el envío lo decide el adaptador (simulado en esta demostración).
 */
export function composeOrderMessage(d: DemoData, order: PurchaseOrder): string {
  const loc = locationOf(d, order.locationId);
  const supplier = supplierOf(d, order.supplierId);
  const manager = userName(d, loc.managerId);
  const lines = order.lines
    .map((l) => {
      const p = productOf(d, l.productId);
      return `• ${fmtPacks(l.packs, p.offer.pack)} — ${p.name} (${l.packLabel})`;
    })
    .join('\n');
  return [
    `Hola, ${supplier.contactName.split(' ')[0]}. Pedido de *Saint-Honoré ${loc.name}*`,
    `Referencia: *${order.id}*`,
    '',
    lines,
    '',
    `Entrega solicitada: *${fmtDayLong(order.requestedDelivery)}* (${fmtDate(order.requestedDelivery)}), antes de las 8:00 a. m.`,
    `Dirección: ${loc.address}`,
    `Recibe: ${manager}`,
    ...(order.note ? ['', `Nota: ${order.note}`] : []),
    '',
    'Por favor, confirmen por este medio e indiquen la referencia en la factura. ¡Gracias!',
  ].join('\n');
}

export function composeSupplierReply(d: DemoData, order: PurchaseOrder): string {
  return `Recibido ✅ Pedido ${order.id} confirmado. Entregamos el ${fmtDate(order.requestedDelivery)} a primera hora en ${locationOf(d, order.locationId).name}.`;
}

function pushMessage(
  d: DemoData,
  ctx: Ctx,
  m: Pick<WaMessage, 'threadId' | 'direction' | 'body'> & { orderId?: ID; documentId?: ID },
): WaMessage {
  const msg: WaMessage = {
    id: nextId(d, 'mensaje'),
    at: ctx.now,
    status: m.direction === 'out' ? 'entregado' : 'leido',
    simulated: true,
    ...m,
  };
  d.waMessages.push(msg);
  return msg;
}

/** Marca el pedido como enviado y deja constancia del mensaje (simulado) en el hilo del proveedor. */
export function sendOrder(d: DemoData, ctx: Ctx, orderId: ID): WaMessage {
  const o = orderOf(d, orderId);
  const user = requireUser(d, ctx);
  if (user.role === 'contabilidad') throw new DomainError('Contabilidad no puede enviar pedidos.');
  if (o.status === 'pendiente_aprobacion') throw new DomainError('El pedido requiere aprobación de Dirección antes de enviarse.');
  if (o.status !== 'aprobado') throw new DomainError('Este pedido no está listo para enviarse.');
  const msg = pushMessage(d, ctx, { threadId: o.supplierId, direction: 'out', orderId: o.id, body: composeOrderMessage(d, o) });
  o.status = 'enviado';
  o.sentAt = ctx.now;
  audit(d, ctx, 'pedido', 'pedido.enviado', `Pedido ${o.id} enviado a ${supplierOf(d, o.supplierId).name} por WhatsApp (simulado)`, { entityId: o.id, locationId: o.locationId });
  return msg;
}

/** Respuesta del proveedor (simulada en la demostración). */
export function confirmOrder(d: DemoData, ctx: Ctx, orderId: ID): void {
  const o = orderOf(d, orderId);
  if (o.status !== 'enviado') return;
  pushMessage(d, ctx, { threadId: o.supplierId, direction: 'in', orderId: o.id, body: composeSupplierReply(d, o) });
  o.status = 'confirmado';
  o.confirmedAt = ctx.now;
  audit(d, ctx, 'pedido', 'pedido.confirmado', `${supplierOf(d, o.supplierId).name} confirmó el pedido ${o.id} (respuesta simulada)`, {
    entityId: o.id, locationId: o.locationId, by: o.supplierId,
  });
}

// ───────────────────────────── Recepción ─────────────────────────────

export interface ReceiveInput {
  lines: { productId: ID; packsReceived: number; issue?: ReceptionIssue }[];
  note?: string;
}

/**
 * Registra lo que realmente llegó.
 * REGLA FUNDAMENTAL: este es el único punto del sistema que da entrada de mercancía al inventario.
 * Ni el pedido ni la factura generan movimientos de stock.
 */
export function receiveOrder(d: DemoData, ctx: Ctx, orderId: ID, input: ReceiveInput): Reception {
  const o = orderOf(d, orderId);
  const user = requireUser(d, ctx);
  if (!canReceive(o)) throw new DomainError('Este pedido no está en un estado que permita registrar una recepción.');
  if (user.role === 'contabilidad') throw new DomainError('Contabilidad no registra recepciones.');
  if (user.role === 'gerente' && user.locationId !== o.locationId) {
    throw new DomainError('Solo el gerente del local puede registrar la recepción.');
  }
  const already = receivedPacks(d.receptions, o.id);
  const lines: ReceptionLine[] = [];
  let totalReceived = 0;
  for (const ol of o.lines) {
    const pending = ol.packs - (already.get(ol.productId) ?? 0);
    if (pending <= 0) continue;
    const inp = input.lines.find((l) => l.productId === ol.productId);
    const received = Math.max(0, inp?.packsReceived ?? 0);
    if (received > pending) {
      throw new DomainError(`No puedes recibir más de lo pendiente de ${productOf(d, ol.productId).name} (${pending}).`);
    }
    totalReceived += received;
    lines.push({
      productId: ol.productId,
      packsExpected: pending,
      packsReceived: received,
      baseQty: received * ol.packBaseQty,
      issue: received < pending ? inp?.issue ?? 'faltante' : undefined,
    });
  }
  if (lines.length === 0) throw new DomainError('No queda nada pendiente de recibir en este pedido.');
  if (totalReceived === 0) throw new DomainError('Indica al menos una cantidad recibida.');

  const reception: Reception = {
    id: nextId(d, 'recepcion'),
    orderId: o.id,
    locationId: o.locationId,
    receivedAt: ctx.now,
    receivedBy: ctx.userId,
    lines,
    note: input.note?.trim() || undefined,
  };
  d.receptions.push(reception);

  for (const l of lines) {
    if (l.baseQty <= 0) continue;
    d.movements.push({
      id: nextId(d, 'movimiento'),
      at: ctx.now,
      locationId: o.locationId,
      productId: l.productId,
      type: 'recepcion',
      qty: l.baseQty,
      refKind: 'recepcion',
      refId: reception.id,
      note: `Pedido ${o.id} · ${supplierOf(d, o.supplierId).name}`,
      by: ctx.userId,
    });
  }

  const complete = lines.every((l) => l.packsReceived >= l.packsExpected);
  o.status = complete ? 'recibido' : 'recibido_parcial';
  const missing = lines.filter((l) => l.packsReceived < l.packsExpected);
  audit(
    d, ctx, 'recepcion', complete ? 'recepcion.completa' : 'recepcion.parcial',
    complete
      ? `Recepción ${reception.id} completa del pedido ${o.id}`
      : `Recepción ${reception.id} parcial del pedido ${o.id}: ${missing
          .map((l) => `faltan ${fmtPacks(l.packsExpected - l.packsReceived, productOf(d, l.productId).offer.pack)} de ${productOf(d, l.productId).name}`)
          .join('; ')}`,
    { entityId: reception.id, locationId: o.locationId },
  );
  return reception;
}

/** Da por terminado un pedido recibido parcialmente: el faltante ya no se espera. */
export function closeOrderShort(d: DemoData, ctx: Ctx, orderId: ID): void {
  const o = orderOf(d, orderId);
  if (o.status !== 'recibido_parcial') throw new DomainError('Solo se puede cerrar un pedido recibido parcialmente.');
  o.status = 'recibido';
  o.closedShort = true;
  audit(d, ctx, 'pedido', 'pedido.cerrado_faltante', `Pedido ${o.id} cerrado con faltante (no se espera el resto)`, { entityId: o.id, locationId: o.locationId });
}

/** Líneas pendientes de recibir de un pedido. */
export function pendingLines(d: DemoData, o: PurchaseOrder): { line: OrderLine; received: number; pending: number }[] {
  const already = receivedPacks(d.receptions, o.id);
  return o.lines.map((line) => {
    const received = already.get(line.productId) ?? 0;
    return { line, received, pending: Math.max(0, line.packs - received) };
  });
}
