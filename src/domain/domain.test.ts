import { describe, expect, it } from 'vitest';
import { createSeed } from '@/data/seed';
import { generateTickets } from '@/adapters/pos';
import { simulateExtraction } from '@/adapters/extraction';
import type { Ctx, DemoData, SaleTicket } from './types';
import { DomainError } from './types';
import { orderTotals, stockOf } from './core';
import {
  addToCart, approveOrder, cancelOrder, confirmOrder, receiveOrder, sendOrder, submitCart,
} from './purchasing';
import { importTickets, mapPosItem } from './sales';
import { recordCount, recordWaste, saveRecipe, transferStock } from './inventory';
import {
  analyzeInvoice, applyExtraction, balanceCents, confirmDueDate, correctInvoiceField, createManualInvoice, findDuplicate, receiveDocument,
  recordPayment, validateInvoice, voidPayment,
} from './invoices';
import { alerts, kpis, payables, salesTotals, stockQty, suggestions } from './selectors';
import { addMinutes, panamaDay } from './time';
import { buildInvoiceDocumentForOrder } from '@/data/scenarios';

/** Miércoles 11/11/2026, 3:30 p. m. en Panamá. */
const NOW = '2026-11-11T20:30:00.000Z';
const TODAY = panamaDay(NOW);
const antoine: Ctx = { now: NOW, userId: 'u-antoine' };
const luis: Ctx = { now: NOW, userId: 'u-luis' };
const rosa: Ctx = { now: NOW, userId: 'u-rosa' };

const fresh = (): DemoData => createSeed(NOW);

function ticket(id: string, lines: [string, number][], d: DemoData): SaleTicket {
  const ls = lines.map(([itemId, qty]) => ({ itemId, qty, unitPriceCents: d.posItems.find((x) => x.id === itemId)!.priceCents }));
  return { id, locationId: 'sf', at: NOW, lines: ls, totalCents: ls.reduce((t, l) => t + l.qty * l.unitPriceCents, 0) };
}

/** Crea, envía y confirma un pedido de leche para San Francisco. */
function milkOrder(d: DemoData, packs = 10) {
  addToCart(d, 'sf', 'p-leche', packs);
  const [id] = submitCart(d, antoine, 'sf');
  sendOrder(d, antoine, id);
  confirmOrder(d, antoine, id);
  return id;
}

describe('datos de demostración', () => {
  it('son deterministas: reiniciar el mismo día produce exactamente los mismos datos', () => {
    expect(JSON.stringify(createSeed(NOW))).toBe(JSON.stringify(createSeed(NOW)));
  });

  it('contienen el guion previsto', () => {
    const d = fresh();
    expect(d.locations).toHaveLength(3);
    expect(d.suppliers).toHaveLength(6);
    expect(d.products).toHaveLength(25);
    expect(d.recipes).toHaveLength(8);
    const statuses = new Set(d.orders.map((o) => o.status));
    for (const s of ['borrador', 'pendiente_aprobacion', 'aprobado', 'enviado', 'confirmado', 'recibido_parcial', 'recibido', 'cancelado']) {
      expect(statuses.has(s as never), `falta un pedido en estado ${s}`).toBe(true);
    }
    const inv = new Set(d.invoices.map((i) => i.status));
    for (const s of ['por_revisar', 'validada', 'parcialmente_pagada', 'pagada', 'en_disputa']) {
      expect(inv.has(s as never), `falta una factura en estado ${s}`).toBe(true);
    }
    // Leche a punto de agotarse en San Francisco, sin pedido en curso.
    const milk = stockQty(d, 'sf', 'p-leche');
    expect(milk).toBeGreaterThan(0);
    expect(milk).toBeLessThan(d.stockSettings['sf:p-leche'].minBase);
    const al = alerts(d, d.users.find((u) => u.id === 'u-antoine')!, NOW);
    expect(al[0].tourKey).toBe('alerta-leche');
    expect(al.some((a) => a.kind === 'caja' && a.locationId === 'sf')).toBe(true);
    expect(al.some((a) => a.kind === 'recepcion_parcial')).toBe(true);
    expect(al.some((a) => a.kind === 'pagos_vencidos')).toBe(true);
    expect(al.some((a) => a.kind === 'sin_receta')).toBe(true);
    expect(al.some((a) => a.kind === 'factura' && a.title.includes('precio'))).toBe(true);
    expect(al.some((a) => a.kind === 'factura' && a.title.includes('duplicada'))).toBe(true);
  });

  it('ningún producto tiene existencia negativa y todos tienen inventario inicial', () => {
    const d = fresh();
    for (const l of d.locations) for (const p of d.products) {
      expect(stockQty(d, l.id, p.id), `${p.name} en ${l.name}`).toBeGreaterThanOrEqual(0);
      expect(d.movements.some((m) => m.locationId === l.id && m.productId === p.id && m.type === 'inventario_inicial')).toBe(true);
    }
  });
});

