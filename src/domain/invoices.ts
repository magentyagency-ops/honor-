import type {
  Cents, Ctx, DayStr, DemoData, DocChannel, ExtractionHints, ID, Invoice, InvoiceFieldKey, InvoiceLine,
  InvoiceStatus, LocationId, OrderLine, Payment, PaymentMethod, PrintedInvoice, PurchaseOrder, Reception,
  SourceDocument,
} from './types';
import { DomainError } from './types';
import { audit, lineSubtotal, lineTax, linesTotals, locationOf, nextId, productOf, receivedPacks, requireUser, supplierOf, sum } from './core';
import { addDays, diffDays, fmtDate, panamaDay } from './time';
import { money, packs as fmtPacks } from './format';

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  recibida: 'Recibida',
  por_revisar: 'Por revisar',
  validada: 'Validada',
  parcialmente_pagada: 'Parcialmente pagada',
  pagada: 'Pagada',
  en_disputa: 'En disputa',
  descartada: 'Descartada',
};

export const FIELD_LABEL: Record<InvoiceFieldKey, string> = {
  supplierId: 'Proveedor',
  number: 'N.º de factura',
  issueDate: 'Fecha de emisión',
  dueDate: 'Vencimiento',
  locationId: 'Local',
  subtotalCents: 'Subtotal',
  taxCents: 'ITBMS',
  totalCents: 'Total',
};

/** Por debajo de este nivel, un campo extraído debe confirmarse o corregirse antes de validar. */
export const CONFIDENCE_THRESHOLD = 0.8;

// ───────────────────────────── Documentos ─────────────────────────────

export interface ReceiveDocumentInput {
  channel: DocChannel;
  senderId: ID;
  locationId: LocationId;
  fileName: string;
  fingerprint: string;
  kind: SourceDocument['kind'];
  printed?: PrintedInvoice;
  hints?: ExtractionHints;
  previewDataUrl?: string;
  caption?: string;
}

/**
 * Registra un documento entrante. Si el mismo archivo (misma huella) ya existe, no se crea otro:
 * se devuelve el original. Así un reenvío por WhatsApp no genera una segunda factura.
 */
export function receiveDocument(d: DemoData, ctx: Ctx, input: ReceiveDocumentInput): { document: SourceDocument; alreadyImported: boolean } {
  const existing = d.documents.find((x) => x.fingerprint === input.fingerprint);
  if (existing) {
    audit(d, ctx, 'documento', 'documento.reenvio_ignorado', `Reenvío ignorado: el archivo «${input.fileName}» ya se había importado como ${existing.id}`, {
      entityId: existing.id, locationId: existing.locationId, by: input.senderId,
    });
    return { document: existing, alreadyImported: true };
  }
  const document: SourceDocument = {
    id: nextId(d, 'documento'),
    channel: input.channel,
    senderId: input.senderId,
    locationId: input.locationId,
    receivedAt: ctx.now,
    fileName: input.fileName,
    fingerprint: input.fingerprint,
    kind: input.kind,
    status: 'recibido',
    printed: input.printed,
    hints: input.hints,
    previewDataUrl: input.previewDataUrl,
    caption: input.caption,
  };
  d.documents.push(document);
  audit(
    d, ctx, 'documento', 'documento.recibido',
    `Documento ${document.id} recibido ${input.channel === 'whatsapp' ? 'por WhatsApp (simulado)' : 'por carga manual'} · ${locationOf(d, input.locationId).name}`,
    { entityId: document.id, locationId: input.locationId, by: input.senderId },
  );
  return { document, alreadyImported: false };
}

// ───────────────────────────── Extracción → factura ─────────────────────────────

export interface ExtractionResult {
  engine: string;
  fields: {
    supplierId?: ID;
    number: string;
    issueDate: DayStr;
    dueDate?: DayStr;
    locationId: LocationId;
    subtotalCents: Cents;
    taxCents: Cents;
    totalCents: Cents;
    orderRef?: ID;
  };
  confidence: Partial<Record<InvoiceFieldKey, number>>;
  lines: InvoiceLine[];
}

function activeInvoiceForOrder(d: DemoData, orderId: ID, exceptId?: ID): Invoice | undefined {
  return d.invoices.find((i) => i.orderId === orderId && i.id !== exceptId && i.status !== 'descartada');
}

