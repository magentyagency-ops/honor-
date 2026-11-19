import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ArrowLeft, Ban, Check, CheckCheck, ClipboardCheck, FileText, FlaskConical, Hourglass, Info, MapPin, PackageCheck, PackageOpen,
  Send, ShieldCheck, TriangleAlert, Truck,
} from 'lucide-react';
import type { ID, PurchaseOrder, ReceptionIssue } from '@/domain/types';
import { orderTotals, lineSubtotal, userName } from '@/domain/core';
import { money, money0, packs as fmtPacks, plural, qty as fmtQty } from '@/domain/format';
import { fmtDate, fmtDateTime, fmtDayLong, fmtWhen } from '@/domain/time';
import {
  approveOrder, canCancel, canEditLines, canReceive, cancelOrder, closeOrderShort, confirmOrder, pendingLines, receiveOrder,
  submitDraft, updateOrderLines,
} from '@/domain/purchasing';
import { act, processDocument, simulateInbound, toast, useDemo, useNow, useUser } from '@/store';
import { useQuery } from '@/lib/useQuery';
import { Badge, Button, EmptyState, Field, LocationTag, Note, Panel, PanelHeader, Select, Stepper, Table, Td, Textarea, Th, Tr, cn } from '@/ui/primitives';
import { ConfirmDialog, Drawer, Modal } from '@/ui/overlays';
import { InvoiceStatusBadge, OrderStatusBadge } from '@/ui/status';
import { WhatsAppThread } from './WhatsAppThread';

const ISSUE_LABEL: Record<ReceptionIssue, string> = {
  faltante: 'No llegó (faltante)',
  danado: 'Llegó dañado',
  rechazado: 'Rechazado por calidad',
};

// ───────────────────────────── Línea de tiempo del pedido ─────────────────────────────