describe('compras y recepción', () => {
  it('un carrito con varios proveedores genera un pedido por proveedor', () => {
    const d = fresh();
    addToCart(d, 'sf', 'p-leche', 4);
    addToCart(d, 'sf', 'p-queso', 3);
    addToCart(d, 'sf', 'p-harina', 2);
    const ids = submitCart(d, luis, 'sf');
    expect(ids).toHaveLength(2);
    const created = d.orders.filter((o) => ids.includes(o.id));
    expect(new Set(created.map((o) => o.supplierId))).toEqual(new Set(['s-pradera', 's-molinos']));
    expect(d.carts.sf).toHaveLength(0);
  });

  it('por encima del umbral, un pedido de gerente necesita la aprobación de Dirección', () => {
    const d = fresh();
    addToCart(d, 'sf', 'p-cafe', 6); // 6 × $117 = $702 > $500
    const [id] = submitCart(d, luis, 'sf');
    const o = d.orders.find((x) => x.id === id)!;
    expect(o.status).toBe('pendiente_aprobacion');
    expect(() => sendOrder(d, luis, id)).toThrow(DomainError);
    expect(() => approveOrder(d, luis, id)).toThrow(/Dirección/);
    approveOrder(d, antoine, id);
    expect(o.status).toBe('aprobado');
    sendOrder(d, antoine, id);
    expect(o.status).toBe('enviado');
    expect(d.waMessages.at(-1)!.body).toContain(id);
    expect(d.waMessages.at(-1)!.body).toContain('San Francisco');
  });

  it('crear, aprobar, enviar y confirmar un pedido NO modifica el inventario', () => {
    const d = fresh();
    const before = stockQty(d, 'sf', 'p-leche');
    milkOrder(d, 10);
    expect(stockQty(d, 'sf', 'p-leche')).toBe(before);
  });

  it('una recepción parcial añade exactamente lo recibido, en el local correcto', () => {
    const d = fresh();
    const before = { sf: stockQty(d, 'sf', 'p-leche'), cv: stockQty(d, 'cv', 'p-leche'), ce: stockQty(d, 'ce', 'p-leche') };
    const id = milkOrder(d, 10);
    receiveOrder(d, luis, id, { lines: [{ productId: 'p-leche', packsReceived: 6 }], note: 'Faltan 4 cajas' });
    // 6 cajas × 12 L = 72 000 ml
    expect(stockQty(d, 'sf', 'p-leche')).toBe(before.sf + 72000);
    expect(stockQty(d, 'cv', 'p-leche')).toBe(before.cv);
    expect(stockQty(d, 'ce', 'p-leche')).toBe(before.ce);
    const o = d.orders.find((x) => x.id === id)!;
    expect(o.status).toBe('recibido_parcial');
    // El saldo se puede recibir después, pero nunca más de lo pendiente.
    expect(() => receiveOrder(d, luis, id, { lines: [{ productId: 'p-leche', packsReceived: 5 }] })).toThrow(/pendiente/);
    receiveOrder(d, luis, id, { lines: [{ productId: 'p-leche', packsReceived: 4 }] });
    expect(o.status).toBe('recibido');
    expect(stockQty(d, 'sf', 'p-leche')).toBe(before.sf + 120000);
  });

  it('un gerente no puede recibir pedidos de otro local ni cancelar tras una recepción', () => {
    const d = fresh();
    const id = milkOrder(d, 4);
    expect(() => receiveOrder(d, { now: NOW, userId: 'u-mariela' }, id, { lines: [{ productId: 'p-leche', packsReceived: 4 }] })).toThrow(DomainError);
    receiveOrder(d, luis, id, { lines: [{ productId: 'p-leche', packsReceived: 2 }] });
    expect(() => cancelOrder(d, antoine, id, 'prueba')).toThrow(DomainError);
  });
});