/**
 * Busca el pedido que mejor corresponde a una factura sin referencia explícita.
 * Solo propone pedidos del mismo proveedor y local, cercanos en fecha y con artículos en común.
 * Si la factura no trae líneas, exige además que el importe coincida: no se vincula «por si acaso».
 */
export function suggestOrder(
  d: DemoData,
  f: { supplierId?: ID; locationId: LocationId; issueDate: DayStr; lines: InvoiceLine[]; totalCents?: Cents },
  exceptInvoiceId?: ID,
): PurchaseOrder | undefined {
  if (!f.supplierId) return undefined;
  let best: PurchaseOrder | undefined;
  let bestScore = 0;
  for (const o of d.orders) {
    if (o.supplierId !== f.supplierId || o.locationId !== f.locationId) continue;
    if (!['enviado', 'confirmado', 'recibido_parcial', 'recibido'].includes(o.status)) continue;
    if (activeInvoiceForOrder(d, o.id, exceptInvoiceId)) continue;
    const gap = Math.abs(diffDays(o.requestedDelivery, f.issueDate));
    if (gap > 10) continue;
    let overlap: number;
    if (f.lines.length === 0) {
      const total = linesTotals(o.lines).totalCents;
      if (!f.totalCents || Math.abs(total - f.totalCents) > Math.max(100, total * 0.01)) continue;
      overlap = 0.8;
    } else {
      const ids = new Set(o.lines.map((l) => l.productId));
      const shared = f.lines.filter((l) => l.productId && ids.has(l.productId)).length;
      if (shared === 0) continue;
      overlap = shared / Math.max(f.lines.length, o.lines.length);
    }
    const score = overlap * 0.8 + (1 - gap / 10) * 0.2;
    if (score > bestScore) {
      best = o;
      bestScore = score;
    }
  }
  return bestScore >= 0.45 ? best : undefined;
}

export function applyExtraction(d: DemoData, ctx: Ctx, documentId: ID, result: ExtractionResult): Invoice {
  const doc = d.documents.find((x) => x.id === documentId);
  if (!doc) throw new DomainError('Documento desconocido.');
  if (doc.invoiceId) {
    const existing = d.invoices.find((i) => i.id === doc.invoiceId);
    if (existing) return existing; // un documento solo genera una factura
  }
  const f = result.fields;
  const supplier = f.supplierId ? supplierOf(d, f.supplierId) : undefined;
  const hasPrintedDue = Boolean(f.dueDate);
  const invoice: Invoice = {
    id: nextId(d, 'factura'),
    documentId,
    status: 'por_revisar',
    receivedAt: doc.receivedAt,
    locationId: f.locationId,
    supplierId: f.supplierId,
    number: f.number,
    issueDate: f.issueDate,
    dueDate: f.dueDate ?? addDays(f.issueDate, supplier?.paymentTermsDays ?? 30),
    dueDateSource: hasPrintedDue ? 'documento' : 'propuesta',
    dueDateConfirmed: hasPrintedDue,
    subtotalCents: f.subtotalCents,
    taxCents: f.taxCents,
    totalCents: f.totalCents,
    lines: result.lines,
    confidence: { ...result.confidence },
    corrections: [],
  };
  const byRef = f.orderRef ? d.orders.find((o) => o.id === f.orderRef && (!f.supplierId || o.supplierId === f.supplierId)) : undefined;
  if (byRef) {
    invoice.orderId = byRef.id;
    invoice.orderMatch = 'referencia';
  } else {
    const suggested = suggestOrder(d, { ...f, lines: result.lines });
    if (suggested) {
      invoice.orderId = suggested.id;
      invoice.orderMatch = 'sugerido';
    }
  }
  d.invoices.push(invoice);
  doc.status = 'procesado';
  doc.invoiceId = invoice.id;
  audit(
    d, ctx, 'factura', 'factura.extraida',
    `Factura ${invoice.number || invoice.id} extraída del documento ${doc.id} (${result.engine})` +
      (invoice.orderId ? ` · vinculada al pedido ${invoice.orderId}` : ' · sin pedido asociado'),
    { entityId: invoice.id, locationId: invoice.locationId, by: 'sistema' },
  );
  return invoice;
}

// ───────────────────────────── Análisis: pedido ↔ recepción ↔ factura ─────────────────────────────

export type AnomalyKind = 'duplicado' | 'cantidad' | 'precio' | 'sin_pedido' | 'no_pedido' | 'total';

