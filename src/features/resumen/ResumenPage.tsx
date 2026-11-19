import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, Banknote, ClipboardList, FileText, PackageCheck, ReceiptText, Send,
  ShieldCheck, Store, TriangleAlert, Wallet,
} from 'lucide-react';
import type { AuditEntity, LocationId } from '@/domain/types';
import {
  alerts as computeAlerts, kpis as computeKpis, locationStats, payables, periodRange, posNeedsAttention, salesSeries,
} from '@/domain/selectors';
import { addDays, fmtAgo, fmtDayLong, fmtWhen, greeting, panamaDay } from '@/domain/time';
import { userName } from '@/domain/core';
import { fmtInt, money, money0, percent, plural, signedPercent } from '@/domain/format';
import { useDemo, useLocationFilter, useNow, usePeriod, useUser } from '@/store';
import { Badge, Button, EmptyState, LocationTag, Panel, PanelHeader, Tip, cn } from '@/ui/primitives';
import { PosStatusBadge } from '@/ui/status';
import { SalesChart } from '@/ui/charts';
import { AttentionRow } from './Attention';

interface KpiDef {
  key: string;
  label: string;
  value: string;
  sub: React.ReactNode;
  to: string;
  delta?: { ratio: number; label: string; short: string };
  alert?: boolean;
}