function Progress({ order, lastReceptionAt }: { order: PurchaseOrder; lastReceptionAt?: string }) {
  const data = useDemo((s) => s.data);
  const now = useNow();
  const st = order.status;
  const cancelled = st === 'cancelado';
  const rank = { borrador: 0, pendiente_aprobacion: 0, aprobado: 1, enviado: 2, confirmado: 3, recibido_parcial: 3, recibido: 4, cancelado: -1 }[st];
  const steps = [
    { label: 'Creado', at: order.createdAt, by: userName(data, order.createdBy) },
    {
      label: st === 'pendiente_aprobacion' ? 'Esperando aprobación' : 'Aprobado',
      at: order.approvedAt,
      by: order.approvedBy ? (order.approvedBy === 'sistema' ? 'Automática (bajo el umbral)' : userName(data, order.approvedBy)) : undefined,
      pending: st === 'pendiente_aprobacion',
    },
    { label: 'Enviado', at: order.sentAt, by: order.sentAt ? 'WhatsApp simulado' : undefined },
    { label: 'Confirmado', at: order.confirmedAt, by: order.confirmedAt ? 'Proveedor' : undefined },
    {
      label: st === 'recibido_parcial' ? 'Recibido parcialmente' : order.closedShort ? 'Recibido con faltante' : 'Recibido',
      at: lastReceptionAt,
      pending: st === 'recibido_parcial',
    },
  ];
  return (
    <ol className="grid grid-cols-2 gap-x-2 gap-y-4 sm:grid-cols-5" aria-label="Estado del pedido" data-tour="pedido-progreso">
      {steps.map((s, i) => {
        const done = !cancelled && (i === 0 || i <= rank) && !s.pending;
        const current = !cancelled && s.pending;
        return (
          <li key={i} className="relative min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-[11.5px] font-semibold ring-1 ring-inset',
                  done ? 'bg-forest-700 text-paper ring-forest-700' : current ? 'bg-warn-50 text-warn-800 ring-warn-500' : 'bg-paper text-ink-4 ring-line-strong',
                )}
              >
                {done ? <Check className="size-3.5" strokeWidth={3} /> : current ? <Hourglass className="size-3" /> : i + 1}
              </span>
              <span aria-hidden className={cn('hidden h-px flex-1 sm:block', i === steps.length - 1 && 'sm:hidden', done && i < rank ? 'bg-forest-600' : 'bg-line-strong')} />
            </div>
            <p className={cn('mt-2 text-[13px] font-medium leading-tight', done || current ? 'text-ink' : 'text-ink-3')}>{s.label}</p>
            <p className="mt-0.5 text-[12px] leading-snug text-ink-3">
              {s.at && (done || current || i === 0) ? fmtWhen(s.at, now) : current ? 'Pendiente' : '—'}
              {s.by && (done || current) && <span className="block truncate">{s.by}</span>}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

// ───────────────────────────── Recepción ─────────────────────────────

function ReceptionDrawer({ order, open, onClose }: { order: PurchaseOrder; open: boolean; onClose: () => void }) {
  const data = useDemo((s) => s.data);
  const user = useUser();
  const pend = pendingLines(data, order).filter((p) => p.pending > 0);
  const [received, setReceived] = useState<Record<ID, number>>({});
  const [issues, setIssues] = useState<Record<ID, ReceptionIssue>>({});
  const [note, setNote] = useState('');

  // Cantidades iniciales opcionales (?llegaron=p-leche:8): las usan el recorrido guiado y la vista móvil.
  const [params] = useSearchParams();
  const preset = params.get('llegaron') ?? '';
  const presetNote = params.get('nota') ?? '';
  useEffect(() => {
    if (!open) return;
    const initial: Record<ID, number> = {};
    for (const part of preset.split(',')) {
      const [pid, n] = part.split(':');
      if (pid && Number.isFinite(Number(n))) initial[pid] = Number(n);
    }
    setReceived(initial);
    setIssues({});
    setNote(presetNote);
  }, [open, order.id, preset, presetNote]);

  const got = (id: ID, pending: number) => received[id] ?? pending;
  const supplier = data.suppliers.find((s) => s.id === order.supplierId)!;
  const loc = data.locations.find((l) => l.id === order.locationId)!;
  const anyShort = pend.some((p) => got(p.line.productId, p.pending) < p.pending);
  const blocked =
    user.role === 'contabilidad' ? 'Contabilidad no registra recepciones.'
    : user.role === 'gerente' && user.locationId !== order.locationId ? 'Solo el gerente del local puede registrar la recepción.'
    : false;

  const submit = () => {
    const res = act((d, ctx) =>
      receiveOrder(d, ctx, order.id, {
        lines: pend.map((p) => ({ productId: p.line.productId, packsReceived: got(p.line.productId, p.pending), issue: issues[p.line.productId] })),
        note,
      }),
    );
    if (res.ok) {
      toast('ok', anyShort ? 'Recepción parcial registrada' : 'Recepción registrada', 'El inventario aumentó exactamente en la cantidad recibida.');
      onClose();
    }
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => !o && onClose()}
      width="lg"
      tourId="recepcion-panel"
      eyebrow={`Recepción · ${order.id}`}
      title={`¿Qué llegó de ${supplier.name}?`}
      description={`Confirma las cantidades realmente recibidas en ${loc.name}. Solo lo que confirmes aquí entra en el inventario.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="lg" onClick={submit} disabledReason={blocked} icon={<PackageCheck className="size-[18px]" />} data-tour="recepcion-confirmar">
            Confirmar recepción
          </Button>
        </>
      }
    >
      <ul className="space-y-3">
        {pend.map((p) => {
          const product = data.products.find((x) => x.id === p.line.productId)!;
          const n = got(product.id, p.pending);
          const short = n < p.pending;
          return (
            <li key={product.id} data-tour={`recepcion-linea-${product.id}`} className={cn('rounded-xl border p-4 transition-colors', short ? 'border-warn-500/50 bg-warn-50/60' : 'border-line bg-white/60')}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1 basis-[200px]">
                  <p className="text-[14.5px] font-medium text-ink">{product.name}</p>
                  <p className="text-[12.5px] text-ink-3">
                    {p.line.packLabel} · se esperan {fmtPacks(p.pending, product.offer.pack)}
                    {p.received > 0 && ` (ya recibidas ${p.received})`}
                  </p>
                </div>
                <Stepper size="lg" label={`Recibido de ${product.name}`} value={n} max={p.pending} onChange={(v) => setReceived((r) => ({ ...r, [product.id]: v }))} />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line/80 pt-3 text-[12.5px]">
                <p className="text-ink-2">
                  Entran en inventario:{' '}
                  <strong className="font-semibold text-ink">
                    {fmtPacks(n, product.offer.pack)} = {fmtQty(n * p.line.packBaseQty, product.baseUnit)}
                  </strong>
                </p>
                {short ? (
                  <label className="flex items-center gap-2 text-warn-800">
                    <TriangleAlert className="size-3.5" />
                    <span className="font-medium">Faltan {fmtPacks(p.pending - n, product.offer.pack)}</span>
                    <Select
                      value={issues[product.id] ?? 'faltante'}
                      onChange={(e) => setIssues((x) => ({ ...x, [product.id]: e.target.value as ReceptionIssue }))}
                      aria-label={`Motivo del faltante de ${product.name}`}
                      className="h-8 w-auto text-[12.5px]"
                    >
                      {Object.entries(ISSUE_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </Select>
                  </label>
                ) : (
                  <span className="inline-flex items-center gap-1 font-medium text-ok-700">
                    <Check className="size-3.5" strokeWidth={3} /> Completo
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <Field label="Nota de la recepción (opcional)" htmlFor="nota-recepcion" className="mt-4">
        <Textarea id="nota-recepcion" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Por ejemplo: el repartidor indica que el resto llega mañana." />
      </Field>
      <Note tone="forest" icon={<Info className="size-4" />} className="mt-4">
        Si falta algo, el pedido queda como <strong>recibido parcialmente</strong>: podrás registrar el resto cuando llegue o cerrarlo con faltante.
      </Note>
    </Drawer>
  );
}

// ───────────────────────────── Página ─────────────────────────────

export function OrderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const data = useDemo((s) => s.data);
  const awaiting = useDemo((s) => (id ? s.ui.awaitingReply[id] : false));
  const user = useUser();
  const [rec] = useQuery<string>('recepcion', '');
  const setRec = (v: string | null) => navigate(v ? `/compras/pedidos/${id}?recepcion=1` : `/compras/pedidos/${id}`, { replace: true });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);

  const order = data.orders.find((o) => o.id === id);
  if (!order) {
    return (
      <EmptyState title="Pedido no encontrado" action={<Button onClick={() => navigate('/compras?vista=pedidos')}>Volver a pedidos</Button>}>
        El pedido {id} no existe en los datos actuales de la demostración.
      </EmptyState>
    );
  }

  const supplier = data.suppliers.find((s) => s.id === order.supplierId)!;
  const loc = data.locations.find((l) => l.id === order.locationId)!;
  const totals = orderTotals(order);
  const lines = pendingLines(data, order);
  const receptions = data.receptions.filter((r) => r.orderId === order.id);
  const invoices = data.invoices.filter((i) => i.orderId === order.id);
  const rawDoc = data.documents.find((x) => !x.invoiceId && x.printed?.orderRef === order.id);
  const editable = canEditLines(order) && user.role !== 'contabilidad' && (user.role === 'direccion' || user.id === order.createdBy);
  const isOps = user.role !== 'contabilidad';
  const ownLocation = user.role !== 'gerente' || user.locationId === order.locationId;

  const setLine = (productId: ID, packs: number) =>
    act((d, ctx) => updateOrderLines(d, ctx, order.id, order.lines.map((l) => ({ productId: l.productId, packs: l.productId === productId ? packs : l.packs }))));

  // Acción principal según el estado
  let next: { title: string; text: string; actions: React.ReactNode } | null = null;
  if (order.status === 'borrador') {
    next = {
      title: 'Borrador sin enviar',
      text: 'Ajusta las cantidades y envíalo a validación. Mientras sea un borrador no compromete ninguna compra.',
      actions: (
        <Button variant="primary" block onClick={() => act((d, ctx) => submitDraft(d, ctx, order.id), 'Pedido enviado a validación')} disabledReason={!isOps && 'Contabilidad consulta las compras en modo lectura.'}>
          Enviar a validación
        </Button>
      ),
    };
  } else if (order.status === 'pendiente_aprobacion') {
    next = {
      title: 'Requiere la aprobación de Dirección',
      text: `Supera el umbral de ${money0(data.settings.approvalThresholdCents)} definido en la regla de aprobación.`,
      actions:
        user.role === 'direccion' ? (
          <div className="flex gap-2">
            <Button variant="primary" className="flex-1" icon={<ShieldCheck className="size-4" />} onClick={() => act((d, ctx) => approveOrder(d, ctx, order.id), 'Pedido aprobado: ya se puede enviar al proveedor')} data-tour="pedido-aprobar">
              Aprobar
            </Button>
            <Button variant="danger" onClick={() => { setReason('Rechazado por Dirección'); setCancelOpen(true); }}>
              Rechazar
            </Button>
          </div>
        ) : (
          <Note tone="warn" icon={<Hourglass className="size-4" />}>A la espera de Antoine. Recibirá el aviso en su resumen.</Note>
        ),
    };
  } else if (order.status === 'aprobado') {
    next = {
      title: 'Listo para enviar al proveedor',
      text: 'El mensaje de WhatsApp está preparado más abajo. Revísalo y simula el envío.',
      actions: null,
    };
  } else if (order.status === 'enviado' || order.status === 'confirmado') {
    next = {
      title: order.status === 'enviado' ? 'Enviado, a la espera de confirmación' : `Entrega prevista el ${fmtDate(order.requestedDelivery)}`,
      text: 'Cuando llegue la mercancía, registra lo que realmente se recibió. Es lo único que aumenta el inventario.',
      actions: (
        <div className="space-y-2">
          <Button variant="primary" block icon={<ClipboardCheck className="size-4" />} onClick={() => setRec('1')} disabledReason={!isOps ? 'Contabilidad no registra recepciones.' : !ownLocation && 'Solo el gerente del local puede registrar la recepción.'} data-tour="pedido-recibir">
            Registrar recepción
          </Button>
          {order.status === 'enviado' && !awaiting && isOps && (
            <Button variant="ghost" block size="sm" icon={<FlaskConical className="size-3.5" />} onClick={() => act((d, ctx) => confirmOrder(d, ctx, order.id), 'Confirmación del proveedor simulada')}>
              Simular confirmación del proveedor
            </Button>
          )}
        </div>
      ),
    };
  } else if (order.status === 'recibido_parcial') {
    const missing = lines.filter((l) => l.pending > 0);
    next = {
      title: 'Entrega incompleta',
      text: `Falta por recibir: ${missing.map((m) => `${fmtPacks(m.pending, data.products.find((p) => p.id === m.line.productId)!.offer.pack)} de ${data.products.find((p) => p.id === m.line.productId)!.name}`).join(', ')}.`,
      actions: (
        <div className="space-y-2">
          <Button variant="primary" block icon={<ClipboardCheck className="size-4" />} onClick={() => setRec('1')} disabledReason={!isOps ? 'Contabilidad no registra recepciones.' : !ownLocation && 'Solo el gerente del local puede registrar la recepción.'} data-tour="pedido-recibir">
            Registrar el faltante
          </Button>
          <Button variant="secondary" block onClick={() => setCloseOpen(true)} disabled={!isOps}>
            Cerrar con faltante
          </Button>
        </div>
      ),
    };
  }

  return (
    <div>
      <Link to="/compras?vista=pedidos" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-3 hover:text-ink">
        <ArrowLeft className="size-3.5" /> Pedidos
      </Link>

      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-1.5 text-brass-700">Pedido de compra</p>
          <h1 className="serif flex flex-wrap items-center gap-3 text-[30px] font-[520] leading-tight text-forest-900">
            <span className="tabular-nums">{order.id}</span>
            <OrderStatusBadge order={order} />
          </h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[14px] text-ink-2">
            {supplier.name} <span className="text-ink-4">·</span> <LocationTag id={loc.id} name={loc.name} /> <span className="text-ink-4">·</span> creado por {userName(data, order.createdBy)}
          </p>
        </div>
        {canCancel(order) && isOps && (
          <Button variant="ghost" icon={<Ban className="size-4" />} onClick={() => { setReason(''); setCancelOpen(true); }}>
            Cancelar pedido
          </Button>
        )}
      </header>

      {order.status === 'cancelado' && (
        <Note tone="neutral" icon={<Ban className="size-4" />} className="mb-5">
          Pedido cancelado el {fmtDateTime(order.cancelledAt)} por {userName(data, order.cancelledBy ?? '')}. Motivo: {order.cancelReason}. No generó ninguna entrada de inventario.
        </Note>
      )}

      <Panel className="mb-6 p-5">
        <Progress order={order} lastReceptionAt={receptions.at(-1)?.receivedAt} />
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          <Panel data-tour="pedido-lineas">
            <PanelHeader title="Artículos" hint={editable ? 'Puedes ajustar las cantidades mientras el pedido no se haya enviado' : `${plural(order.lines.length, 'artículo', 'artículos')}`} />
            <Table minWidth={620}>
              <thead>
                <tr>
                  <Th>Producto</Th>
                  <Th align="right">Pedido</Th>
                  <Th align="right">Recibido</Th>
                  <Th align="right">Precio</Th>
                  <Th align="right">Importe</Th>
                </tr>
              </thead>
              <tbody>
                {lines.map(({ line, received, pending }) => {
                  const p = data.products.find((x) => x.id === line.productId)!;
                  const receivable = ['recibido_parcial', 'recibido'].includes(order.status);
                  return (
                    <Tr key={line.productId}>
                      <Td>
                        <p className="font-medium text-ink">{p.name}</p>
                        <p className="text-[12.5px] text-ink-3">{line.packLabel}</p>
                      </Td>
                      <Td num>
                        {editable ? (
                          <Stepper size="sm" label={`Cantidad de ${p.name}`} value={line.packs} min={order.lines.length > 1 ? 0 : 1} onChange={(v) => setLine(p.id, v)} />
                        ) : (
                          <>
                            <span className="font-medium">{fmtPacks(line.packs, p.offer.pack)}</span>
                            <div className="text-[12px] text-ink-3">{fmtQty(line.packs * line.packBaseQty, p.baseUnit)}</div>
                          </>
                        )}
                      </Td>
                      <Td num>
                        {receivable ? (
                          <>
                            <span className={cn('font-medium', pending > 0 && 'text-warn-800')}>{received} de {line.packs}</span>
                            <div className="text-[12px] text-ink-3">
                              {pending > 0 ? (
                                <span className="inline-flex items-center gap-1 text-warn-800">
                                  <TriangleAlert className="size-3" /> faltan {pending}
                                </span>
                              ) : (
                                fmtQty(received * line.packBaseQty, p.baseUnit)
                              )}
                            </div>
                          </>
                        ) : (
                          <span className="text-ink-4">—</span>
                        )}
                      </Td>
                      <Td num>
                        {money(line.unitPriceCents)}
                        {line.taxRate > 0 && <div className="text-[12px] text-ink-3">+ ITBMS 7 %</div>}
                      </Td>
                      <Td num className="font-medium">{money(lineSubtotal(line))}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <dl className="ml-auto w-full max-w-[280px] space-y-1 px-5 py-4 text-[13.5px]">
              <div className="flex justify-between text-ink-2">
                <dt>Subtotal</dt>
                <dd className="tabular-nums">{money(totals.subtotalCents)}</dd>
              </div>
              <div className="flex justify-between text-ink-2">
                <dt>ITBMS</dt>
                <dd className="tabular-nums">{totals.taxCents > 0 ? money(totals.taxCents) : 'Exento'}</dd>
              </div>
              <div className="flex justify-between border-t border-line pt-2 text-[15px] font-semibold text-forest-900">
                <dt>Total</dt>
                <dd className="tabular-nums">{money(totals.totalCents)}</dd>
              </div>
            </dl>
          </Panel>

          {receptions.length > 0 && (
            <Panel data-tour="pedido-recepciones">
              <PanelHeader title="Recepciones" hint="Lo que realmente llegó. Cada recepción generó sus entradas de inventario." />
              <ul className="divide-y divide-line/80">
                {receptions.map((r) => (
                  <li key={r.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-2 text-[14px] font-medium text-ink">
                        <PackageCheck className="size-4 text-forest-600" />
                        <span className="tabular-nums">{r.id}</span>
                        <span className="font-normal text-ink-3">· {fmtDateTime(r.receivedAt)} · {userName(data, r.receivedBy)}</span>
                      </p>
                      <Link to={`/inventario?vista=movimientos&ref=${r.id}`} className="text-[12.5px] font-medium text-forest-700 hover:underline">
                        Ver movimientos de inventario
                      </Link>
                    </div>
                    <ul className="mt-2.5 space-y-1.5 text-[13px]">
                      {r.lines.map((l) => {
                        const p = data.products.find((x) => x.id === l.productId)!;
                        const short = l.packsReceived < l.packsExpected;
                        return (
                          <li key={l.productId} className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-ink-2">{p.name}</span>
                            <span className="flex items-center gap-2 tabular-nums">
                              <span className="text-ink">
                                {fmtPacks(l.packsReceived, p.offer.pack)} <span className="text-ink-3">de {l.packsExpected} · +{fmtQty(l.baseQty, p.baseUnit)}</span>
                              </span>
                              {short && <Badge tone="warn" icon={<PackageOpen className="size-3" />}>{ISSUE_LABEL[l.issue ?? 'faltante']}</Badge>}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {r.note && <p className="mt-2.5 rounded-lg bg-linen px-3 py-2 text-[12.5px] italic text-ink-2">«{r.note}»</p>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {(invoices.length > 0 || rawDoc || ['recibido', 'recibido_parcial'].includes(order.status)) && (
            <Panel>
              <PanelHeader title="Factura del proveedor" hint="La factura se contrasta con este pedido y con lo recibido. Nunca modifica el inventario." />
              {invoices.length === 0 && !rawDoc ? (
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <p className="text-[13.5px] text-ink-2">Todavía no ha llegado la factura de este pedido.</p>
                  {user.role !== 'gerente' && (
                    <Button
                      size="sm"
                      icon={<FlaskConical className="size-3.5" />}
                      onClick={() => {
                        const res = simulateInbound('pedido', { orderId: order.id });
                        if (res) {
                          toast('info', 'Factura recibida por WhatsApp (simulado)', 'Está en la bandeja de documentos, lista para procesar.');
                          navigate(`/facturas?doc=${res.documentId}`);
                        }
                      }}
                    >
                      Simular llegada por WhatsApp
                    </Button>
                  )}
                </div>
              ) : (
                <ul className="divide-y divide-line/80">
                  {rawDoc && (
                    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                      <span className="flex items-center gap-2.5 text-[13.5px]">
                        <FileText className="size-4 text-ink-3" /> Documento {rawDoc.id} recibido, sin procesar
                      </span>
                      <Button size="sm" onClick={() => void processDocument(rawDoc.id).then((inv) => inv && navigate(`/facturas/${inv}`))}>Procesar</Button>
                    </li>
                  )}
                  {invoices.map((inv) => (
                    <li key={inv.id}>
                      <Link to={`/facturas/${inv.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-linen/60">
                        <span className="flex items-center gap-2.5 text-[13.5px]">
                          <FileText className="size-4 text-ink-3" />
                          <span className="font-medium tabular-nums text-ink">{inv.number}</span>
                          <span className="text-ink-3">· emitida el {fmtDate(inv.issueDate)} · vence el {fmtDate(inv.dueDate)}</span>
                        </span>
                        <span className="flex items-center gap-3">
                          <span className="font-medium tabular-nums">{money(inv.totalCents)}</span>
                          <InvoiceStatusBadge status={inv.status} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          {next && (
            <Panel className="p-5" data-tour="pedido-accion">
              <p className="eyebrow mb-1 text-brass-700">Siguiente paso</p>
              <h2 className="serif text-[18px] font-[520] leading-snug text-forest-900">{next.title}</h2>
              <p className="mt-1 text-[13px] leading-snug text-ink-2">{next.text}</p>
              {next.actions && <div className="mt-4">{next.actions}</div>}
            </Panel>
          )}
          {order.status === 'recibido' && (
            <Note tone="ok" icon={<CheckCheck className="size-4" />}>
              {order.closedShort ? 'Pedido cerrado con faltante: no se espera más mercancía.' : 'Pedido recibido completo.'} Las cantidades ya están en el inventario de {loc.name}.
            </Note>
          )}

          <WhatsAppThread order={order} />

          <Panel className="p-5">
            <dl className="space-y-3 text-[13.5px]">
              <div className="flex items-start gap-3">
                <Truck className="mt-0.5 size-4 shrink-0 text-ink-3" />
                <div>
                  <dt className="text-[12px] text-ink-3">Entrega solicitada</dt>
                  <dd className="text-ink">{fmtDayLong(order.requestedDelivery)}</dd>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 size-4 shrink-0 text-ink-3" />
                <div>
                  <dt className="text-[12px] text-ink-3">Dirección de entrega</dt>
                  <dd className="text-ink">{loc.address}</dd>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Send className="mt-0.5 size-4 shrink-0 text-ink-3" />
                <div>
                  <dt className="text-[12px] text-ink-3">Proveedor</dt>
                  <dd className="text-ink">
                    {supplier.contactName} · <span className="tabular-nums">{supplier.whatsapp}</span>
                    <span className="block text-[12.5px] text-ink-3">Pago a {supplier.paymentTermsDays} días · entrega en {supplier.leadTimeDays} {supplier.leadTimeDays === 1 ? 'día' : 'días'}</span>
                  </dd>
                </div>
              </div>
              {order.note && (
                <div className="rounded-lg bg-linen px-3 py-2 text-[13px] italic text-ink-2">«{order.note}»</div>
              )}
            </dl>
          </Panel>
        </div>
      </div>

      <ReceptionDrawer order={order} open={rec === '1' && canReceive(order)} onClose={() => setRec(null)} />

      <Modal
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        size="sm"
        title={order.status === 'pendiente_aprobacion' && user.role === 'direccion' ? 'Rechazar pedido' : 'Cancelar pedido'}
        description={
          order.status === 'enviado' || order.status === 'confirmado'
            ? 'El pedido ya se envió: se dejará constancia de un mensaje de anulación al proveedor (simulado).'
            : 'El pedido quedará como cancelado. No afecta al inventario.'
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>Volver</Button>
            <Button
              variant="danger"
              onClick={() => {
                const res = act((d, ctx) => cancelOrder(d, ctx, order.id, reason), 'Pedido cancelado');
                if (res.ok) setCancelOpen(false);
              }}
            >
              Confirmar cancelación
            </Button>
          </>
        }
      >
        <Field label="Motivo" htmlFor="motivo-cancelacion" className="pb-1">
          <Textarea id="motivo-cancelacion" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Por ejemplo: pedido duplicado." />
        </Field>
      </Modal>

      <ConfirmDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        title="¿Cerrar el pedido con faltante?"
        confirmLabel="Cerrar pedido"
        onConfirm={() => act((d, ctx) => closeOrderShort(d, ctx, order.id), 'Pedido cerrado con faltante')}
      >
        Ya no se esperará el resto de la mercancía. Si después llega una factura por el total, la plataforma señalará la diferencia con lo recibido.
      </ConfirmDialog>
    </div>
  );
}