export interface Anomaly {
  kind: AnomalyKind;
  title: string;
  detail: string;
  amountCents?: Cents;
  productId?: ID;
  relatedInvoiceId?: ID;
}

export interface LineMatch {
  line: InvoiceLine;
  orderLine?: OrderLine;
  orderedPacks?: number;
  receivedPacks?: number;
  /** Diferencia de precio por presentación (facturado − pedido). */
  priceDeltaCents: Cents;
  /** Presentaciones facturadas de más respecto a lo recibido. */
  overBilledPacks: number;
}

export interface InvoiceAnalysis {
  order?: PurchaseOrder;
  receptions: Reception[];
  lines: LineMatch[];
  anomalies: Anomaly[];
  /** Importe (con impuestos) que corresponde a lo realmente recibido, a precio de factura. */
  receivedValueCents: Cents;
  duplicateOf?: Invoice;
}

const normNumber = (n: string) => n.replace(/[^a-z0-9]/gi, '').toUpperCase();

/** Posible duplicado: mismo proveedor, mismo número y mismo importe en una factura anterior. */
export function findDuplicate(d: DemoData, inv: Invoice): Invoice | undefined {
  if (!inv.supplierId || !inv.number) return undefined;
  const n = normNumber(inv.number);
  return d.invoices.find(
    (o) =>
      o.id !== inv.id &&
      o.status !== 'descartada' &&
      o.supplierId === inv.supplierId &&
      normNumber(o.number) === n &&
      o.totalCents === inv.totalCents &&
      (o.receivedAt < inv.receivedAt || (o.receivedAt === inv.receivedAt && o.id < inv.id)),
  );
}

export function analyzeInvoice(d: DemoData, inv: Invoice): InvoiceAnalysis {
  const order = inv.orderId ? d.orders.find((o) => o.id === inv.orderId) : undefined;
  const receptions = order ? d.receptions.filter((r) => r.orderId === order.id) : [];
  const received = order ? receivedPacks(d.receptions, order.id) : new Map<ID, number>();
  const anomalies: Anomaly[] = [];

  const duplicateOf = inv.duplicateDismissed ? undefined : findDuplicate(d, inv);
  if (duplicateOf) {
    anomalies.push({
      kind: 'duplicado',
      title: 'Posible duplicado',
      detail: `Mismo proveedor, mismo número (${duplicateOf.number}) y mismo importe (${money(duplicateOf.totalCents)}) que la factura recibida el ${fmtDate(duplicateOf.receivedAt)}. No se elimina nada automáticamente: decide tú.`,
      amountCents: inv.totalCents,
      relatedInvoiceId: duplicateOf.id,
    });
  }

  const lines: LineMatch[] = inv.lines.map((line) => {
    const orderLine = order && line.productId ? order.lines.find((l) => l.productId === line.productId) : undefined;
    const receivedN = line.productId && order ? received.get(line.productId) ?? 0 : undefined;
    const priceDeltaCents = orderLine ? line.unitPriceCents - orderLine.unitPriceCents : 0;
    const overBilledPacks = receivedN !== undefined ? Math.max(0, line.packs - receivedN) : 0;
    return { line, orderLine, orderedPacks: orderLine?.packs, receivedPacks: receivedN, priceDeltaCents, overBilledPacks };
  });

  if (!order) {
    if (inv.lines.length > 0 || inv.totalCents > 0) {
      anomalies.push({
        kind: 'sin_pedido',
        title: 'Factura sin pedido',
        detail: 'No hay un pedido asociado: no se puede comprobar el precio ni lo recibido. Vincula un pedido o valida indicando el motivo.',
      });
    }
  } else {
    for (const m of lines) {
      const name = m.line.productId ? productOf(d, m.line.productId).name : m.line.description;
      if (!m.orderLine) {
        anomalies.push({
          kind: 'no_pedido',
          title: 'Artículo no pedido',
          detail: `${name} aparece en la factura pero no en el pedido ${order.id}.`,
          amountCents: lineSubtotal(m.line) + lineTax(m.line),
          productId: m.line.productId,
        });
        continue;
      }
      if (m.overBilledPacks > 0) {
        const p = productOf(d, m.orderLine.productId);
        const amount = Math.round(m.overBilledPacks * m.line.unitPriceCents * (1 + m.line.taxRate));
        anomalies.push({
          kind: 'cantidad',
          title: 'Se factura más de lo recibido',
          detail: `${name}: facturado ${fmtPacks(m.line.packs, p.offer.pack)}, recibido ${fmtPacks(m.receivedPacks ?? 0, p.offer.pack)}. Diferencia de ${fmtPacks(m.overBilledPacks, p.offer.pack)} (${money(amount)}).`,
          amountCents: amount,
          productId: p.id,
        });
      }
      if (m.priceDeltaCents !== 0) {
        const amount = Math.round(m.priceDeltaCents * m.line.packs * (1 + m.line.taxRate));
        anomalies.push({
          kind: 'precio',
          title: m.priceDeltaCents > 0 ? 'Precio superior al pedido' : 'Precio inferior al pedido',
          detail: `${name}: facturado a ${money(m.line.unitPriceCents)}, pedido a ${money(m.orderLine.unitPriceCents)} por ${m.orderLine.packLabel.toLowerCase()}. Impacto ${amount > 0 ? '+' : ''}${money(amount)}.`,
          amountCents: amount,
          productId: m.orderLine.productId,
        });
      }
    }
  }

  if (inv.lines.length > 0) {
    const t = linesTotals(inv.lines);
    if (Math.abs(t.totalCents - inv.totalCents) > 1) {
      anomalies.push({
        kind: 'total',
        title: 'El total no coincide con las líneas',
        detail: `Las líneas suman ${money(t.totalCents)} y el total indicado es ${money(inv.totalCents)}.`,
        amountCents: inv.totalCents - t.totalCents,
      });
    }
  }

  const receivedValueCents = order
    ? sum(lines, (m) => {
        const billable = Math.min(m.line.packs, m.receivedPacks ?? m.line.packs);
        return Math.round(billable * m.line.unitPriceCents * (1 + m.line.taxRate));
      })
    : inv.totalCents;

  return { order, receptions, lines, anomalies, receivedValueCents, duplicateOf };
}