function KpiCell({ k }: { k: KpiDef }) {
  return (
    <Link
      to={k.to}
      data-tour={`kpi-${k.key}`}
      className="group relative flex min-w-0 flex-col gap-2 bg-paper px-5 py-4 transition-colors hover:bg-[#f7f2e8] focus-visible:z-10 xl:px-4 2xl:px-5"
    >
      <ArrowUpRight className="absolute right-3 top-3 size-3.5 text-ink-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium leading-tight text-ink-3">
        {k.alert && <TriangleAlert className="size-3.5 shrink-0 text-danger-700" aria-label="Requiere atención" />}
        <span className="truncate">{k.label}</span>
      </span>
      <span className={cn('text-[26px] font-semibold leading-none tracking-[-0.02em]', k.alert ? 'text-danger-700' : 'text-forest-900')}>{k.value}</span>
      <span className="text-[12.5px] leading-snug text-ink-2">
        {k.delta && (
          <Tip content={k.delta.label}>
            <span className={cn('mb-0.5 flex w-fit items-center gap-1 whitespace-nowrap font-semibold', k.delta.ratio >= 0 ? 'text-ok-700' : 'text-danger-700')}>
              {k.delta.ratio >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
              {signedPercent(k.delta.ratio)}
              <span className="font-normal text-ink-3">{k.delta.short}</span>
            </span>
          </Tip>
        )}
        {k.sub}
      </span>
    </Link>
  );
}

const ENTITY_ICON: Record<AuditEntity, typeof Send> = {
  pedido: Send,
  recepcion: PackageCheck,
  factura: FileText,
  pago: Banknote,
  inventario: ClipboardList,
  caja: Store,
  receta: ClipboardList,
  documento: ReceiptText,
  configuracion: ShieldCheck,
};

export function ResumenPage() {
  const navigate = useNavigate();
  const data = useDemo((s) => s.data);
  const user = useUser();
  const now = useNow();
  const today = panamaDay(now);
  const filter = useLocationFilter();
  const period = usePeriod();
  const [showAll, setShowAll] = useState(false);

  const k = computeKpis(data, filter, period, today);
  const range = periodRange(period, today);
  const pay = payables(data, filter, today);
  const list = computeAlerts(data, user, now);
  const visible = showAll ? list : list.slice(0, 6);
  const stats = locationStats(data, period, today);
  const scopeLocations = data.locations.filter((l) => filter === 'all' || l.id === filter);
  const chartFrom = period === 'hoy' ? addDays(today, -6) : range.from;
  const series = salesSeries(data, chartFrom, today);
  const locLabel = filter === 'all' ? 'Todos los locales' : scopeLocations[0].name;

  const salesKpi: KpiDef = {
    key: 'ventas', label: 'Ventas del período', value: money0(k.sales.revenueCents), to: '/ventas',
    delta: k.salesDelta !== null ? { ratio: k.salesDelta, label: `Tendencia ${k.salesDeltaLabel}`, short: 'vs. previo' } : undefined,
    sub: `${fmtInt(k.sales.tickets)} tickets`,
  };
  const purchasesKpi: KpiDef = {
    key: 'compras', label: 'Compras recibidas', value: money0(k.flow.receivedCents), to: '/compras?vista=pedidos',
    sub: k.costRatio !== null ? `${percent(k.costRatio)} de las ventas · ${plural(k.flow.receptions, 'recepción', 'recepciones')}` : plural(k.flow.receptions, 'recepción', 'recepciones'),
  };
  const stockKpi: KpiDef = { key: 'inventario', label: 'Valor del inventario', value: money0(k.stockValueCents), to: '/inventario', sub: 'Estimado al último costo de compra' };
  const dueKpi: KpiDef = {
    key: 'pagos', label: 'Pagos en 7 días', value: money0(k.due7Cents), to: '/facturas/pagos?vista=semana',
    sub: k.due7Count === 0 ? 'Nada vence esta semana' : plural(k.due7Count, 'factura validada', 'facturas validadas'),
  };
  const overdueKpi: KpiDef = {
    key: 'vencidas', label: 'Facturas vencidas', value: money0(k.overdueCents), to: '/facturas/pagos?vista=vencidas', alert: k.overdueCount > 0,
    sub: k.overdueCount === 0 ? 'Ninguna factura vencida' : plural(k.overdueCount, 'factura sin pagar', 'facturas sin pagar'),
  };
  const lowKpi: KpiDef = {
    key: 'minimo', label: 'Bajo mínimo', value: fmtInt(k.belowMin), to: '/inventario?nivel=bajo', alert: k.critical > 0,
    sub: k.belowMin === 0 ? 'Todo por encima del mínimo' : `${plural(k.belowMin, 'producto', 'productos')} · ${k.critical > 0 ? `${k.critical} con riesgo de quiebre` : 'sin riesgo inmediato'}`,
  };

  let cells: KpiDef[] = [salesKpi, purchasesKpi, stockKpi, dueKpi, overdueKpi, lowKpi];
  if (user.role === 'gerente') {
    const pos = data.posConnections.find((c) => c.locationId === user.locationId);
    cells = [
      salesKpi, purchasesKpi, stockKpi,
      {
        key: 'curso', label: 'Pedidos por recibir', value: money0(k.flow.committedCents), to: '/compras?vista=pedidos',
        sub: plural(k.flow.committedOrders, 'pedido en curso', 'pedidos en curso'),
      },
      lowKpi,
      {
        key: 'caja', label: 'Última sincronización', value: pos ? fmtAgo(pos.lastSyncAt, now).replace('hace ', '') : '—', to: '/ventas',
        alert: pos ? posNeedsAttention(pos, now) : false, sub: pos ? `Caja · ${fmtWhen(pos.lastSyncAt, now)}` : 'Sin caja configurada',
      },
    ];
  } else if (user.role === 'contabilidad') {
    cells = [
      { key: 'porpagar', label: 'Deuda validada por pagar', value: money0(pay.totals.payableCents), to: '/facturas/pagos', sub: plural(pay.overdue.length + pay.week.length + pay.later.length, 'factura', 'facturas') },
      dueKpi,
      overdueKpi,
      { key: 'porvalidar', label: 'Pendiente de validar', value: money0(pay.totals.pendingValidationCents), to: '/facturas', sub: `${plural(pay.pendingValidation.length, 'factura', 'facturas')} · aún no es deuda` },
      { key: 'disputa', label: 'En disputa', value: money0(pay.totals.disputedCents), to: '/facturas?estado=en_disputa', sub: plural(pay.disputed.length, 'factura', 'facturas') },
      { key: 'pagado', label: 'Pagado en el período', value: money0(k.flow.paidCents), to: '/facturas/pagos?vista=pagos', sub: plural(k.flow.payments, 'pago registrado', 'pagos registrados') },
    ];
  }

  const feed = data.audit
    .filter((e) => !(e.action === 'caja.sincronizada' && e.by === 'sistema'))
    .filter((e) => filter === 'all' || !e.locationId || e.locationId === filter)
    .slice(-7)
    .reverse();

  const flow = k.flow;
  const steps = [
    {
      icon: Send, label: 'Comprometido', value: flow.committedCents,
      text: `${plural(flow.committedOrders, 'pedido aprobado o enviado', 'pedidos aprobados o enviados')} que aún no se ha recibido.` +
        (flow.awaitingApprovalOrders > 0 ? ` Además, ${money0(flow.awaitingApprovalCents)} esperan aprobación.` : ''),
      tag: 'Ahora mismo',
    },
    { icon: PackageCheck, label: 'Recibido', value: flow.receivedCents, text: `${plural(flow.receptions, 'recepción', 'recepciones')}: la mercancía que de verdad entró en inventario.`, tag: 'En el período' },
    { icon: ReceiptText, label: 'Facturado', value: flow.invoicedCents, text: `${plural(flow.invoices, 'factura', 'facturas')} con fecha en el período, impuestos incluidos.`, tag: 'En el período' },
    { icon: Wallet, label: 'Pagado', value: flow.paidCents, text: `${plural(flow.payments, 'pago registrado', 'pagos registrados')} a proveedores.`, tag: 'En el período' },
  ];

  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow mb-1.5 text-brass-700">{fmtDayLong(today)}</p>
        <h1 className="serif text-[32px] font-[500] leading-[1.1] text-forest-900 sm:text-[36px]">
          {greeting(now)}, {user.first}
        </h1>
        <p className="mt-2 text-[14px] text-ink-2">
          {locLabel} · {range.label}
          <span className="text-ink-3"> · datos de demostración</span>
        </p>
      </header>

      {/* Indicadores: cada uno abre su detalle */}
      <Panel className="mb-6 overflow-hidden" data-tour="kpis">
        <div className="grid grid-cols-2 gap-px bg-line md:grid-cols-3 xl:grid-cols-6">
          {cells.map((c) => (
            <KpiCell key={c.key} k={c} />
          ))}
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Panel data-tour="atencion">
            <PanelHeader
              title="Lo que requiere tu atención"
              hint={list.length === 0 ? 'Nada pendiente' : `${plural(list.length, 'asunto', 'asuntos')}, del más urgente al menos urgente`}
            />
            {list.length === 0 ? (
              <EmptyState icon={<ShieldCheck className="size-5" />} title="Todo en orden">
                No hay quiebres de stock, facturas con diferencias ni pagos urgentes en este momento.
              </EmptyState>
            ) : (
              <>
                <ul className="divide-y divide-line/80">
                  {visible.map((a, i) => (
                    <AttentionRow key={a.id} alert={a} emphasize={i === 0} />
                  ))}
                </ul>
                {list.length > 6 && (
                  <div className="border-t border-line px-5 py-2.5">
                    <button type="button" onClick={() => setShowAll((v) => !v)} className="text-[13px] font-medium text-forest-700 hover:underline">
                      {showAll ? 'Ver menos' : `Ver ${list.length - 6} más`}
                    </button>
                  </div>
                )}
              </>
            )}
          </Panel>

          <Panel className="p-5">
            <SalesChart data={series} locations={scopeLocations} />
            {period === 'hoy' && <p className="mt-2 text-[12px] text-ink-3">Se muestran los últimos 7 días como contexto para el día en curso.</p>}
          </Panel>
        </div>

        <div className="min-w-0 space-y-6">
          <Panel data-tour="flujo-compras">
              <PanelHeader title="Del pedido al pago" hint="Cuatro cifras distintas que nunca se suman entre sí" />
              <ol className="divide-y divide-line/80">
                {steps.map((s) => (
                  <li key={s.label} className="flex items-start gap-3.5 px-5 py-3">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-forest-50 text-forest-700 ring-1 ring-inset ring-forest-100">
                      <s.icon className="size-4" strokeWidth={1.8} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-[14px] font-medium text-ink">
                          {s.label} <span className="ml-1 text-[11.5px] font-normal text-ink-3">{s.tag}</span>
                        </p>
                        <p className="text-[16px] font-semibold tabular-nums text-forest-900">{money0(s.value)}</p>
                      </div>
                      <p className="mt-0.5 text-[12.5px] leading-snug text-ink-3">{s.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
          </Panel>

          {user.role !== 'gerente' && (
            <Panel>
              <PanelHeader title="Comparativa de locales" hint={`Datos de demostración · ${range.label}`} />
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                    <th scope="col" className="border-b border-line py-2.5 pl-5 pr-2 text-left">Local</th>
                    <th scope="col" className="border-b border-line px-2 py-2.5 text-right">Ventas</th>
                    <th scope="col" className="border-b border-line px-2 py-2.5 text-right">
                      <Tip content="Compras recibidas ÷ ventas del período"><span tabIndex={0}>Compras</span></Tip>
                    </th>
                    <th scope="col" className="border-b border-line py-2.5 pl-2 pr-5 text-right">
                      <Tip content="Productos por debajo de su mínimo"><span tabIndex={0}>Mín.</span></Tip>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s) => {
                    const loc = data.locations.find((l) => l.id === s.locationId)!;
                    const stale = s.pos ? posNeedsAttention(s.pos, now) : false;
                    return (
                      <tr
                        key={s.locationId}
                        onClick={() => navigate(`/ventas?local=${s.locationId}`)}
                        className={cn('cursor-pointer transition-colors hover:bg-linen/60', filter === s.locationId && 'bg-brass-50/70')}
                      >
                        <td className="border-b border-line/70 py-3 pl-5 pr-2">
                          <Link to={`/ventas?local=${s.locationId}`} className="font-medium text-ink hover:underline" onClick={(e) => e.stopPropagation()}>
                            <LocationTag id={loc.id as LocationId} name={loc.name} />
                          </Link>
                          <div className="mt-1.5">{s.pos && <PosStatusBadge conn={s.pos} stale={stale} compact />}</div>
                        </td>
                        <td className="whitespace-nowrap border-b border-line/70 px-2 py-3 text-right tabular-nums">
                          <span className="font-medium">{money0(s.sales.revenueCents)}</span>
                          <div className="text-[12px] text-ink-3">ticket {money(s.sales.avgTicketCents)}</div>
                        </td>
                        <td className="whitespace-nowrap border-b border-line/70 px-2 py-3 text-right tabular-nums">
                          {money0(s.receivedCents)}
                          <div className="text-[12px] text-ink-3">{s.costRatio !== null ? percent(s.costRatio) : '—'}</div>
                        </td>
                        <td className="border-b border-line/70 py-3 pl-2 pr-5 text-right tabular-nums">
                          {s.belowMin > 0 ? <Badge tone="warn" icon={<TriangleAlert className="size-3" />}>{s.belowMin}</Badge> : <span className="text-ink-3">0</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
          )}

          <Panel>
            <PanelHeader
              title="Actividad reciente"
              actions={
                <Button size="sm" variant="ghost" onClick={() => navigate('/actividad')} iconRight={<ArrowRight className="size-3.5" />}>
                  Ver todo
                </Button>
              }
            />
            <ul className="divide-y divide-line/80">
              {feed.map((e) => {
                const Icon = ENTITY_ICON[e.entity];
                return (
                  <li key={e.id} className="flex items-start gap-3 px-5 py-2.5">
                    <Icon className="mt-0.5 size-4 shrink-0 text-ink-3" strokeWidth={1.8} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] leading-snug text-ink">{e.summary}</p>
                      <p className="mt-0.5 text-[12px] text-ink-3">
                        {userName(data, e.by)} · {fmtWhen(e.at, now)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