describe('ventas, recetas e inventario', () => {
  it('una receta descuenta las cantidades correctas: cappuccino = 18 g de café + 150 ml de leche', () => {
    const d = fresh();
    const cafe = stockQty(d, 'sf', 'p-cafe');
    const leche = stockQty(d, 'sf', 'p-leche');
    const otro = stockQty(d, 'cv', 'p-cafe');
    const run = importTickets(d, antoine, 'sf', [ticket('SF-T1', [['CAP', 3], ['ESP', 2]], d)], 'manual');
    expect(run.imported).toBe(1);
    expect(stockQty(d, 'sf', 'p-cafe')).toBeCloseTo(cafe - (3 + 2) * 18, 6);
    expect(stockQty(d, 'sf', 'p-leche')).toBeCloseTo(leche - 3 * 150, 6);
    expect(stockQty(d, 'cv', 'p-cafe')).toBe(otro);
  });

  it('volver a sincronizar los mismos tickets no duplica ventas ni descuentos', () => {
    const d = fresh();
    const tickets = [ticket('SF-T1', [['CAP', 2]], d), ticket('SF-T2', [['LAT', 1], ['CRO', 1]], d)];
    const first = importTickets(d, antoine, 'sf', tickets, 'manual');
    const salesAfterFirst = salesTotals(d, TODAY, TODAY, 'sf');
    const stockAfterFirst = stockQty(d, 'sf', 'p-leche');
    const movementsAfterFirst = d.movements.length;
    const second = importTickets(d, antoine, 'sf', tickets, 'manual');
    expect(first.imported).toBe(2);
    expect(second.imported).toBe(0);
    expect(second.duplicates).toBe(2);
    expect(salesTotals(d, TODAY, TODAY, 'sf')).toEqual(salesAfterFirst);
    expect(stockQty(d, 'sf', 'p-leche')).toBe(stockAfterFirst);
    expect(d.movements.length).toBe(movementsAfterFirst);
  });

  it('la caja simulada devuelve los mismos tickets para una misma ventana, y ventanas contiguas no se solapan', () => {
    const d = fresh();
    const base = { locationId: 'sf' as const, code: 'SF', menu: d.posItems, today: TODAY };
    const a = generateTickets({ ...base, since: addMinutes(NOW, -240), until: NOW });
    const b = generateTickets({ ...base, since: addMinutes(NOW, -240), until: NOW });
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
    const left = generateTickets({ ...base, since: addMinutes(NOW, -240), until: addMinutes(NOW, -100) });
    const right = generateTickets({ ...base, since: addMinutes(NOW, -100), until: NOW });
    expect(left.length + right.length).toBe(a.length);
    expect(new Set([...left, ...right].map((t) => t.id)).size).toBe(a.length);
  });

  it('sincronizar San Francisco importa las ventas pendientes una sola vez', () => {
    const d = fresh();
    const conn = d.posConnections.find((c) => c.locationId === 'sf')!;
    expect(conn.status).toBe('requiere_sync');
    const req = { locationId: 'sf' as const, code: 'SF', menu: d.posItems, today: TODAY, since: addMinutes(conn.lastSyncAt, -30), until: NOW };
    const tickets = generateTickets(req);
    const run = importTickets(d, antoine, 'sf', tickets, 'manual');
    expect(run.imported).toBeGreaterThan(20);
    expect(run.duplicates).toBeGreaterThan(0); // el solape de 30 min ya estaba importado
    expect(run.itemsSold.CAP).toBeGreaterThan(0);
    expect(conn.status).toBe('conectado');
    const again = importTickets(d, antoine, 'sf', generateTickets(req), 'manual');
    expect(again.imported).toBe(0);
  });

  it('un artículo de caja sin receta no descuenta inventario y queda como anomalía', () => {
    const d = fresh();
    const pending = d.undeducted['sf:LIM'].qty;
    const moves = d.movements.length;
    const sales = salesTotals(d, TODAY, TODAY, 'sf').revenueCents;
    const run = importTickets(d, antoine, 'sf', [ticket('SF-T9', [['LIM', 4]], d)], 'manual');
    expect(d.movements.length).toBe(moves);
    expect(run.unmapped.LIM).toBe(4);
    expect(d.undeducted['sf:LIM'].qty).toBe(pending + 4);
    expect(salesTotals(d, TODAY, TODAY, 'sf').revenueCents).toBe(sales + 4 * 350); // el ingreso sí cuenta
  });

  it('al asociar una receta se pueden regularizar las ventas pendientes, con trazabilidad', () => {
    const d = fresh();
    const recipe = saveRecipe(d, antoine, { name: 'Limonada de hierbabuena', ingredients: [{ productId: 'p-limones', qty: 90 }, { productId: 'p-azucar', qty: 15 }] });
    const pendingSf = d.undeducted['sf:LIM'].qty;
    const before = stockQty(d, 'sf', 'p-limones');
    mapPosItem(d, antoine, 'LIM', { kind: 'receta', recipeId: recipe.id }, true);
    expect(stockQty(d, 'sf', 'p-limones')).toBeCloseTo(before - pendingSf * 90, 3);
    expect(Object.values(d.undeducted).filter((u) => u.itemId === 'LIM')).toHaveLength(0);
    expect(d.movements.some((m) => m.refKind === 'regularizacion' && m.locationId === 'sf')).toBe(true);
    // A partir de ahora, la limonada descuenta según su receta.
    const now2 = stockQty(d, 'sf', 'p-limones');
    importTickets(d, antoine, 'sf', [ticket('SF-T10', [['LIM', 2]], d)], 'manual');
    expect(stockQty(d, 'sf', 'p-limones')).toBeCloseTo(now2 - 180, 3);
  });

  it('merma, transferencia y conteo dejan movimientos explícitos', () => {
    const d = fresh();
    const cv = stockQty(d, 'cv', 'p-cafe');
    const sf = stockQty(d, 'sf', 'p-cafe');
    transferStock(d, antoine, { from: 'cv', to: 'sf', productId: 'p-cafe', qty: 2000 });
    expect(stockQty(d, 'cv', 'p-cafe')).toBe(cv - 2000);
    expect(stockQty(d, 'sf', 'p-cafe')).toBe(sf + 2000);
    recordWaste(d, luis, { locationId: 'sf', productId: 'p-cafe', qty: 500, reason: 'Rotura o derrame' });
    expect(stockQty(d, 'sf', 'p-cafe')).toBe(sf + 1500);
    expect(() => recordWaste(d, luis, { locationId: 'sf', productId: 'p-cafe', qty: 9e9, reason: 'x' })).toThrow(DomainError);
    recordCount(d, luis, { locationId: 'sf', lines: [{ productId: 'p-cafe', counted: 12000 }] });
    expect(stockQty(d, 'sf', 'p-cafe')).toBe(12000);
    expect(stockOf(d, 'sf', 'p-cafe')).toBe(12000);
  });
});