export function lowConfidenceFields(inv: Invoice): InvoiceFieldKey[] {
  return (Object.keys(inv.confidence) as InvoiceFieldKey[]).filter((k) => (inv.confidence[k] ?? 1) < CONFIDENCE_THRESHOLD);
}

// ───────────────────────────── Revisión y validación ─────────────────────────────

function invoiceOf(d: DemoData, id: ID): Invoice {
  const inv = d.invoices.find((x) => x.id === id);
  if (!inv) throw new DomainError('Factura desconocida.');
  return inv;
}

function assertFinance(d: DemoData, ctx: Ctx) {
  const user = requireUser(d, ctx);
  if (user.role === 'gerente') throw new DomainError('Solo Contabilidad o Dirección pueden hacer esta acción.');
  return user;
}

function assertEditable(inv: Invoice) {
  if (inv.status !== 'por_revisar' && inv.status !== 'en_disputa') {
    throw new DomainError('La factura ya está validada: sus datos no se pueden modificar.');
  }
}

function describe(d: DemoData, field: InvoiceFieldKey, value: unknown): string {
  if (value === undefined || value === '') return '(vacío)';
  if (field === 'supplierId') return supplierOf(d, String(value)).name;
  if (field === 'locationId') return locationOf(d, value as LocationId).name;
  if (field === 'issueDate' || field === 'dueDate') return fmtDate(String(value));
  if (field.endsWith('Cents')) return money(Number(value));
  return String(value);
}

/** Corrige un campo extraído. La corrección queda registrada (valor anterior, nuevo, autor y fecha). */
export function correctInvoiceField(d: DemoData, ctx: Ctx, invoiceId: ID, field: InvoiceFieldKey, value: string | number): void {
  assertFinance(d, ctx);
  const inv = invoiceOf(d, invoiceId);
  assertEditable(inv);
  const before = inv[field];
  if (before === value) {
    inv.confidence[field] = 1;
    return;
  }
  if (field === 'supplierId') supplierOf(d, String(value));
  if (field === 'locationId') locationOf(d, value as LocationId);
  if (field.endsWith('Cents') && !(Number(value) >= 0)) throw new DomainError('Importe no válido.');
  (inv as unknown as Record<string, unknown>)[field] = value;
  inv.confidence[field] = 1;
  if (field === 'dueDate') {
    inv.dueDateSource = 'manual';
    inv.dueDateConfirmed = true;
  }
  if ((field === 'supplierId' || field === 'issueDate') && inv.dueDateSource === 'propuesta' && inv.supplierId) {
    inv.dueDate = addDays(inv.issueDate, supplierOf(d, inv.supplierId).paymentTermsDays);
  }
  if (field === 'supplierId' || field === 'locationId') {
    const suggested = suggestOrder(d, inv, inv.id);
    inv.orderId = suggested?.id;
    inv.orderMatch = suggested ? 'sugerido' : undefined;
  }
  const from = describe(d, field, before);
  const to = describe(d, field, value);
  inv.corrections.push({ field, from, to, by: ctx.userId, at: ctx.now });
  audit(d, ctx, 'factura', 'factura.corregida', `Factura ${inv.number || inv.id}: ${FIELD_LABEL[field]} corregido de «${from}» a «${to}»`, {
    entityId: inv.id, locationId: inv.locationId,
  });
}

