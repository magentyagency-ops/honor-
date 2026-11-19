import type { DemoData, ID } from '@/domain/types';
import { days as fmtDays, money, money0, packs as fmtPacks, plural, qty as fmtQty } from '@/domain/format';
import { fmtAgo, fmtDate, panamaDay } from '@/domain/time';
import { orderTotals } from '@/domain/core';
import { clearCart, receiveOrder, setCartQty, submitCart } from '@/domain/purchasing';
import { analyzeInvoice, balanceCents, confirmDueDate, confirmInvoiceField, correctInvoiceField, paidCents, recordPayment, validateInvoice } from '@/domain/invoices';
import { stockQty, stockRows, suggestions } from '@/domain/selectors';
import { paymentReference } from '@/data/seed';
import { processDocument, run, sendOrderViaWhatsApp, setSession, simulateInbound, syncPos, type TourState } from '@/store';

/** Herramientas que el motor del recorrido da a cada paso. */
export interface StepCtx {
  d: () => DemoData;
  tour: () => TourState;
  nav: (to: string) => void;
  setIds: (patch: TourState['ids']) => void;
  setFacts: (patch: Record<string, number>) => void;
  /** Señala un control y simula la pulsación (se omite en avance rápido). */
  press: (selector: string) => Promise<void>;
  pause: (ms: number) => Promise<void>;
  instant: boolean;
}

export interface StepView {
  text: (c: StepCtx) => string;
  /** Selector del elemento que se resalta. */
  target: (c: StepCtx) => string | null;
  /** Lleva la interfaz al lugar donde se ve este momento. Debe poder repetirse sin efectos. */
  view: (c: StepCtx) => void;
}

export interface TourStep {
  id: string;
  title: string;
  /** Perfil que actúa en este paso. */
  actor: ID;
  before: StepView;
  action?: { label: string; run: (c: StepCtx) => Promise<void>; done: (c: StepCtx) => boolean };
  /** Lo que se muestra una vez hecha la acción. */
  after?: StepView;
}

const SF = 'sf' as const;
const MILK = 'p-leche';
const SUPPLIER = 's-pradera';
const NOTE = 'Faltan cajas de leche. El repartidor indica que el resto sale mañana.';
const RESOLUTION = 'Falta mercancía por entregar: se paga solo lo recibido y el resto al llegar el faltante.';

const today = (_c?: StepCtx) => panamaDay(new Date().toISOString());
const product = (c: StepCtx, id: ID) => c.d().products.find((p) => p.id === id)!;
const order = (c: StepCtx) => c.d().orders.find((o) => o.id === c.tour().ids.orderId);
const invoice = (c: StepCtx) => c.d().invoices.find((i) => i.id === c.tour().ids.invoiceId);
const milkRow = (c: StepCtx) => stockRows(c.d(), today(c), SF).find((r) => r.product.id === MILK)!;
const milkPack = (c: StepCtx) => product(c, MILK).offer.pack;
const orderedMilk = (c: StepCtx) => order(c)?.lines.find((l) => l.productId === MILK)?.packs ?? c.tour().facts.ordered ?? 12;
/** Cajas de leche que «llegan» en la recepción parcial: faltan aproximadamente un tercio. */
const receivedMilk = (c: StepCtx) => {
  const ordered = orderedMilk(c);
  return ordered - Math.max(1, Math.ceil(ordered / 3));
};
const orderPath = (c: StepCtx) => `/compras/pedidos/${c.tour().ids.orderId}`;
const invoicePath = (c: StepCtx) => `/facturas/${c.tour().ids.invoiceId}`;