describe('facturas y pagos', () => {
  /** Pedido de 10 cajas, recepción de 6 y factura por las 10. */
  function scenario() {
    const d = fresh();
    const orderId = milkOrder(d, 10);
    receiveOrder(d, luis, orderId, { lines: [{ productId: 'p-leche', packsReceived: 6 }] });
    const input = buildInvoiceDocumentForOrder(d, orderId, { now: NOW });
    const { document } = receiveDocument(d, luis, input);
    const invoice = applyExtraction(d, rosa, document.id, simulateExtraction(document)!);
    return { d, orderId, document, invoice };
  }

  it('una factura no modifica el inventario', () => {
    const d = fresh();
    const orderId = milkOrder(d, 10);
    receiveOrder(d, luis, orderId, { lines: [{ productId: 'p-leche', packsReceived: 6 }] });
    const stock = stockQty(d, 'sf', 'p-leche');
    const moves = d.movements.length;
    const input = buildInvoiceDocumentForOrder(d, orderId, { now: NOW });
    const { document } = receiveDocument(d, luis, input);
    const invoice = applyExtraction(d, rosa, document.id, simulateExtraction(document)!);
    correctInvoiceField(d, rosa, invoice.id, 'number', document.printed!.number);
    confirmDueDate(d, rosa, invoice.id);
    validateInvoice(d, rosa, invoice.id, 'Faltante por entregar');
    recordPayment(d, rosa, { invoiceId: invoice.id, date: TODAY, amountCents: 5000, method: 'ach', reference: 'ACH-1' });
    expect(stockQty(d, 'sf', 'p-leche')).toBe(stock);
    expect(d.movements.length).toBe(moves);
  });

  it('detecta que se factura más de lo recibido y vincula pedido y recepción', () => {
    const { d, orderId, invoice } = scenario();
    expect(invoice.orderId).toBe(orderId);
    const a = analyzeInvoice(d, invoice);
    const qty = a.anomalies.find((x) => x.kind === 'cantidad')!;
    expect(qty).toBeTruthy();
    expect(qty.amountCents).toBe(4 * 1740); // 4 cajas × $17.40
    expect(a.receivedValueCents).toBe(6 * 1740);
    expect(a.receptions).toHaveLength(1);
  });

  it('exige confirmar los campos dudosos y el vencimiento propuesto antes de validar', () => {
    const { d, document, invoice } = scenario();
    expect(invoice.dueDateSource).toBe('propuesta');
    expect(invoice.dueDateConfirmed).toBe(false);
    expect(() => validateInvoice(d, rosa, invoice.id, 'ok')).toThrow(DomainError);
    correctInvoiceField(d, rosa, invoice.id, 'number', document.printed!.number);
    expect(invoice.corrections).toHaveLength(1);
    expect(invoice.corrections[0].by).toBe('u-rosa');
    expect(() => validateInvoice(d, rosa, invoice.id, 'ok')).toThrow(/vencimiento/);
    confirmDueDate(d, rosa, invoice.id);
    expect(() => validateInvoice(d, rosa, invoice.id)).toThrow(/diferencias/);
    expect(() => validateInvoice(d, luis, invoice.id, 'ok')).toThrow(/Contabilidad/);
    validateInvoice(d, rosa, invoice.id, 'Se paga lo recibido; el resto al llegar el faltante');
    expect(invoice.status).toBe('validada');
  });

  it('un pago parcial recalcula el saldo y el estado; el pago total salda la factura', () => {
    const { d, document, invoice } = scenario();
    correctInvoiceField(d, rosa, invoice.id, 'number', document.printed!.number);
    confirmDueDate(d, rosa, invoice.id);
    validateInvoice(d, antoine, invoice.id, 'Se paga lo recibido');
    expect(invoice.totalCents).toBe(17400);
    const p = recordPayment(d, antoine, { invoiceId: invoice.id, date: TODAY, amountCents: 10440, method: 'ach', reference: 'ACH-778812' });
    expect(invoice.status).toBe('parcialmente_pagada');
    expect(balanceCents(d, invoice)).toBe(6960);
    expect(() => recordPayment(d, antoine, { invoiceId: invoice.id, date: TODAY, amountCents: 7000, method: 'ach', reference: 'x' })).toThrow(/supera/);
    voidPayment(d, antoine, p.id);
    expect(invoice.status).toBe('validada');
    expect(balanceCents(d, invoice)).toBe(17400);
    recordPayment(d, antoine, { invoiceId: invoice.id, date: TODAY, amountCents: 17400, method: 'cheque', reference: 'CK-1' });
    expect(invoice.status).toBe('pagada');
    expect(balanceCents(d, invoice)).toBe(0);
  });

  it('las cuentas por pagar separan deuda validada, pendiente de validar y en disputa', () => {
    const d = fresh();
    const p = payables(d, 'all', TODAY);
    expect(p.overdue.length).toBeGreaterThan(0);
    expect(p.week.length).toBeGreaterThan(0);
    expect(p.pendingValidation.length).toBeGreaterThan(0);
    expect(p.disputed.length).toBe(1);
    const sumRows = [...p.overdue, ...p.week, ...p.later].reduce((t, r) => t + r.balanceCents, 0);
    expect(p.totals.payableCents).toBe(sumRows);
    for (const r of [...p.overdue, ...p.week, ...p.later]) expect(['validada', 'parcialmente_pagada']).toContain(r.invoice.status);
  });

  it('señala un posible duplicado (proveedor + número + importe) sin borrar nada', () => {
    const d = fresh();
    const dup = d.invoices.find((i) => i.status === 'por_revisar' && findDuplicate(d, i));
    expect(dup).toBeTruthy();
    const count = d.invoices.length;
    expect(analyzeInvoice(d, dup!).anomalies.some((a) => a.kind === 'duplicado')).toBe(true);
    expect(d.invoices.length).toBe(count);
    expect(() => validateInvoice(d, rosa, dup!.id, 'ok')).toThrow(/duplicado/);
  });

  it('una factura capturada a mano, sin líneas, no se vincula a un pedido cualquiera', () => {
    const d = fresh();
    const { document } = receiveDocument(d, rosa, { channel: 'carga_manual', senderId: 'u-rosa', locationId: 'sf', fileName: 'foto.jpg', fingerprint: 'archivo:foto.jpg:1:1', kind: 'archivo' });
    const inv = createManualInvoice(d, rosa, document.id);
    correctInvoiceField(d, rosa, inv.id, 'supplierId', 's-azuero');
    correctInvoiceField(d, rosa, inv.id, 'totalCents', 8450);
    expect(inv.orderId).toBeUndefined();
    expect(analyzeInvoice(d, inv).anomalies.some((x) => x.kind === 'sin_pedido')).toBe(true);
  });

  it('el mismo archivo no se importa dos veces', () => {
    const { d, orderId } = scenario();
    const docs = d.documents.length;
    const again = receiveDocument(d, luis, buildInvoiceDocumentForOrder(d, orderId, { now: NOW, sameFile: true }));
    expect(again.alreadyImported).toBe(true);
    expect(d.documents.length).toBe(docs);
  });
});

