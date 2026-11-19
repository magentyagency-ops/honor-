import type { DemoData, ID, InvoiceLine, IsoDateTime, LocationId, PrintedInvoice, PurchaseOrder } from '@/domain/types';
import { DomainError } from '@/domain/types';
import type { ReceiveDocumentInput } from '@/domain/invoices';
import { linesTotals, locationOf, orderOf, productOf, receivedPacks, supplierOf } from '@/domain/core';
import { addDays, panamaDay } from '@/domain/time';
import { unit } from '@/lib/rng';
import { PRINTS_DUE_DATE, PRINTS_ORDER_REF, nextSupplierInvoiceNumber } from './seed';

/**
 * Documentos de ejemplo que «llegan por WhatsApp» durante la demostración.
 * Sustituyen a las fotos reales que enviarían los gerentes: cada uno lleva lo que hay impreso en el papel.
 */

const SWAP: Record<string, string> = { '0': '6', '1': '7', '2': '7', '3': '8', '4': '9', '5': '6', '6': '0', '7': '1', '8': '3', '9': '4' };

/** Lectura errónea verosímil: el último dígito del número se confunde con otro parecido. */
function misreadNumber(n: string): string {
  const last = n.slice(-1);
  return n.slice(0, -1) + (SWAP[last] ?? last);
}

function fileName(now: IsoDateTime, seed: string): string {
  return `IMG-${panamaDay(now).replace(/-/g, '')}-WA${String(1000 + Math.floor(unit(`file:${seed}`) * 9000))}.jpg`;
}

export interface OrderInvoiceOptions {
  now: IsoDateTime;
  /** 'pedido': factura todo lo pedido (aunque no haya llegado). 'recibido': solo lo recibido. 'precio': lo recibido, con un precio más alto. */
  variant?: 'pedido' | 'recibido' | 'precio';
  /** Reenvía exactamente el mismo archivo (misma huella). */
  sameFile?: boolean;
}

/** Factura del proveedor para un pedido existente. */
export function buildInvoiceDocumentForOrder(d: DemoData, orderId: ID, opts: OrderInvoiceOptions): ReceiveDocumentInput {
  const order = orderOf(d, orderId);
  const supplier = supplierOf(d, order.supplierId);
  const loc = locationOf(d, order.locationId);
  const variant = opts.variant ?? 'pedido';
  const fingerprint = `pedido:${order.id}:${variant}`;

  const existing = d.documents.find((x) => x.fingerprint === fingerprint);
  if (existing && opts.sameFile) {
    return {
      channel: 'whatsapp', senderId: existing.senderId, locationId: existing.locationId, fileName: existing.fileName,
      fingerprint, kind: 'ejemplo', printed: existing.printed, hints: existing.hints, caption: existing.caption,
    };
  }

  const got = receivedPacks(d.receptions, order.id);
  const lines: InvoiceLine[] = [];
  order.lines.forEach((l, idx) => {
    const p = productOf(d, l.productId);
    const packs = variant === 'pedido' ? l.packs : got.get(l.productId) ?? 0;
    if (packs <= 0) return;
    const price = variant === 'precio' && idx === 0 ? Math.round((l.unitPriceCents * 1.06) / 10) * 10 : l.unitPriceCents;
    lines.push({ productId: p.id, description: `${p.name} · ${l.packLabel}`, packs, unitPriceCents: price, taxRate: l.taxRate });
  });
  if (lines.length === 0) throw new DomainError('Este pedido todavía no tiene nada que facturar.');

  const issueDate = panamaDay(opts.now);
  const number = nextSupplierInvoiceNumber(d, supplier.id, issueDate.slice(0, 4));
  const printed: PrintedInvoice = {
    supplierId: supplier.id,
    number,
    issueDate,
    dueDate: PRINTS_DUE_DATE.includes(supplier.id) ? addDays(issueDate, supplier.paymentTermsDays) : undefined,
    orderRef: PRINTS_ORDER_REF.includes(supplier.id) ? order.id : undefined,
    lines,
    ...linesTotals(lines),
  };
  return {
    channel: 'whatsapp',
    senderId: loc.managerId,
    locationId: loc.id,
    fileName: fileName(opts.now, number),
    fingerprint: existing ? `${fingerprint}:${number}` : fingerprint,
    kind: 'ejemplo',
    printed,
    // La foto sale algo movida: el número se lee con poca confianza (y mal).
    hints: { lowConfidence: ['number'], misread: { number: misreadNumber(number) } },
    caption: `Factura de ${supplier.short} de hoy (pedido ${order.id})`,
  };
}

