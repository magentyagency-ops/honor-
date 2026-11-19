import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ArrowLeft, Ban, Banknote, Check, CircleCheck, CopyCheck, FileSearch, FlaskConical, History, Info, Link2, MessageCircle, PackageCheck,
  ScanLine, ShieldAlert, TriangleAlert, Undo2, Upload,
} from 'lucide-react';
import type { Invoice, InvoiceFieldKey, LocationId, SourceDocument } from '@/domain/types';
import { PAYMENT_METHODS } from '@/data/catalog';
import { lineSubtotal, userName } from '@/domain/core';
import { money, packs as fmtPacks, parseMoney, percent } from '@/domain/format';
import { fmtDate, fmtDateTime, fmtDue, fmtWhen, panamaDay } from '@/domain/time';
import {
  CONFIDENCE_THRESHOLD, FIELD_LABEL, analyzeInvoice, balanceCents, confirmDueDate, confirmInvoiceField, correctInvoiceField, discardInvoice,
  dismissDuplicate, disputeInvoice, isPayable, linkInvoiceOrder, paidCents, reopenInvoice, validateInvoice, validationBlockers, voidPayment,
  type Anomaly,
} from '@/domain/invoices';
import { act, processDocument, useDemo, useNow, useUser } from '@/store';
import { Avatar, Badge, Button, EmptyState, Field, Input, LocationTag, Note, Panel, PanelHeader, Select, Textarea, cn } from '@/ui/primitives';
import { Modal } from '@/ui/overlays';
import { InvoiceStatusBadge, OrderStatusBadge } from '@/ui/status';
import { InvoiceDocument } from './InvoiceDocument';
import { PaymentDialog } from './PaymentDialog';

const RESOLUTIONS = [
  'Falta mercancía por entregar: se paga solo lo recibido y el resto al llegar el faltante.',
  'Nota de crédito solicitada al proveedor por la diferencia.',
  'Diferencia revisada y aceptada por Dirección.',
];

const ANOMALY_TONE: Record<Anomaly['kind'], 'danger' | 'warn'> = {
  duplicado: 'danger', cantidad: 'danger', precio: 'danger', sin_pedido: 'warn', no_pedido: 'warn', total: 'warn',
};

// ───────────────────────────── Campo extraído ─────────────────────────────