describe('filtros e indicadores', () => {
  it('el filtro de local cambia realmente las cifras, y la suma de locales da el total', () => {
    const d = fresh();
    const all = kpis(d, 'all', '30d', TODAY);
    const parts = (['cv', 'sf', 'ce'] as const).map((l) => kpis(d, l, '30d', TODAY));
    expect(parts.reduce((t, k) => t + k.sales.revenueCents, 0)).toBe(all.sales.revenueCents);
    expect(parts.reduce((t, k) => t + k.flow.receivedCents, 0)).toBe(all.flow.receivedCents);
    expect(parts.reduce((t, k) => t + k.stockValueCents, 0)).toBe(all.stockValueCents);
    expect(parts.reduce((t, k) => t + k.belowMin, 0)).toBe(all.belowMin);
    expect(new Set(parts.map((k) => k.sales.revenueCents)).size).toBe(3);
  });

  it('el período cambia realmente las cifras', () => {
    const d = fresh();
    const week = kpis(d, 'all', '7d', TODAY);
    const month = kpis(d, 'all', '30d', TODAY);
    expect(month.sales.revenueCents).toBeGreaterThan(week.sales.revenueCents * 3);
    expect(week.salesDelta).not.toBeNull();
  });

  it('pedidos comprometidos, mercancía recibida, facturas y pagos son cifras distintas', () => {
    const d = fresh();
    const before = kpis(d, 'sf', '30d', TODAY).flow;
    const id = milkOrder(d, 10);
    const afterOrder = kpis(d, 'sf', '30d', TODAY).flow;
    expect(afterOrder.committedCents).toBe(before.committedCents + orderTotals(d.orders.find((o) => o.id === id)!).subtotalCents);
    expect(afterOrder.receivedCents).toBe(before.receivedCents);
    expect(afterOrder.invoicedCents).toBe(before.invoicedCents);
    receiveOrder(d, luis, id, { lines: [{ productId: 'p-leche', packsReceived: 10 }] });
    const afterReception = kpis(d, 'sf', '30d', TODAY).flow;
    expect(afterReception.committedCents).toBe(before.committedCents);
    expect(afterReception.receivedCents).toBe(before.receivedCents + 17400);
    expect(afterReception.paidCents).toBe(before.paidCents);
  });

  it('la sugerencia de reabastecimiento de San Francisco propone leche a La Pradera', () => {
    const d = fresh();
    const s = suggestions(d, 'sf', TODAY);
    expect(s[0].supplier.id).toBe('s-pradera');
    expect(s[0].lines[0].product.id).toBe('p-leche');
    expect(s[0].lines[0].packs).toBeGreaterThan(4);
  });
});