/** Da por bueno un campo de baja confianza sin cambiar su valor. */
export function confirmInvoiceField(d: DemoData, ctx: Ctx, invoiceId: ID, field: InvoiceFieldKey): void {
  assertFinance(d, ctx);
  const inv = invoiceOf(d, invoiceId);
  assertEditable(inv);
  inv.confidence[field] = 1;
  d.meta.touched = true;
}

/** Un vencimiento deducido de las condiciones del proveedor es una propuesta: hay que confirmarla. */
export function confirmDueDate(d: DemoData, ctx: Ctx, invoiceId: ID): void {
  assertFinance(d, ctx);
  const inv = invoiceOf(d, invoiceId);
  assertEditable(inv);
  if (inv.dueDateConfirmed) return;
  inv.dueDateConfirmed = true;
  inv.confidence.dueDate = 1;
  audit(d, ctx, 'factura', 'factura.vencimiento_confirmado', `Factura ${inv.number}: vencimiento ${fmtDate(inv.dueDate)} confirmado`, {
    entityId: inv.id, locationId: inv.locationId,
  });
}

export function linkInvoiceOrder(d: DemoData, ctx: Ctx, invoiceId: ID, orderId: ID | undefined): void {
  assertFinance(d, ctx);
  const inv = invoiceOf(d, invoiceId);
  assertEditable(inv);
  if (orderId) {
    const o = d.orders.find((x) => x.id === orderId);
    if (!o) throw new DomainError('Pedido desconocido.');
    inv.orderId = o.id;
    inv.orderMatch = 'manual';
    audit(d, ctx, 'factura', 'factura.vinculada', `Factura ${inv.number} vinculada al pedido ${o.id}`, { entityId: inv.id, locationId: inv.locationId });
  } else {
    delete inv.orderId;
    delete inv.orderMatch;
    audit(d, ctx, 'factura', 'factura.desvinculada', `Factura ${inv.number} desvinculada de su pedido`, { entityId: inv.id, locationId: inv.locationId });
  }
}

/** Motivos por los que una factura todavía no se puede validar. */
export function validationBlockers(d: DemoData, inv: Invoice): string[] {
  const out: string[] = [];
  if (!inv.supplierId) out.push('Indica el proveedor.');
  if (!inv.number.trim()) out.push('Indica el número de factura.');
  if (!(inv.totalCents > 0)) out.push('Indica el total de la factura.');
  const low = lowConfidenceFields(inv).filter((f) => f !== 'dueDate');
  if (low.length > 0) out.push(`Confirma o corrige: ${low.map((f) => FIELD_LABEL[f]).join(', ')}.`);
  if (!inv.dueDateConfirmed) out.push('Confirma el vencimiento propuesto.');
  if (!inv.duplicateDismissed && findDuplicate(d, inv)) out.push('Resuelve la alerta de posible duplicado.');
  return out;
}

/**
 * Valida la factura: pasa a ser deuda reconocida.
 * No toca el inventario: lo que entra en stock lo determina únicamente la recepción.
 */