function FieldRow({ field, invoice, editable, onActive, children, extra }: {
  field: InvoiceFieldKey; invoice: Invoice; editable: boolean; onActive: (f: InvoiceFieldKey | null) => void; children: React.ReactNode; extra?: React.ReactNode;
}) {
  const conf = invoice.confidence[field];
  const corrected = invoice.corrections.some((c) => c.field === field);
  const low = conf !== undefined && conf < CONFIDENCE_THRESHOLD && !(field === 'dueDate');
  return (
    <div
      data-tour={`campo-${field}`}
      onMouseEnter={() => onActive(field)}
      onMouseLeave={() => onActive(null)}
      onFocusCapture={() => onActive(field)}
      onBlurCapture={() => onActive(null)}
      className={cn('grid grid-cols-1 items-start gap-x-4 gap-y-1.5 px-5 py-3 sm:grid-cols-[132px_minmax(0,1fr)_auto]', low && 'bg-warn-50/70')}
    >
      <p className="pt-2 text-[12.5px] font-medium text-ink-2">{FIELD_LABEL[field]}</p>
      <div className="min-w-0">
        {children}
        {extra}
      </div>
      <div className="flex items-center gap-2 pt-1.5 sm:justify-end">
        {corrected ? (
          <Badge tone="brass" icon={<History className="size-3" />}>Corregido a mano</Badge>
        ) : low ? (
          <>
            <Badge tone="warn" icon={<TriangleAlert className="size-3" />}>Dudoso · {percent(conf!, 0)}</Badge>
            {editable && (
              <Button size="sm" variant="ghost" onClick={() => act((d, ctx) => confirmInvoiceField(d, ctx, invoice.id, field))}>
                Es correcto
              </Button>
            )}
          </>
        ) : conf !== undefined && field !== 'dueDate' ? (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] text-ink-3">
            <Check className="size-3 text-ok-700" strokeWidth={3} /> {conf >= 1 ? 'Confirmado' : `Confianza ${percent(conf, 0)}`}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Campo de texto que guarda al salir (o con Intro). */
function CommitInput({ value, onCommit, disabled, money: isMoney, type = 'text', ...rest }: {
  value: string; onCommit: (v: string) => void; disabled?: boolean; money?: boolean; type?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft);
  return (
    <div className="relative">
      {isMoney && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">$</span>}
      <Input
        type={type}
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          setDraft(e.target.value);
          if (type === 'date' && e.target.value) onCommit(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className={cn('tabular-nums', isMoney && 'pl-6')}
        {...rest}
      />
    </div>
  );
}

// ───────────────────────────── Origen del documento ─────────────────────────────

function SourceCard({ doc }: { doc: SourceDocument }) {
  const data = useDemo((s) => s.data);
  const now = useNow();
  const sender = data.users.find((u) => u.id === doc.senderId);
  const loc = data.locations.find((l) => l.id === doc.locationId)!;
  return (
    <div className="mb-3 flex flex-wrap items-start gap-3">
      <Avatar initials={sender?.initials ?? '?'} size={34} />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium leading-tight text-ink">
          {sender?.name ?? 'Remitente desconocido'} <span className="font-normal text-ink-3">· {sender?.roleLabel}</span>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-3">
          {doc.channel === 'whatsapp' ? (
            <span className="inline-flex items-center gap-1"><MessageCircle className="size-3.5" /> WhatsApp (simulado)</span>
          ) : (
            <span className="inline-flex items-center gap-1"><Upload className="size-3.5" /> Carga manual</span>
          )}
          <span>· {fmtWhen(doc.receivedAt, now)}</span>
          <span>· <LocationTag id={loc.id} name={loc.name} /></span>
        </p>
        <p className="mt-0.5 text-[12px] tabular-nums text-ink-3">{doc.id} · {doc.fileName}</p>
        {doc.caption && <p className="mt-2 inline-block rounded-xl rounded-tl-sm bg-white px-3 py-1.5 text-[13px] text-ink shadow-[0_1px_0.5px_rgb(0_0_0/0.13)]">{doc.caption}</p>}
      </div>
    </div>
  );
}

// ───────────────────────────── Página ─────────────────────────────

export function InvoicePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const data = useDemo((s) => s.data);
  const extracting = useDemo((s) => s.ui.extracting);
  const touring = useDemo((s) => s.tour.active && !s.tour.minimized);
  const user = useUser();
  const now = useNow();
  const today = panamaDay(now);
  const [active, setActive] = useState<InvoiceFieldKey | null>(null);
  const [validating, setValidating] = useState(false);
  const [resolution, setResolution] = useState(RESOLUTIONS[0]);
  const [disputing, setDisputing] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeAmount, setDisputeAmount] = useState('');
  const [discarding, setDiscarding] = useState(false);
  const [params] = useSearchParams();
  const paying = params.get('pagar') === '1';
  const presetCents = Number(params.get('importe')) || undefined;
  const setPaying = (v: boolean) => navigate(v ? `/facturas/${id}?pagar=1` : `/facturas/${id}`, { replace: true });

  const isDocId = id.startsWith('DOC');
  const invoice = isDocId ? data.invoices.find((i) => i.documentId === id) : data.invoices.find((i) => i.id === id);
  const doc = isDocId ? data.documents.find((x) => x.id === id) : data.documents.find((x) => x.id === invoice?.documentId);

  const doValidate = (note?: string) => {
    if (!invoice) return;
    const res = act((d, ctx) => validateInvoice(d, ctx, invoice.id, note), 'Factura validada: ya figura como deuda por pagar');
    if (res.ok) setValidating(false);
  };
  if (!doc) {
    return (
      <EmptyState title="Documento no encontrado" action={<Button onClick={() => navigate('/facturas')}>Volver a la bandeja</Button>}>
        {id} no existe en los datos actuales de la demostración.
      </EmptyState>
    );
  }
  if (isDocId && invoice) return <Navigate to={`/facturas/${invoice.id}`} replace />;

  const finance = user.role !== 'gerente';
  const busy = Boolean(extracting[doc.id]);

  // ── Documento todavía sin procesar ──
  if (!invoice) {
    const own = doc.kind === 'archivo';
    return (
      <div>
        <BackLink />
        <header className="mb-5">
          <p className="eyebrow mb-1.5 text-brass-700">Documento recibido</p>
          <h1 className="serif flex flex-wrap items-center gap-3 text-[28px] font-[520] leading-tight text-forest-900">
            {doc.id} <InvoiceStatusBadge status="recibida" />
          </h1>
        </header>
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <div className="lg:sticky lg:top-[84px]">
            <SourceCard doc={doc} />
            <InvoiceDocument doc={doc} scanning={busy} />
          </div>
          <Panel className="p-6" data-tour="doc-sin-procesar">
            <span className="flex size-11 items-center justify-center rounded-full bg-brass-50 text-brass-700 ring-1 ring-inset ring-brass-200">
              {busy ? <ScanLine className="size-5 animate-pulse" /> : <FileSearch className="size-5" />}
            </span>
            <h2 className="serif mt-3 text-[20px] font-[520] text-forest-900">{busy ? 'Leyendo el documento…' : 'Listo para procesar'}</h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">
              {own
                ? 'En la demostración, la lectura automática solo funciona con los documentos de ejemplo. Para tu archivo se abrirá la ficha vacía y podrás capturar los datos a mano, sin inventar nada.'
                : 'La plataforma extrae proveedor, número, fechas, importes y líneas, e indica qué campos ha leído con poca confianza para que los revises.'}
            </p>
            {busy ? (
              <ul className="mt-5 space-y-2.5" aria-hidden>
                {['Proveedor', 'N.º de factura', 'Fecha de emisión', 'Vencimiento', 'Importes', 'Líneas'].map((f, i) => (
                  <li key={f} className="flex items-center gap-3 text-[13px] text-ink-3">
                    <span className="w-32">{f}</span>
                    <span className="h-2.5 flex-1 animate-pulse rounded-full bg-sand" style={{ animationDelay: `${i * 120}ms`, maxWidth: `${50 + ((i * 37) % 40)}%` }} />
                  </li>
                ))}
              </ul>
            ) : (
              <Button
                variant="primary"
                size="lg"
                className="mt-5"
                icon={own ? <Upload className="size-[18px]" /> : <ScanLine className="size-[18px]" />}
                disabledReason={!finance && 'Solo Contabilidad o Dirección procesan las facturas.'}
                onClick={() => void processDocument(doc.id).then((invId) => invId && navigate(`/facturas/${invId}`, { replace: true }))}
                data-tour="doc-procesar"
              >
                {own ? 'Capturar datos a mano' : 'Extraer datos'}
              </Button>
            )}
            <p className="mt-4 flex items-start gap-2 text-[12.5px] leading-snug text-ink-3">
              <FlaskConical className="mt-px size-3.5 shrink-0" /> Extracción simulada: no se envía el documento a ningún servicio externo.
            </p>
          </Panel>
        </div>
      </div>
    );
  }

  // ── Factura ──
  const supplier = data.suppliers.find((s) => s.id === invoice.supplierId);
  const analysis = analyzeInvoice(data, invoice);
  const blockers = validationBlockers(data, invoice);
  const editable = finance && (invoice.status === 'por_revisar' || invoice.status === 'en_disputa');
  const paid = paidCents(data, invoice.id);
  const balance = balanceCents(data, invoice);
  const payments = data.payments.filter((p) => p.invoiceId === invoice.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const correct = (field: InvoiceFieldKey, value: string | number) => act((d, ctx) => correctInvoiceField(d, ctx, invoice.id, field, value));
  const moneyCommit = (field: InvoiceFieldKey) => (v: string) => {
    const c = parseMoney(v);
    if (c !== null) correct(field, c);
  };
  const candidates = data.orders
    .filter((o) => o.supplierId === invoice.supplierId && o.locationId === invoice.locationId && !['cancelado', 'borrador', 'pendiente_aprobacion'].includes(o.status))
    .slice(-8)
    .reverse();
  const anomalyTotal = analysis.anomalies.filter((a) => a.kind === 'cantidad' || a.kind === 'precio').reduce((t, a) => t + Math.max(0, a.amountCents ?? 0), 0);

  return (
    <div>
      <BackLink />
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-1.5 text-brass-700">Factura de proveedor</p>
          <h1 className="serif flex flex-wrap items-center gap-3 text-[28px] font-[520] leading-tight text-forest-900">
            <span className="tabular-nums">{invoice.number || 'Sin número'}</span>
            <InvoiceStatusBadge status={invoice.status} />
          </h1>
          <p className="mt-1.5 text-[14px] text-ink-2">
            {supplier?.name ?? 'Proveedor por identificar'} · <LocationTag id={invoice.locationId} name={data.locations.find((l) => l.id === invoice.locationId)!.name} />
          </p>
        </div>
        <div className="text-right">
          <p className="text-[12.5px] text-ink-3">Total de la factura</p>
          <p className="text-[28px] font-semibold leading-none tracking-[-0.02em] text-forest-900">{money(invoice.totalCents)}</p>
          <p className={cn('mt-1.5 text-[12.5px]', isPayable(invoice) && invoice.dueDate < today ? 'font-medium text-danger-700' : !invoice.dueDateConfirmed ? 'font-medium text-warn-800' : 'text-ink-3')}>
            {invoice.status === 'pagada'
              ? 'Saldada'
              : invoice.status === 'descartada'
                ? 'No genera deuda'
                : !invoice.dueDateConfirmed
                  ? `Vencimiento propuesto: ${fmtDate(invoice.dueDate)} · por confirmar`
                  : `${fmtDue(invoice.dueDate, today)} · ${fmtDate(invoice.dueDate)}`}
          </p>
        </div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        {/* Documento */}
        <div className="lg:sticky lg:top-[84px]" data-tour="factura-documento">
          <SourceCard doc={doc} />
          <InvoiceDocument doc={doc} active={active} />
          <p className="mt-2 text-[12px] text-ink-3">Pasa el cursor por un campo de la derecha para localizarlo en el documento.</p>
        </div>

        {/* Datos, conciliación y acciones */}
        <div className="min-w-0 space-y-5">
          {analysis.anomalies.length > 0 && invoice.status !== 'descartada' && (
            <div className="space-y-2.5" data-tour="factura-diferencias">
              {analysis.anomalies.map((a, i) => (
                <div key={i} data-tour={`anomalia-${a.kind}`} className={cn('rounded-xl px-4 py-3 ring-1 ring-inset', ANOMALY_TONE[a.kind] === 'danger' ? 'bg-danger-50 ring-danger-100' : 'bg-warn-50 ring-warn-100')}>
                  <p className={cn('flex items-center gap-2 text-[14px] font-semibold', ANOMALY_TONE[a.kind] === 'danger' ? 'text-danger-800' : 'text-warn-800')}>
                    {a.kind === 'duplicado' ? <CopyCheck className="size-4" /> : <ShieldAlert className="size-4" />}
                    {a.title}
                  </p>
                  <p className="mt-1 text-[13px] leading-snug text-ink">{a.detail}</p>
                  {a.kind === 'duplicado' && a.relatedInvoiceId && (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => navigate(`/facturas/${a.relatedInvoiceId}`)}>Ver la factura original</Button>
                      {editable && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => act((d, ctx) => dismissDuplicate(d, ctx, invoice.id), 'Alerta descartada: se tratará como una factura distinta')}>
                            No es un duplicado
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => act((d, ctx) => discardInvoice(d, ctx, invoice.id, 'Duplicado confirmado'), 'Factura descartada como duplicado · el documento se conserva')}>
                            Descartar esta
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {invoice.status === 'en_disputa' && invoice.dispute && (
            <Note tone="danger" icon={<TriangleAlert className="size-4" />}>
              <strong>En disputa por {money(invoice.dispute.amountCents)}</strong> desde el {fmtDate(invoice.dispute.openedAt)} ({userName(data, invoice.dispute.openedBy)}). {invoice.dispute.reason}
              <br />
              Mientras siga en disputa no cuenta como deuda por pagar.
            </Note>
          )}
          {invoice.status === 'descartada' && (
            <Note tone="neutral" icon={<Ban className="size-4" />}>Factura descartada · {invoice.discardedReason}. El documento original se conserva y no genera deuda.</Note>
          )}

          {/* Campos extraídos */}
          <Panel data-tour="factura-campos">
            <PanelHeader
              title="Datos de la factura"
              hint={editable ? 'Extraídos del documento. Lo dudoso se marca: corrígelo o confírmalo.' : 'Datos validados: ya no se pueden modificar.'}
              actions={<Badge tone="neutral" icon={<FlaskConical className="size-3" />}>Extracción simulada</Badge>}
            />
            <div className="divide-y divide-line/70">
              <FieldRow field="supplierId" invoice={invoice} editable={editable} onActive={setActive}>
                {editable ? (
                  <Select value={invoice.supplierId ?? ''} onChange={(e) => e.target.value && correct('supplierId', e.target.value)} aria-label="Proveedor">
                    <option value="" disabled>Elige el proveedor…</option>
                    {data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                ) : (
                  <p className="pt-2 text-[14px] font-medium text-ink">{supplier?.name ?? '—'}</p>
                )}
              </FieldRow>
              <FieldRow field="number" invoice={invoice} editable={editable} onActive={setActive}>
                {editable ? <CommitInput value={invoice.number} onCommit={(v) => correct('number', v.trim())} aria-label="Número de factura" data-tour="campo-number-input" /> : <p className="pt-2 text-[14px] font-medium tabular-nums text-ink">{invoice.number}</p>}
              </FieldRow>
              <FieldRow field="issueDate" invoice={invoice} editable={editable} onActive={setActive}>
                {editable ? <CommitInput type="date" value={invoice.issueDate} onCommit={(v) => correct('issueDate', v)} aria-label="Fecha de emisión" /> : <p className="pt-2 text-[14px] tabular-nums text-ink">{fmtDate(invoice.issueDate)}</p>}
              </FieldRow>
              <FieldRow
                field="dueDate"
                invoice={invoice}
                editable={editable}
                onActive={setActive}
                extra={
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px]">
                    {invoice.dueDateSource === 'documento' && <span className="text-ink-3">Impreso en la factura.</span>}
                    {invoice.dueDateSource === 'manual' && <span className="text-ink-3">Indicado a mano.</span>}
                    {invoice.dueDateSource === 'propuesta' &&
                      (invoice.dueDateConfirmed ? (
                        <span className="inline-flex items-center gap-1 text-ink-3"><Check className="size-3 text-ok-700" strokeWidth={3} /> Propuesto según las condiciones del proveedor y confirmado.</span>
                      ) : (
                        <>
                          <span className="font-medium text-warn-800">
                            Propuesta: el documento no trae vencimiento. Se calcula con las condiciones de {supplier?.short ?? 'el proveedor'} ({supplier?.paymentTermsDays ?? 30} días).
                          </span>
                          {editable && (
                            <Button size="sm" variant="primary" onClick={() => act((d, ctx) => confirmDueDate(d, ctx, invoice.id), `Vencimiento confirmado: ${fmtDate(invoice.dueDate)}`)} data-tour="confirmar-vencimiento">
                              Confirmar {fmtDate(invoice.dueDate)}
                            </Button>
                          )}
                        </>
                      ))}
                  </div>
                }
              >
                {editable ? <CommitInput type="date" value={invoice.dueDate} onCommit={(v) => correct('dueDate', v)} aria-label="Vencimiento" /> : <p className="pt-2 text-[14px] tabular-nums text-ink">{fmtDate(invoice.dueDate)}</p>}
              </FieldRow>
              <FieldRow field="locationId" invoice={invoice} editable={editable} onActive={setActive}>
                {editable ? (
                  <Select value={invoice.locationId} onChange={(e) => correct('locationId', e.target.value as LocationId)} aria-label="Local">
                    {data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </Select>
                ) : (
                  <p className="pt-2 text-[14px] text-ink">{data.locations.find((l) => l.id === invoice.locationId)!.name}</p>
                )}
              </FieldRow>
              {(['subtotalCents', 'taxCents', 'totalCents'] as const).map((f) => (
                <FieldRow key={f} field={f} invoice={invoice} editable={editable} onActive={setActive}>
                  {editable ? (
                    <CommitInput money value={(invoice[f] / 100).toFixed(2)} onCommit={moneyCommit(f)} inputMode="decimal" aria-label={FIELD_LABEL[f]} />
                  ) : (
                    <p className={cn('pt-2 text-[14px] tabular-nums text-ink', f === 'totalCents' && 'font-semibold')}>{f === 'taxCents' && invoice.taxCents === 0 ? 'Exento' : money(invoice[f])}</p>
                  )}
                </FieldRow>
              ))}
            </div>
          </Panel>

          {/* Conciliación */}
          <Panel data-tour="factura-conciliacion">
            <PanelHeader
              title="Pedido, recepción y factura"
              hint="Se comprueba cada línea contra lo que se pidió y lo que realmente llegó"
              actions={
                analysis.order ? (
                  <Link to={`/compras/pedidos/${analysis.order.id}`} className="inline-flex items-center gap-2 text-[13px] font-medium text-forest-700 hover:underline">
                    <Link2 className="size-3.5" /> {analysis.order.id} <OrderStatusBadge order={analysis.order} />
                  </Link>
                ) : undefined
              }
            />
            {invoice.lines.length === 0 ? (
              <p className="px-5 py-5 text-[13.5px] text-ink-3">Este documento no trae líneas detalladas: solo se controlan los importes totales.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-[13.5px]">
                  <thead>
                    <tr className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                      <th scope="col" className="border-b border-line py-2.5 pl-5 pr-2 text-left">Artículo</th>
                      <th scope="col" className="border-b border-line px-2 py-2.5 text-right">Facturado</th>
                      <th scope="col" className="border-b border-line px-2 py-2.5 text-right">Pedido</th>
                      <th scope="col" className="border-b border-line px-2 py-2.5 text-right">Recibido</th>
                      <th scope="col" className="border-b border-line py-2.5 pl-2 pr-5 text-left">Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.lines.map((m, i) => {
                      const p = m.line.productId ? data.products.find((x) => x.id === m.line.productId) : undefined;
                      const priceDiff = m.priceDeltaCents !== 0;
                      const ok = analysis.order && m.orderLine && m.overBilledPacks === 0 && !priceDiff;
                      return (
                        <tr key={i} data-tour={m.overBilledPacks > 0 ? 'linea-diferencia' : undefined} className={cn(m.overBilledPacks > 0 || priceDiff ? 'bg-danger-50/60' : undefined)}>
                          <td className="border-b border-line/70 py-2.5 pl-5 pr-2">
                            <p className="font-medium text-ink">{p?.name ?? m.line.description}</p>
                            <p className="text-[12px] text-ink-3">{p ? p.offer.pack.label : ''}</p>
                          </td>
                          <td className="whitespace-nowrap border-b border-line/70 px-2 py-2.5 text-right tabular-nums">
                            <span className="font-medium">{m.line.packs}</span> × {money(m.line.unitPriceCents)}
                            <div className="text-[12px] text-ink-3">{money(lineSubtotal(m.line))}</div>
                          </td>
                          <td className="whitespace-nowrap border-b border-line/70 px-2 py-2.5 text-right tabular-nums">
                            {m.orderLine ? (
                              <>
                                {m.orderedPacks} × <span className={cn(priceDiff && 'font-semibold text-danger-700')}>{money(m.orderLine.unitPriceCents)}</span>
                              </>
                            ) : (
                              <span className="text-ink-4">—</span>
                            )}
                          </td>
                          <td className={cn('whitespace-nowrap border-b border-line/70 px-2 py-2.5 text-right tabular-nums', m.overBilledPacks > 0 && 'font-semibold text-danger-700')}>
                            {m.receivedPacks !== undefined ? m.receivedPacks : <span className="text-ink-4">—</span>}
                          </td>
                          <td className="border-b border-line/70 py-2.5 pl-2 pr-5">
                            {!analysis.order ? (
                              <span className="text-[12.5px] text-ink-3">Sin pedido que comparar</span>
                            ) : ok ? (
                              <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-ok-700"><Check className="size-3.5" strokeWidth={3} /> Coincide</span>
                            ) : (
                              <span className="flex flex-col gap-1">
                                {m.overBilledPacks > 0 && p && <Badge tone="danger" icon={<TriangleAlert className="size-3" />}>{fmtPacks(m.overBilledPacks, p.offer.pack)} de más</Badge>}
                                {priceDiff && <Badge tone="danger" icon={<TriangleAlert className="size-3" />}>{m.priceDeltaCents > 0 ? '+' : ''}{money(m.priceDeltaCents)} por unidad</Badge>}
                                {!m.orderLine && <Badge tone="warn">No estaba en el pedido</Badge>}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {analysis.order ? (
              <dl className="flex flex-wrap items-center justify-end gap-x-8 gap-y-1 px-5 py-3 text-[13px]" data-tour="factura-recibido">
                <div className="flex items-baseline gap-2">
                  <dt className="text-ink-3">Facturado</dt>
                  <dd className="font-semibold tabular-nums">{money(invoice.totalCents)}</dd>
                </div>
                <div className="flex items-baseline gap-2">
                  <dt className="text-ink-3">Corresponde a lo recibido</dt>
                  <dd className={cn('font-semibold tabular-nums', analysis.receivedValueCents < invoice.totalCents && 'text-danger-700')}>{money(analysis.receivedValueCents)}</dd>
                </div>
                {analysis.receptions.length > 0 && (
                  <div className="flex items-center gap-1.5 text-ink-3">
                    <PackageCheck className="size-3.5" /> {analysis.receptions.map((r) => r.id).join(', ')}
                  </div>
                )}
              </dl>
            ) : (
              editable && (
                <div className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-3.5">
                  <Field label="Vincular con un pedido" htmlFor="vincular-pedido" className="min-w-[220px] flex-1">
                    <Select id="vincular-pedido" value="" onChange={(e) => e.target.value && act((d, ctx) => linkInvoiceOrder(d, ctx, invoice.id, e.target.value), 'Factura vinculada al pedido')}>
                      <option value="">{candidates.length ? 'Elige un pedido del mismo proveedor y local…' : 'No hay pedidos de este proveedor para este local'}</option>
                      {candidates.map((o) => <option key={o.id} value={o.id}>{o.id} · entrega {fmtDate(o.requestedDelivery)}</option>)}
                    </Select>
                  </Field>
                </div>
              )
            )}
            {analysis.order && editable && invoice.orderMatch === 'sugerido' && (
              <p className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-2.5 text-[12.5px] text-ink-3">
                <Info className="size-3.5" /> El documento no cita nuestro pedido: se vinculó por proveedor, local, fecha y artículos.
                <button type="button" className="font-medium text-forest-700 hover:underline" onClick={() => act((d, ctx) => linkInvoiceOrder(d, ctx, invoice.id, undefined))}>Desvincular</button>
              </p>
            )}
          </Panel>

          {/* Pagos */}
          {(isPayable(invoice) || invoice.status === 'pagada' || payments.length > 0) && (
            <Panel data-tour="factura-pagos">
              <PanelHeader
                title="Pagos"
                hint={invoice.status === 'pagada' ? 'Factura saldada' : `${fmtDue(invoice.dueDate, today)} · ${fmtDate(invoice.dueDate)}`}
                actions={
                  isPayable(invoice) ? (
                    <Button variant="primary" size="sm" icon={<Banknote className="size-4" />} onClick={() => setPaying(true)} disabledReason={!finance && 'Solo Contabilidad o Dirección registran pagos.'} data-tour="registrar-pago">
                      Registrar pago
                    </Button>
                  ) : undefined
                }
              />
              <dl className="grid grid-cols-3 gap-px border-b border-line bg-line" data-tour="factura-saldo">
                <div className="bg-paper px-5 py-3">
                  <dt className="text-[12px] text-ink-3">Total</dt>
                  <dd className="mt-0.5 text-[17px] font-semibold tabular-nums text-ink">{money(invoice.totalCents)}</dd>
                </div>
                <div className="bg-paper px-5 py-3">
                  <dt className="text-[12px] text-ink-3">Pagado</dt>
                  <dd className="mt-0.5 text-[17px] font-semibold tabular-nums text-ok-700">{money(paid)}</dd>
                </div>
                <div className="bg-paper px-5 py-3">
                  <dt className="text-[12px] text-ink-3">Saldo pendiente</dt>
                  <dd className={cn('mt-0.5 text-[17px] font-semibold tabular-nums', balance > 0 ? 'text-forest-900' : 'text-ok-700')}>{money(balance)}</dd>
                </div>
              </dl>
              {payments.length === 0 ? (
                <p className="px-5 py-4 text-[13.5px] text-ink-3">Aún no se ha registrado ningún pago.</p>
              ) : (
                <ul className="divide-y divide-line/70">
                  {payments.map((p) => (
                    <li key={p.id} className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-[13.5px]', p.voidedAt && 'opacity-55')}>
                      <span className="font-medium tabular-nums text-ink">{p.id}</span>
                      <span className="tabular-nums text-ink-2">{fmtDate(p.date)}</span>
                      <span className="text-ink-2">{PAYMENT_METHODS.find((m) => m.id === p.method)?.label} · <span className="tabular-nums">{p.reference || 'sin referencia'}</span></span>
                      <span className="text-[12.5px] text-ink-3">{userName(data, p.by)}</span>
                      <span className={cn('ml-auto font-semibold tabular-nums', p.voidedAt && 'line-through')}>{money(p.amountCents)}</span>
                      {p.voidedAt ? (
                        <Badge>Anulado</Badge>
                      ) : (
                        finance && (
                          <button type="button" className="text-[12.5px] font-medium text-ink-3 hover:text-danger-700 hover:underline" onClick={() => act((d, ctx) => voidPayment(d, ctx, p.id), 'Pago anulado · el saldo se ha recalculado')}>
                            Anular
                          </button>
                        )
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          {/* Trazabilidad */}
          {(invoice.corrections.length > 0 || invoice.validatedAt) && (
            <Panel className="px-5 py-4">
              <h2 className="serif text-[17px] font-[520] text-forest-900">Trazabilidad</h2>
              <ul className="mt-2 space-y-1.5 text-[13px] text-ink-2">
                {invoice.corrections.map((c, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <History className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
                    <span>
                      <strong className="font-medium text-ink">{FIELD_LABEL[c.field]}</strong> corregido de «{c.from}» a «{c.to}» · {userName(data, c.by)} · {fmtDateTime(c.at)}
                    </span>
                  </li>
                ))}
                {invoice.validatedAt && (
                  <li className="flex items-start gap-2">
                    <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-ok-700" />
                    <span>
                      Validada por {userName(data, invoice.validatedBy ?? '')} · {fmtDateTime(invoice.validatedAt)}
                      {invoice.validationNote && <span className="block italic">«{invoice.validationNote}»</span>}
                    </span>
                  </li>
                )}
              </ul>
            </Panel>
          )}

          {/* Acciones */}
          {invoice.status === 'por_revisar' && (
            <Panel className={cn('px-5 py-4', !touring && 'sticky bottom-4 z-10 shadow-pop')} data-tour="factura-acciones">
              {blockers.length > 0 && finance && (
                <ul className="mb-3 space-y-1 text-[12.5px] text-warn-800">
                  {blockers.map((b) => (
                    <li key={b} className="flex items-start gap-1.5"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {b}</li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button variant="ghost" disabled={!finance} onClick={() => setDiscarding(true)}>Descartar</Button>
                <Button
                  variant="secondary"
                  disabled={!finance}
                  onClick={() => {
                    setDisputeReason(analysis.anomalies.find((a) => a.kind !== 'duplicado')?.detail ?? '');
                    setDisputeAmount(((anomalyTotal || invoice.totalCents) / 100).toFixed(2));
                    setDisputing(true);
                  }}
                >
                  Poner en disputa
                </Button>
                <Button
                  variant="primary"
                  icon={<CircleCheck className="size-4" />}
                  disabledReason={!finance ? 'Solo Contabilidad o Dirección validan facturas.' : blockers[0] ?? false}
                  onClick={() => (analysis.anomalies.length > 0 ? setValidating(true) : doValidate())}
                  data-tour="validar-factura"
                >
                  Validar factura
                </Button>
              </div>
            </Panel>
          )}
          {invoice.status === 'en_disputa' && finance && (
            <div className="flex justify-end">
              <Button icon={<Undo2 className="size-4" />} onClick={() => act((d, ctx) => reopenInvoice(d, ctx, invoice.id, 'Disputa cerrada'), 'Disputa cerrada: la factura vuelve a revisión')}>
                Cerrar disputa y volver a revisión
              </Button>
            </div>
          )}
          {isPayable(invoice) && finance && (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDisputeReason('');
                  setDisputeAmount((balance / 100).toFixed(2));
                  setDisputing(true);
                }}
              >
                Poner en disputa
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Validar con diferencias */}
      <Modal
        open={validating}
        onOpenChange={setValidating}
        tourId="validar-dialogo"
        title="Validar con diferencias"
        description="La factura no coincide del todo con el pedido o la recepción. Deja constancia de cómo se resuelve: quedará en su trazabilidad."
        footer={
          <>
            <Button variant="ghost" onClick={() => setValidating(false)}>Volver</Button>
            <Button variant="primary" disabled={!resolution.trim()} onClick={() => doValidate(resolution)} data-tour="validar-confirmar">Validar factura</Button>
          </>
        }
      >
        <ul className="mb-3 space-y-1.5 text-[13px]">
          {analysis.anomalies.map((a, i) => (
            <li key={i} className="flex items-start gap-2 text-ink-2"><TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-danger-700" /> <span><strong className="font-medium text-ink">{a.title}.</strong> {a.detail}</span></li>
          ))}
        </ul>
        <fieldset className="space-y-2 pb-1">
          <legend className="mb-1.5 text-[12.5px] font-medium text-ink-2">¿Cómo se resuelve?</legend>
          {RESOLUTIONS.map((r) => (
            <label key={r} className={cn('flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13.5px] transition-colors', resolution === r ? 'border-forest-600 bg-forest-50' : 'border-line bg-white/60 hover:bg-linen/60')}>
              <input type="radio" name="resolucion" checked={resolution === r} onChange={() => setResolution(r)} className="mt-0.5 accent-forest-700" />
              {r}
            </label>
          ))}
          <Textarea value={RESOLUTIONS.includes(resolution) ? '' : resolution} onChange={(e) => setResolution(e.target.value)} placeholder="U otra explicación…" rows={2} className="min-h-[52px]" aria-label="Otra explicación" />
        </fieldset>
        <Note tone="forest" icon={<Info className="size-4" />} className="mt-3">Validar reconoce la deuda. Después podrás pagar solo una parte: el saldo se recalcula solo.</Note>
      </Modal>

      {/* Disputa */}
      <Modal
        open={disputing}
        onOpenChange={setDisputing}
        title="Poner la factura en disputa"
        description="El importe en disputa se muestra aparte y la factura deja de contar como deuda por pagar hasta que se resuelva."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDisputing(false)}>Cancelar</Button>
            <Button
              variant="danger"
              onClick={() => {
                const res = act((d, ctx) => disputeInvoice(d, ctx, invoice.id, { reason: disputeReason, amountCents: parseMoney(disputeAmount) ?? invoice.totalCents }), 'Factura en disputa');
                if (res.ok) setDisputing(false);
              }}
            >
              Abrir disputa
            </Button>
          </>
        }
      >
        <div className="space-y-4 pb-1">
          <Field label="Importe en disputa (USD)" htmlFor="disputa-importe">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">$</span>
              <Input id="disputa-importe" inputMode="decimal" value={disputeAmount} onChange={(e) => setDisputeAmount(e.target.value)} className="pl-6 tabular-nums" />
            </div>
          </Field>
          <Field label="Motivo" htmlFor="disputa-motivo">
            <Textarea id="disputa-motivo" value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} placeholder="Qué se reclama al proveedor." />
          </Field>
        </div>
      </Modal>

      {/* Descartar */}
      <Modal
        open={discarding}
        onOpenChange={setDiscarding}
        size="sm"
        title="¿Descartar esta factura?"
        description="No contará como deuda. El documento original se conserva y la decisión queda registrada."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDiscarding(false)}>Cancelar</Button>
            <Button
              variant="danger"
              onClick={() => {
                const res = act((d, ctx) => discardInvoice(d, ctx, invoice.id, analysis.duplicateOf ? 'Duplicado confirmado' : 'Documento no válido'), 'Factura descartada');
                if (res.ok) setDiscarding(false);
              }}
            >
              Descartar
            </Button>
          </>
        }
      />

      <PaymentDialog invoice={paying && isPayable(invoice) ? invoice : null} presetCents={presetCents} onClose={() => setPaying(false)} />
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/facturas" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-3 hover:text-ink">
      <ArrowLeft className="size-3.5" /> Bandeja de documentos
    </Link>
  );
}

