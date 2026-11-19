import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ArrowRight, Camera, ChevronDown, CopyCheck, FlaskConical, Inbox, MessageCircle, ScanLine, Search, ShieldAlert, Upload } from 'lucide-react';
import type { InvoiceStatus, LocationId } from '@/domain/types';
import { money, plural } from '@/domain/format';
import { fmtDate, fmtWhen, minutesBetween, panamaDay } from '@/domain/time';
import { analyzeInvoice } from '@/domain/invoices';
import { payables } from '@/domain/selectors';
import { processDocument, simulateInbound, toast, uploadDocument, useDemo, useLocationFilter, useNow, useUser, type InboundKind } from '@/store';
import { useQuery } from '@/lib/useQuery';
import { Avatar, Badge, Button, EmptyState, Input, LocationTag, PageHeader, Panel, Segmented, Spinner, TabBar, Table, Td, Th, Tr } from '@/ui/primitives';
import { Menu, MenuItem, MenuLabel } from '@/ui/overlays';
import { InvoiceStatusBadge } from '@/ui/status';
import { DocThumb } from './InvoiceDocument';
import { PagosView } from './PagosView';

type Estado = 'pendientes' | 'validadas' | 'pagadas' | 'en_disputa' | 'descartadas' | 'todas';
const MATCH: Record<Estado, InvoiceStatus[] | null> = {
  pendientes: ['recibida', 'por_revisar'],
  validadas: ['validada', 'parcialmente_pagada'],
  pagadas: ['pagada'],
  en_disputa: ['en_disputa'],
  descartadas: ['descartada'],
  todas: null,
};

export function FacturasPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const data = useDemo((s) => s.data);
  const user = useUser();
  const filter = useLocationFilter();
  const today = panamaDay(useNow());
  const section = pathname.endsWith('/pagos') && user.role !== 'gerente' ? 'pagos' : 'bandeja';
  const pendingCount =
    data.documents.filter((x) => !x.invoiceId && (filter === 'all' || x.locationId === filter)).length +
    data.invoices.filter((i) => i.status === 'por_revisar' && (filter === 'all' || i.locationId === filter)).length;
  const pay = payables(data, filter, today);

  return (
    <div>
      <PageHeader
        title="Facturas y pagos"
        subtitle={user.role === 'gerente' ? 'Envía aquí la foto de cada factura que recibas. Contabilidad la procesa y la contrasta con tu pedido y tu recepción.' : 'Las fotos de facturas que llegan por WhatsApp se convierten en datos, se contrastan con el pedido y la recepción, y alimentan el calendario de pagos.'}
        actions={section === 'bandeja' ? <InboxActions /> : undefined}
      />
      {user.role !== 'gerente' && (
        <TabBar
          label="Secciones de facturas"
          value={section}
          onChange={(v) => navigate(v === 'pagos' ? '/facturas/pagos' : '/facturas')}
          tabs={[
            { id: 'bandeja', label: 'Bandeja de documentos', count: pendingCount, attention: pendingCount > 0 },
            { id: 'pagos', label: 'Pagos a proveedores', count: pay.overdue.length > 0 ? pay.overdue.length : undefined, attention: pay.overdue.length > 0 },
          ]}
        />
      )}
      {section === 'bandeja' ? <InboxTab /> : <PagosView />}
    </div>
  );
}

// ───────────────────────────── Acciones de la bandeja ─────────────────────────────

function InboxActions() {
  const navigate = useNavigate();
  const user = useUser();
  const filter = useLocationFilter();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const target: LocationId = filter !== 'all' ? filter : user.locationId ?? 'sf';

  const simulate = (kind: InboundKind) => {
    const res = simulateInbound(kind, { locationId: filter !== 'all' ? filter : undefined });
    if (!res) return;
    toast('info', res.alreadyImported ? 'Ese archivo ya estaba importado' : 'Factura recibida por WhatsApp (simulado)', res.alreadyImported ? 'No se creó un documento nuevo.' : 'Aparece arriba en la bandeja, lista para procesar.');
    navigate(`/facturas?doc=${res.documentId}`);
  };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const res = await uploadDocument(file, target);
    if (!res) return;
    if (res.alreadyImported) {
      toast('info', 'Este archivo ya se había importado', 'Se abre el documento existente: no se crea un duplicado.');
    } else {
      toast('ok', 'Documento recibido', 'Queda registrado en la bandeja.');
    }
    navigate(`/facturas/${res.documentId}`);
  };

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
      <Button icon={<Camera className="size-4" />} onClick={() => cameraRef.current?.click()} className="md:hidden">
        Fotografiar
      </Button>
      <Button icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()} data-tour="cargar-archivo">
        Cargar archivo
      </Button>
      <Menu
        width={330}
        trigger={
          <Button variant="primary" icon={<MessageCircle className="size-4" />} iconRight={<ChevronDown className="size-3.5" />} data-tour="simular-factura">
            Simular llegada por WhatsApp
          </Button>
        }
      >
        <MenuLabel>Documentos de ejemplo</MenuLabel>
        <MenuItem icon={<FlaskConical className="size-4" />} hint="Factura todo lo pedido, aunque no haya llegado todo" onSelect={() => simulate('pedido')}>
          Factura de un pedido recibido
        </MenuItem>
        <MenuItem icon={<FlaskConical className="size-4" />} hint="El precio facturado supera al del pedido" onSelect={() => simulate('precio')}>
          Factura con otro precio
        </MenuItem>
        <MenuItem icon={<FlaskConical className="size-4" />} hint="Compra hecha fuera de la plataforma" onSelect={() => simulate('sin_pedido')}>
          Factura sin pedido
        </MenuItem>
        <MenuItem icon={<FlaskConical className="size-4" />} hint="Otra foto de una factura ya registrada" onSelect={() => simulate('duplicado')}>
          Reenvío de una factura existente
        </MenuItem>
      </Menu>
    </>
  );
}