export function validateInvoice(d: DemoData, ctx: Ctx, invoiceId: ID, note?: string): void {
  const user = assertFinance(d, ctx);
  const inv = invoiceOf(d, invoiceId);
  if (inv.status !== 'por_revisar') throw new DomainError('Solo se puede validar una factura en revisión.');
  const blockers = validationBlockers(d, inv);
  if (blockers.length > 0) throw new DomainError(blockers[0]);
  const { anomalies } = analyzeInvoice(d, inv);
  if (anomalies.length > 0 && !note?.trim()) {
    throw new DomainError('La factura tiene diferencias: indica cómo se resuelven antes de validar.');
  }
  inv.status = 'validada';
  inv.validatedBy = user.id;
  inv.validatedAt = ctx.now;
  inv.validationNote = note?.trim() || undefined;
  audit(
    d, ctx, 'factura', 'factura.validada',
    `Factura ${inv.number} de ${supplierOf(d, inv.supplierId!).name} validada · ${money(inv.totalCents)} · vence el ${fmtDate(inv.dueDate)}` +
      (anomalies.length > 0 ? ` · con observación: ${inv.validationNote}` : ''),
    { entityId: inv.id, locationId: inv.locationId },
  );
}

export function disputeInvoice(d: DemoData, ctx: Ctx, invoiceId: ID, input: { reason: string; amountCents: Cents }): void {
  const user = assertFinance(d, ctx);
  const inv = invoiceOf(d, invoiceId);
  if (!['por_revisar', 'validada', 'parcialmente_pagada'].includes(inv.status)) {
    throw new DomainError('Esta factura no se puede poner en disputa en su estado actual.');
  }
  if (!input.reason.trim()) throw new DomainError('Indica el motivo de la disputa.');
  const amount = Math.max(0, Math.min(Math.round(input.amountCents), inv.totalCents));
  inv.status = 'en_disputa';
  inv.dispute = { reason: input.reason.trim(), amountCents: amount, openedBy: user.id, openedAt: ctx.now };
  audit(d, ctx, 'factura', 'factura.en_disputa', `Factura ${inv.number} en disputa por ${money(amount)} · ${input.reason.trim()}`, {
    entityId: inv.id, locationId: inv.locationId,
  });
}

/** Cierra la disputa y devuelve la factura a revisión para validarla (o descartarla). */
export function reopenInvoice(d: DemoData, ctx: Ctx, invoiceId: ID, resolution: string): void {
  assertFinance(d, ctx);
  const inv = invoiceOf(d, invoiceId);
  if (inv.status !== 'en_disputa') throw new DomainError('La factura no está en disputa.');
  inv.status = 'por_revisar';
  delete inv.dispute;
  audit(d, ctx, 'factura', 'factura.disputa_cerrada', `Disputa de la factura ${inv.number} cerrada · ${resolution.trim() || 'sin comentario'}`, {
    entityId: inv.id, locationId: inv.locationId,
  });
}

export function dismissDuplicate(d: DemoData, ctx: Ctx, invoiceId: ID): void {
  assertFinance(d, ctx);
  const inv = invoiceOf(d, invoiceId);
  assertEditable(inv);
  inv.duplicateDismissed = true;
  audit(d, ctx, 'factura', 'factura.no_duplicada', `Factura ${inv.number}: alerta de duplicado descartada (son documentos distintos)`, {
    entityId: inv.id, locationId: inv.locationId,
  });
}

/** Descarta una factura (por ejemplo, un duplicado confirmado). El documento se conserva. */
export function discardInvoice(d: DemoData, ctx: Ctx, invoiceId: ID, reason: string): void {
  assertFinance(d, ctx);
  const inv = invoiceOf(d, invoiceId);
  assertEditable(inv);
  const isDup = Boolean(findDuplicate(d, inv));
  inv.status = 'descartada';
  inv.discardedReason = reason.trim() || (isDup ? 'Duplicado confirmado' : 'Descartada');
  const doc = d.documents.find((x) => x.id === inv.documentId);
  if (doc && isDup) doc.status = 'duplicado';
  audit(d, ctx, 'factura', 'factura.descartada', `Factura ${inv.number} descartada · ${inv.discardedReason}. El documento original se conserva.`, {
    entityId: inv.id, locationId: inv.locationId,
  });
}

// ───────────────────────────── Pagos ─────────────────────────────

export function paymentsOf(d: DemoData, invoiceId: ID): Payment[] {
  return d.payments.filter((p) => p.invoiceId === invoiceId && !p.voidedAt);
}

export function paidCents(d: DemoData, invoiceId: ID): Cents {
  return sum(paymentsOf(d, invoiceId), (p) => p.amountCents);
}

export function balanceCents(d: DemoData, inv: Invoice): Cents {
  return inv.totalCents - paidCents(d, inv.id);
}