/** Pedido recibido (total o parcialmente) que todavía no tiene factura ni un documento a la espera de procesarse. */
export function orderAwaitingInvoice(d: DemoData, locationId?: LocationId): PurchaseOrder | undefined {
  const invoiced = new Set(d.invoices.filter((i) => i.status !== 'descartada' && i.orderId).map((i) => i.orderId));
  const waiting = new Set(d.documents.filter((x) => !x.invoiceId && x.printed).map((x) => `${x.printed!.supplierId}|${x.locationId}`));
  return [...d.orders]
    .reverse()
    .find(
      (o) =>
        (o.status === 'recibido' || o.status === 'recibido_parcial') &&
        !invoiced.has(o.id) &&
        !waiting.has(`${o.supplierId}|${o.locationId}`) &&
        (!locationId || o.locationId === locationId),
    );
}

/** Compra hecha fuera de la plataforma: llega una factura sin pedido. */
export function buildNoOrderInvoice(d: DemoData, opts: { now: IsoDateTime; locationId: LocationId }): ReceiveDocumentInput {
  const supplier = supplierOf(d, 's-azuero');
  const loc = locationOf(d, opts.locationId);
  const issueDate = panamaDay(opts.now);
  const number = nextSupplierInvoiceNumber(d, supplier.id, issueDate.slice(0, 4));
  const limones = productOf(d, 'p-limones');
  const huevos = productOf(d, 'p-huevos');
  const lines: InvoiceLine[] = [
    { productId: limones.id, description: `${limones.name} · ${limones.offer.pack.label}`, packs: 2, unitPriceCents: limones.offer.priceCents, taxRate: 0 },
    { productId: huevos.id, description: `${huevos.name} · ${huevos.offer.pack.label}`, packs: 3, unitPriceCents: huevos.offer.priceCents, taxRate: 0 },
  ];
  return {
    channel: 'whatsapp', senderId: loc.managerId, locationId: loc.id, fileName: fileName(opts.now, number),
    fingerprint: `sin-pedido:${number}`, kind: 'ejemplo',
    printed: { supplierId: supplier.id, number, issueDate, lines, ...linesTotals(lines) },
    caption: 'Compra de urgencia en el mercado, sin pedido',
  };
}

/** El gerente vuelve a fotografiar una factura ya registrada: otro archivo, mismos datos. */
export function buildDuplicateResend(d: DemoData, opts: { now: IsoDateTime; locationId?: LocationId }): ReceiveDocumentInput {
  const original = [...d.invoices]
    .reverse()
    .find((i) => (i.status === 'validada' || i.status === 'parcialmente_pagada') && (!opts.locationId || i.locationId === opts.locationId));
  const doc = original && d.documents.find((x) => x.id === original.documentId);
  if (!original || !doc?.printed) throw new DomainError('No hay una factura validada que reenviar.');
  const n = d.documents.filter((x) => x.fingerprint.startsWith(`reenvio:${original.number}`)).length + 1;
  return {
    channel: 'whatsapp', senderId: doc.senderId, locationId: doc.locationId, fileName: fileName(opts.now, `${original.number}:${n}`),
    fingerprint: `reenvio:${original.number}:${n}`, kind: 'ejemplo', printed: JSON.parse(JSON.stringify(doc.printed)) as PrintedInvoice,
    caption: 'Te la reenvío por si no había llegado',
  };
}