export const STEPS: TourStep[] = [
  // 1 ────────────────────────────────────────────────────────────────
  {
    id: 'riesgo',
    title: 'Antoine detecta el riesgo de quiebre',
    actor: 'u-antoine',
    before: {
      view: (c) => {
        setSession({ locationFilter: 'all' });
        c.nav('/resumen');
      },
      target: () => '[data-tour="alerta-leche"]',
      text: (c) => {
        const r = milkRow(c);
        return `El resumen pone delante lo urgente. En San Francisco quedan ${fmtQty(r.qty, 'ml')} de leche, ${r.coverageDays !== null ? fmtDays(r.coverageDays) : 'menos de un día'} de cobertura, y no hay ningún pedido en curso. Hasta ahora, esto se descubría cuando ya no quedaba leche.`;
      },
    },
  },
  // 2 ────────────────────────────────────────────────────────────────
  {
    id: 'sugerencia',
    title: 'Abre la sugerencia de reabastecimiento',
    actor: 'u-antoine',
    before: {
      view: (c) => {
        setSession({ locationFilter: 'all' });
        c.nav('/resumen');
      },
      target: () => '[data-tour="alerta-leche-cta"]',
      text: () => 'Cada alerta lleva a su solución. Desde aquí, un clic abre la sugerencia de pedido para ese local y ese proveedor, ya calculada.',
    },
    action: {
      label: 'Preparar pedido',
      // También cuenta si quien presenta pulsó él mismo «Preparar pedido» en la alerta.
      done: (c) => c.tour().facts.s2 === 1 || Boolean(order(c)) || (window.location.pathname === '/compras' && window.location.search.includes(`sugerencia=${SUPPLIER}`)),
      run: async (c) => {
        await c.press('[data-tour="alerta-leche-cta"]');
        setSession({ locationFilter: SF });
        c.setFacts({ s2: 1 });
        c.nav(`/compras?sugerencia=${SUPPLIER}`);
      },
    },
    after: {
      view: (c) => {
        setSession({ locationFilter: SF });
        c.nav(`/compras?sugerencia=${SUPPLIER}`);
      },
      target: () => `[data-tour="sugerencia-linea-${MILK}"]`,
      text: (c) => {
        const s = suggestions(c.d(), SF, today(c)).find((x) => x.supplier.id === SUPPLIER);
        const l = s?.lines.find((x) => x.product.id === MILK);
        if (!s || !l) return 'La sugerencia parte del consumo real de cada producto y de lo que ya está pedido.';
        const others = s.lines.filter((x) => x.product.id !== MILK).map((x) => x.product.name.toLowerCase());
        return `Propone ${fmtPacks(l.packs, milkPack(c))} de leche a Lácteos La Pradera: con un consumo de ${fmtQty(l.avgDaily, 'ml')} al día, lleva el stock a su nivel objetivo.${others.length ? ` De paso sugiere ${others.join(' y ')}, que también está justo.` : ''}`;
      },
    },
  },
  // 3 ────────────────────────────────────────────────────────────────
  {
    id: 'pedido',
    title: 'Ajusta y valida el pedido',
    actor: 'u-antoine',
    before: {
      view: (c) => {
        setSession({ locationFilter: SF });
        c.nav(`/compras?sugerencia=${SUPPLIER}`);
      },
      target: () => '[data-tour="sugerencia-add"]',
      text: () => 'Antoine acepta la sugerencia y sube la leche en dos cajas, pensando en el fin de semana. La cantidad es suya: la plataforma propone, él decide.',
    },
    action: {
      label: 'Ajustar y validar',
      done: (c) => Boolean(order(c)),
      run: async (c) => {
        const s = suggestions(c.d(), SF, today(c)).find((x) => x.supplier.id === SUPPLIER);
        const lines = s ? s.lines.map((l) => ({ id: l.product.id, packs: l.packs })) : [{ id: MILK, packs: 10 }];
        const milk = lines.find((l) => l.id === MILK)?.packs ?? 10;
        await c.press('[data-tour="sugerencia-add"]');
        run((d) => {
          clearCart(d, SF);
          for (const l of lines) setCartQty(d, SF, l.id, l.packs);
        });
        c.nav('/compras');
        await c.pause(1000);
        await c.press(`[data-tour="cart-qty-${MILK}"]`);
        run((d) => setCartQty(d, SF, MILK, milk + 1));
        await c.pause(380);
        run((d) => setCartQty(d, SF, MILK, milk + 2));
        await c.pause(1000);
        await c.press('[data-tour="cart-submit"]');
        const ids = run((d, ctx) => submitCart(d, ctx, SF, { origin: 'sugerencia' }), 'u-antoine');
        const orderId = ids.find((id) => c.d().orders.find((o) => o.id === id)?.supplierId === SUPPLIER) ?? ids[0];
        c.setIds({ orderId });
        c.setFacts({ suggested: milk, ordered: milk + 2 });
        c.nav(`/compras/pedidos/${orderId}`);
      },
    },
    after: {
      view: (c) => c.nav(orderPath(c)),
      target: () => '[data-tour="pedido-progreso"]',
      text: (c) => {
        const o = order(c);
        if (!o) return '';
        return `Pedido ${o.id} creado por ${money(orderTotals(o).totalCents)}. Lo valida Antoine, así que queda aprobado. Si lo hubiera hecho un gerente por más de ${money0(c.d().settings.approvalThresholdCents)}, habría esperado su aprobación.`;
      },
    },
  },
  // 4 ────────────────────────────────────────────────────────────────
  {
    id: 'whatsapp',
    title: 'El mensaje de WhatsApp, listo y enviado',
    actor: 'u-antoine',
    before: {
      view: (c) => c.nav(orderPath(c)),
      target: () => '[data-tour="wa-panel"]',
      text: () => 'El mensaje al proveedor ya está redactado: local, referencia, artículos, cantidades y fecha de entrega. Nadie tiene que teclearlo ni buscar el contacto.',
    },
    action: {
      label: 'Simular envío',
      done: (c) => ['confirmado', 'recibido_parcial', 'recibido'].includes(order(c)?.status ?? ''),
      run: async (c) => {
        const id = c.tour().ids.orderId!;
        await c.press('[data-tour="wa-send"]');
        await sendOrderViaWhatsApp(id, { instant: c.instant });
      },
    },
    after: {
      view: (c) => c.nav(orderPath(c)),
      target: () => '[data-tour="wa-panel"]',
      text: () => 'Enviado y confirmado por el proveedor (respuesta simulada: en la demostración no sale ningún mensaje). El pedido queda trazado; el inventario todavía no cambia.',
    },
  },
  // 5 ────────────────────────────────────────────────────────────────
  {
    id: 'recepcion',
    title: 'El gerente registra una recepción parcial',
    actor: 'u-luis',
    before: {
      view: (c) => c.nav(`${orderPath(c)}?recepcion=1&llegaron=${MILK}:${receivedMilk(c)}&nota=${encodeURIComponent(NOTE)}`),
      target: () => `[data-tour="recepcion-linea-${MILK}"]`,
      text: (c) =>
        `Al día siguiente, Luis recibe la entrega en San Francisco. De las ${orderedMilk(c)} cajas de leche llegaron ${receivedMilk(c)}: lo indica en su teléfono, con un toque por producto.`,
    },
    action: {
      label: 'Confirmar recepción',
      done: (c) => Boolean(c.d().receptions.find((r) => r.id === c.tour().ids.receptionId)),
      run: async (c) => {
        const o = order(c)!;
        const received = receivedMilk(c);
        c.setFacts({ milkBefore: stockQty(c.d(), SF, MILK), received });
        await c.press('[data-tour="recepcion-confirmar"]');
        const rec = run(
          (d, ctx) =>
            receiveOrder(d, ctx, o.id, {
              lines: o.lines.map((l) => ({ productId: l.productId, packsReceived: l.productId === MILK ? received : l.packs })),
              note: NOTE,
            }),
          'u-luis',
        );
        c.setIds({ receptionId: rec.id });
        c.nav(orderPath(c));
      },
    },
    after: {
      view: (c) => c.nav(orderPath(c)),
      target: () => '[data-tour="pedido-recepciones"]',
      text: (c) =>
        `Recepción ${c.tour().ids.receptionId} registrada. El pedido queda «recibido parcialmente»: faltan ${fmtPacks(orderedMilk(c) - (c.tour().facts.received ?? receivedMilk(c)), milkPack(c))}, que se podrán recibir después o dar por perdidas.`,
    },
  },
  // 6 ────────────────────────────────────────────────────────────────
  {
    id: 'stock',
    title: 'El stock sube exactamente lo recibido',
    actor: 'u-luis',
    before: {
      view: (c) => c.nav(`/inventario?producto=${MILK}&en=${SF}`),
      target: () => '[data-tour="producto-existencia"]',
      text: (c) => {
        const f = c.tour().facts;
        const received = f.received ?? receivedMilk(c);
        const before = f.milkBefore ?? 0;
        return `Leche en San Francisco: de ${fmtQty(before, 'ml')} a ${fmtQty(before + received * milkPack(c).baseQty, 'ml')} tras la entrega. Entraron ${received} cajas × 12 L, no las ${orderedMilk(c)} pedidas. Solo la recepción suma inventario; ni el pedido ni la factura lo hacen.`;
      },
    },
  },
  // 7 ────────────────────────────────────────────────────────────────
  {
    id: 'sync',
    title: 'La caja sincroniza sus ventas',
    actor: 'u-antoine',
    before: {
      view: (c) => {
        setSession({ locationFilter: 'all' });
        c.nav('/ventas');
      },
      target: () => '[data-tour="caja-sf"]',
      text: (c) => {
        const conn = c.d().posConnections.find((x) => x.locationId === SF)!;
        return `La caja de San Francisco lleva ${fmtAgo(conn.lastSyncAt, new Date().toISOString()).replace('hace ', '')} sin enviar ventas: lo vendido desde entonces aún no descuenta inventario. Al sincronizar llegan los tickets pendientes.`;
      },
    },
    action: {
      label: 'Sincronizar ventas',
      done: (c) => Boolean(c.d().syncRuns.find((r) => r.id === c.tour().ids.syncId)),
      run: async (c) => {
        await c.press('[data-tour="caja-sf-sync"]');
        const r = await syncPos(SF, { instant: c.instant });
        if (!r) return;
        c.setIds({ syncId: r.id });
        c.nav(`/ventas?sync=${r.id}`);
      },
    },
    after: {
      view: (c) => c.nav(`/ventas?sync=${c.tour().ids.syncId}`),
      target: () => '[data-tour="sync-resumen"]',
      text: (c) => {
        const r = c.d().syncRuns.find((x) => x.id === c.tour().ids.syncId);
        if (!r) return '';
        const cap = r.itemsSold.CAP ?? 0;
        return `${plural(r.imported, 'ticket nuevo', 'tickets nuevos')}, con ${plural(cap, 'cappuccino', 'cappuccinos')}. La caja reenvió además ${plural(r.duplicates, 'ticket que ya estaba', 'tickets que ya estaban')} importados: se reconocen por su identificador y no se cuentan dos veces.`;
      },
    },
  },
  // 8 ────────────────────────────────────────────────────────────────
  {
    id: 'recetas',
    title: 'Café y leche se descuentan según las recetas',
    actor: 'u-antoine',
    before: {
      view: (c) => c.nav(`/ventas?sync=${c.tour().ids.syncId}`),
      target: (c) => {
        const r = c.d().syncRuns.find((x) => x.id === c.tour().ids.syncId);
        return r?.itemsSold.CAP ? '[data-tour="sync-item-CAP"]' : '[data-tour="sync-recetas"]';
      },
      text: (c) => {
        const r = c.d().syncRuns.find((x) => x.id === c.tour().ids.syncId);
        if (!r) return '';
        const cap = r.itemsSold.CAP ?? 0;
        const cafe = r.consumption.find((x) => x.productId === 'p-cafe')?.qty ?? 0;
        const leche = r.consumption.find((x) => x.productId === MILK)?.qty ?? 0;
        return `Cada cappuccino consume 18 g de café y 150 ml de leche: ${cap} vendidos son ${fmtQty(cap * 18, 'g')} y ${fmtQty(cap * 150, 'ml')}. Sumando todos los artículos, esta sincronización descuenta ${fmtQty(cafe, 'g')} de café y ${fmtQty(leche, 'ml')} de leche en San Francisco, y en ningún otro local.`;
      },
    },
  },
  // 9 ────────────────────────────────────────────────────────────────
  {
    id: 'factura',
    title: 'Llega la factura por WhatsApp',
    actor: 'u-antoine',
    before: {
      view: (c) => {
        let docId = c.tour().ids.documentId;
        if (!docId || !c.d().documents.some((x) => x.id === docId)) {
          const res = simulateInbound('pedido', { orderId: c.tour().ids.orderId });
          if (!res) return;
          docId = res.documentId;
          c.setIds({ documentId: docId });
        }
        setSession({ locationFilter: 'all' });
        c.nav(`/facturas?doc=${docId}`);
      },
      target: (c) => `[data-tour="doc-nuevo"], [data-tour="doc-${c.tour().ids.documentId}"]`,
      text: () => 'Luis fotografía la factura de La Pradera y la envía, como hace hoy. La diferencia: llega a una bandeja común, con su remitente y su local, en lugar de perderse en un chat.',
    },
    action: {
      label: 'Procesar factura',
      done: (c) => Boolean(invoice(c)),
      run: async (c) => {
        const docId = c.tour().ids.documentId!;
        await c.press(`[data-tour="doc-nuevo"], [data-tour="doc-${docId}"]`);
        c.nav(`/facturas/${docId}`);
        await c.pause(800);
        const invId = await processDocument(docId, { instant: c.instant });
        if (!invId) return;
        c.setIds({ invoiceId: invId });
        c.nav(`/facturas/${invId}`);
      },
    },
    after: {
      view: (c) => c.nav(invoicePath(c)),
      target: () => '[data-tour="campo-number"]',
      text: () => 'Proveedor, número, fechas, importes y líneas salen del documento. Lo dudoso se marca: el número se leyó con poca confianza porque la foto salió movida. Nada se da por bueno sin mostrarlo.',
    },
  },
  // 10 ───────────────────────────────────────────────────────────────
  {
    id: 'diferencia',
    title: 'La factura no coincide con lo recibido',
    actor: 'u-antoine',
    before: {
      view: (c) => c.nav(invoicePath(c)),
      target: () => '[data-tour="anomalia-cantidad"]',
      text: (c) => {
        const inv = invoice(c);
        if (!inv) return '';
        const a = analyzeInvoice(c.d(), inv);
        const m = a.lines.find((l) => l.line.productId === MILK);
        const diff = a.anomalies.find((x) => x.kind === 'cantidad');
        return `La plataforma cruza pedido, recepción y factura. Se facturan ${m?.line.packs ?? '—'} cajas de leche y solo llegaron ${m?.receivedPacks ?? '—'}: ${diff?.amountCents ? money(diff.amountCents) : 'una diferencia'} de más. Con las fotos en WhatsApp y una hoja de cálculo, se habría pagado el total.`;
      },
    },
  },
  // 11 ───────────────────────────────────────────────────────────────
  {
    id: 'validar',
    title: 'Antoine verifica la factura y su vencimiento',
    actor: 'u-antoine',
    before: {
      view: (c) => c.nav(invoicePath(c)),
      target: () => '[data-tour="campo-number"]',
      text: () => 'Corrige el número mal leído, confirma el vencimiento que la plataforma propone a partir de las condiciones del proveedor y valida la factura dejando escrito cómo se resuelve la diferencia.',
    },
    action: {
      label: 'Verificar y validar',
      done: (c) => ['validada', 'parcialmente_pagada', 'pagada'].includes(invoice(c)?.status ?? ''),
      run: async (c) => {
        const inv = invoice(c)!;
        if (inv.status !== 'por_revisar') return;
        const printed = c.d().documents.find((x) => x.id === inv.documentId)?.printed;
        await c.press('[data-tour="campo-number"]');
        if (printed && inv.number !== printed.number) run((d, ctx) => correctInvoiceField(d, ctx, inv.id, 'number', printed.number), 'u-antoine');
        else run((d, ctx) => confirmInvoiceField(d, ctx, inv.id, 'number'), 'u-antoine');
        await c.pause(1000);
        if (!invoice(c)!.dueDateConfirmed) {
          await c.press('[data-tour="confirmar-vencimiento"]');
          run((d, ctx) => confirmDueDate(d, ctx, inv.id), 'u-antoine');
          await c.pause(1000);
        }
        await c.press('[data-tour="validar-factura"]');
        run((d, ctx) => validateInvoice(d, ctx, inv.id, RESOLUTION), 'u-antoine');
      },
    },
    after: {
      view: (c) => c.nav(invoicePath(c)),
      target: () => '[data-tour="factura-pagos"]',
      text: (c) => {
        const inv = invoice(c);
        if (!inv) return '';
        return `Factura validada: ya es deuda reconocida y entra en el calendario de pagos. Vence el ${fmtDate(inv.dueDate)}. La corrección del número y la decisión sobre la diferencia quedan en su trazabilidad.`;
      },
    },
  },
  // 12 ───────────────────────────────────────────────────────────────
  {
    id: 'pago',
    title: 'Un pago parcial reduce el saldo',
    actor: 'u-antoine',
    before: {
      view: (c) => {
        const inv = invoice(c);
        if (!inv) return;
        const rest = Math.max(0, analyzeInvoice(c.d(), inv).receivedValueCents - paidCents(c.d(), inv.id));
        c.nav(`${invoicePath(c)}?pagar=1&importe=${rest}`);
      },
      target: () => '[data-tour="pago-importe"]',
      text: (c) => {
        const inv = invoice(c);
        if (!inv) return '';
        const rest = Math.max(0, analyzeInvoice(c.d(), inv).receivedValueCents - paidCents(c.d(), inv.id));
        return `Antoine paga solo lo que llegó: ${money(rest)} de ${money(inv.totalCents)}. Registra el pago que hizo por su banco; la plataforma no mueve dinero.`;
      },
    },
    action: {
      label: 'Registrar pago parcial',
      done: (c) => Boolean(c.d().payments.find((p) => p.id === c.tour().ids.paymentId && !p.voidedAt)),
      run: async (c) => {
        const inv = invoice(c)!;
        const rest = Math.max(0, analyzeInvoice(c.d(), inv).receivedValueCents - paidCents(c.d(), inv.id));
        const amount = Math.min(rest || balanceCents(c.d(), inv), balanceCents(c.d(), inv));
        await c.press('[data-tour="pago-confirmar"]');
        const p = run(
          (d, ctx) => recordPayment(d, ctx, { invoiceId: inv.id, date: panamaDay(ctx.now), amountCents: amount, method: 'ach', reference: paymentReference('ach', `${inv.id}:0`) }),
          'u-antoine',
        );
        c.setIds({ paymentId: p.id });
        c.nav(invoicePath(c));
      },
    },
    after: {
      view: (c) => c.nav(invoicePath(c)),
      target: () => '[data-tour="factura-saldo"]',
      text: (c) => {
        const inv = invoice(c);
        if (!inv) return '';
        const paid = paidCents(c.d(), inv.id);
        return `Total ${money(inv.totalCents)} · pagado ${money(paid)} · saldo ${money(inv.totalCents - paid)}. La factura pasa a «parcialmente pagada» y el saldo sigue visible, con su vencimiento, hasta que llegue la leche que falta.`;
      },
    },
  },
];