/** Deuda reconocida: validada y con saldo pendiente. */
export function isPayable(inv: Invoice): boolean {
  return inv.status === 'validada' || inv.status === 'parcialmente_pagada';
}

function refreshPaymentStatus(d: DemoData, inv: Invoice) {
  const paid = paidCents(d, inv.id);
  if (paid >= inv.totalCents) inv.status = 'pagada';
  else if (paid > 0) inv.status = 'parcialmente_pagada';
  else inv.status = 'validada';
}

export interface PaymentInput {
  invoiceId: ID;
  date: DayStr;
  amountCents: Cents;
  method: PaymentMethod;
  reference: string;
}

/**
 * Registra un pago en la plataforma. No mueve dinero: es el reflejo de un pago hecho por fuera.
 * Un pago parcial reduce el saldo y deja la factura «parcialmente pagada».
 */
export function recordPayment(d: DemoData, ctx: Ctx, input: PaymentInput): Payment {
  assertFinance(d, ctx);
  const inv = invoiceOf(d, input.invoiceId);
  if (!isPayable(inv)) throw new DomainError('Solo se registran pagos sobre facturas validadas con saldo pendiente.');
  const amount = Math.round(input.amountCents);
  if (!(amount > 0)) throw new DomainError('Indica un importe mayor que cero.');
  const balance = balanceCents(d, inv);
  if (amount > balance) throw new DomainError(`El pago (${money(amount)}) supera el saldo pendiente (${money(balance)}).`);
  if (input.date > panamaDay(ctx.now)) throw new DomainError('La fecha del pago no puede ser futura.');
  const payment: Payment = {
    id: nextId(d, 'pago'),
    invoiceId: inv.id,
    date: input.date,
    amountCents: amount,
    method: input.method,
    reference: input.reference.trim(),
    by: ctx.userId,
    createdAt: ctx.now,
  };
  d.payments.push(payment);
  refreshPaymentStatus(d, inv);
  const rest = balance - amount;
  audit(
    d, ctx, 'pago', rest === 0 ? 'pago.total' : 'pago.parcial',
    `Pago ${payment.id} de ${money(amount)} a ${supplierOf(d, inv.supplierId!).name} (factura ${inv.number})` +
      (rest === 0 ? ' · factura saldada' : ` · saldo pendiente ${money(rest)}`),
    { entityId: payment.id, locationId: inv.locationId },
  );
  return payment;
}

export function voidPayment(d: DemoData, ctx: Ctx, paymentId: ID): void {
  assertFinance(d, ctx);
  const p = d.payments.find((x) => x.id === paymentId);
  if (!p || p.voidedAt) throw new DomainError('Pago desconocido o ya anulado.');
  const inv = invoiceOf(d, p.invoiceId);
  p.voidedAt = ctx.now;
  p.voidedBy = ctx.userId;
  refreshPaymentStatus(d, inv);
  audit(d, ctx, 'pago', 'pago.anulado', `Pago ${p.id} de ${money(p.amountCents)} anulado · saldo de la factura ${inv.number}: ${money(balanceCents(d, inv))}`, {
    entityId: p.id, locationId: inv.locationId,
  });
}

/** Factura creada a mano a partir de un archivo que la demostración no puede leer. */
export function createManualInvoice(d: DemoData, ctx: Ctx, documentId: ID): Invoice {
  const doc = d.documents.find((x) => x.id === documentId);
  if (!doc) throw new DomainError('Documento desconocido.');
  if (doc.invoiceId) return invoiceOf(d, doc.invoiceId);
  const today = panamaDay(ctx.now);
  const invoice: Invoice = {
    id: nextId(d, 'factura'), documentId, status: 'por_revisar', receivedAt: doc.receivedAt, locationId: doc.locationId,
    number: '', issueDate: today, dueDate: addDays(today, 30), dueDateSource: 'propuesta', dueDateConfirmed: false,
    subtotalCents: 0, taxCents: 0, totalCents: 0, lines: [], confidence: {}, corrections: [],
  };
  d.invoices.push(invoice);
  doc.status = 'procesado';
  doc.invoiceId = invoice.id;
  audit(d, ctx, 'factura', 'factura.manual', `Factura creada para captura manual a partir del documento ${doc.id}`, { entityId: invoice.id, locationId: invoice.locationId });
  return invoice;
}