// ───────────────────────────── Bandeja ─────────────────────────────

function InboxTab() {
  const navigate = useNavigate();
  const data = useDemo((s) => s.data);
  const extracting = useDemo((s) => s.ui.extracting);
  const user = useUser();
  const now = useNow();
  const filter = useLocationFilter();
  const [estado, setEstado] = useQuery<Estado>('estado', 'pendientes');
  const [docParam, setDocParam] = useQuery<string>('doc', '');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(25);
  const finance = user.role !== 'gerente';

  // Tras simular una llegada, se resalta el documento nuevo.
  useEffect(() => {
    if (!docParam) return;
    if (estado !== 'pendientes') setEstado('pendientes');
    const t = setTimeout(() => setDocParam(null), 6000);
    return () => clearTimeout(t);
  }, [docParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = data.documents
    .filter((x) => filter === 'all' || x.locationId === filter)
    .map((doc) => {
      const invoice = doc.invoiceId ? data.invoices.find((i) => i.id === doc.invoiceId) : undefined;
      const status: InvoiceStatus = invoice?.status ?? 'recibida';
      return { doc, invoice, status };
    })
    .sort((a, b) => (a.doc.receivedAt < b.doc.receivedAt ? 1 : -1));
  const count = (e: Estado) => rows.filter((r) => !MATCH[e] || MATCH[e]!.includes(r.status)).length;
  const needle = q.trim().toLowerCase();
  const list = rows
    .filter((r) => !MATCH[estado] || MATCH[estado]!.includes(r.status))
    .filter((r) => {
      if (!needle) return true;
      const sup = data.suppliers.find((s) => s.id === (r.invoice?.supplierId ?? r.doc.printed?.supplierId))?.name ?? '';
      return sup.toLowerCase().includes(needle) || (r.invoice?.number ?? '').toLowerCase().includes(needle) || r.doc.id.toLowerCase().includes(needle);
    });

  return (
    <Panel data-tour="bandeja">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
        <Segmented<Estado>
          label="Estado de las facturas"
          value={estado}
          onChange={(v) => { setEstado(v); setLimit(25); }}
          options={[
            { id: 'pendientes', label: 'Por procesar', count: count('pendientes') },
            { id: 'validadas', label: 'Validadas', count: count('validadas') },
            { id: 'pagadas', label: 'Pagadas', count: count('pagadas') },
            { id: 'en_disputa', label: 'En disputa', count: count('en_disputa') },
            { id: 'descartadas', label: 'Descartadas', count: count('descartadas') },
            { id: 'todas', label: 'Todas' },
          ]}
        />
        <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-[280px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proveedor o número…" aria-label="Buscar facturas" className="pl-9" />
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState icon={<Inbox className="size-5" />} title={estado === 'pendientes' ? 'Bandeja al día' : 'Nada en esta vista'}>
          {estado === 'pendientes'
            ? 'No hay documentos por procesar. Cuando un gerente envíe una factura por WhatsApp aparecerá aquí; puedes simularlo con el botón de arriba.'
            : 'Cambia el filtro de estado o de local.'}
        </EmptyState>
      ) : (
        <>
          <ul className="divide-y divide-line/80 md:hidden">
            {list.slice(0, limit).map(({ doc, invoice, status }) => {
              const supplier = data.suppliers.find((x) => x.id === (invoice?.supplierId ?? doc.printed?.supplierId));
              return (
                <li key={doc.id}>
                  <Link to={`/facturas/${invoice?.id ?? doc.id}`} className="flex items-center gap-3.5 px-4 py-3.5">
                    <DocThumb doc={doc} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium text-ink">{invoice ? `${supplier?.name ?? 'Proveedor por identificar'} · ${invoice.number || 'sin número'}` : 'Documento sin procesar'}</p>
                      <p className="mt-0.5 text-[12.5px] text-ink-3">{fmtWhen(doc.receivedAt, now)}{invoice ? ` · ${money(invoice.totalCents)}` : ''}</p>
                      <div className="mt-1.5"><InvoiceStatusBadge status={status} /></div>
                    </div>
                    <ArrowRight className="size-4 shrink-0 text-ink-3" />
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="hidden md:block">
          <Table minWidth={900}>
            <thead>
              <tr>
                <Th>Documento</Th>
                <Th>Enviado por</Th>
                <Th>Recibido</Th>
                <Th align="right">Total</Th>
                <Th>Estado</Th>
                <Th align="right"><span className="sr-only">Acción</span></Th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, limit).map(({ doc, invoice, status }) => {
                const supplier = data.suppliers.find((s) => s.id === (invoice?.supplierId ?? doc.printed?.supplierId));
                const sender = data.users.find((u) => u.id === doc.senderId);
                const loc = data.locations.find((l) => l.id === doc.locationId)!;
                const to = `/facturas/${invoice?.id ?? doc.id}`;
                const anomalies = invoice && invoice.status === 'por_revisar' ? analyzeInvoice(data, invoice).anomalies : [];
                const fresh = doc.id === docParam || minutesBetween(doc.receivedAt, now) < 2;
                const busy = extracting[doc.id];
                return (
                  <Tr key={doc.id} onClick={() => navigate(to)} className={fresh ? 'animate-flash' : undefined} data-tour={doc.id === docParam ? 'doc-nuevo' : `doc-${doc.id}`}>
                    <Td>
                      <div className="flex items-center gap-3.5">
                        <DocThumb doc={doc} />
                        <div className="min-w-0">
                          <Link to={to} onClick={(e) => e.stopPropagation()} className="font-medium text-ink hover:underline">
                            {invoice ? (
                              <>
                                {supplier?.name ?? 'Proveedor por identificar'} <span className="tabular-nums text-ink-2">· {invoice.number || 'sin número'}</span>
                              </>
                            ) : (
                              <>Documento sin procesar{doc.kind === 'archivo' ? ` · ${doc.fileName}` : ''}</>
                            )}
                          </Link>
                          <p className="text-[12.5px] text-ink-3">
                            {invoice ? `Emitida el ${fmtDate(invoice.issueDate)} · vence el ${fmtDate(invoice.dueDate)}` : doc.caption ? `«${doc.caption}»` : doc.fileName}
                          </p>
                          {anomalies.length > 0 && (
                            <p className="mt-1 flex flex-wrap gap-1.5">
                              {anomalies.slice(0, 2).map((a, i) => (
                                <Badge key={i} tone={a.kind === 'sin_pedido' ? 'warn' : 'danger'} icon={a.kind === 'duplicado' ? <CopyCheck className="size-3" /> : <ShieldAlert className="size-3" />}>
                                  {a.title}
                                </Badge>
                              ))}
                            </p>
                          )}
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar initials={sender?.initials ?? '?'} size={26} />
                        <div className="min-w-0">
                          <p className="truncate text-ink">{sender?.name ?? '—'}</p>
                          <p className="text-[12px] text-ink-3"><LocationTag id={loc.id} name={loc.name} /></p>
                        </div>
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">
                      {fmtWhen(doc.receivedAt, now)}
                      <div className="flex items-center gap-1 text-[12px] text-ink-3">
                        {doc.channel === 'whatsapp' ? <><MessageCircle className="size-3" /> WhatsApp</> : <><Upload className="size-3" /> Carga manual</>}
                      </div>
                    </Td>
                    <Td num className="font-medium">{invoice ? money(invoice.totalCents) : <span className="font-normal text-ink-4">—</span>}</Td>
                    <Td>
                      {busy ? <Badge tone="brass" icon={<Spinner className="size-3" />}>Leyendo…</Badge> : <InvoiceStatusBadge status={status} />}
                    </Td>
                    <Td align="right">
                      {!invoice ? (
                        <Button
                          size="sm"
                          variant="primary"
                          icon={<ScanLine className="size-3.5" />}
                          loading={busy}
                          disabledReason={!finance && 'Solo Contabilidad o Dirección procesan las facturas.'}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/facturas/${doc.id}`);
                            void processDocument(doc.id).then((invId) => invId && navigate(`/facturas/${invId}`, { replace: true }));
                          }}
                        >
                          Procesar
                        </Button>
                      ) : (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-medium text-forest-700">
                          {status === 'por_revisar' ? 'Revisar' : 'Ver'} <ArrowRight className="size-3.5" />
                        </span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          </div>
          {list.length > limit && (
            <div className="border-t border-line px-5 py-3 text-center">
              <Button variant="ghost" size="sm" onClick={() => setLimit((n) => n + 25)}>Mostrar más ({plural(list.length - limit, 'documento', 'documentos')})</Button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
