import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { AlarmClock, Banknote, CalendarClock, CalendarDays, Check, Download, FileSearch, Hourglass, Info, TriangleAlert } from 'lucide-react';
import type { DayStr, Invoice } from '@/domain/types';
import { PAYMENT_METHODS } from '@/data/catalog';
import { userName } from '@/domain/core';
import { money, money0, moneyCompact, plural } from '@/domain/format';
import { addDays, daysRange, fmtDate, fmtDayLong, fmtDayShort, fmtDue, monthName, panamaDay, weekday } from '@/domain/time';
import { INVOICE_STATUS_LABEL, balanceCents, paidCents, voidPayment } from '@/domain/invoices';
import { payables as computePayables, supplierBalances, type PayableRow } from '@/domain/selectors';
import { act, useDemo, useLocationFilter, useNow } from '@/store';
import { useQuery } from '@/lib/useQuery';
import { downloadCsv } from '@/lib/csv';
import { Badge, Button, EmptyState, LocationTag, Note, Panel, PanelHeader, Segmented, Table, Td, Th, Tr, cn } from '@/ui/primitives';
import { InvoiceStatusBadge } from '@/ui/status';
import { ChartFrame, DueChart, type DuePoint } from '@/ui/charts';
import { PaymentDialog } from './PaymentDialog';

type Vista = 'vencimientos' | 'vencidas' | 'semana' | 'calendario' | 'proveedores' | 'pagos';

function PayTable({ rows, onPay, today }: { rows: PayableRow[]; onPay: (inv: Invoice) => void; today: DayStr }) {
  const navigate = useNavigate();
  const data = useDemo((s) => s.data);
  return (
    <Table minWidth={860}>
      <thead>
        <tr>
          <Th>Factura</Th>
          <Th>Local</Th>
          <Th>Vencimiento</Th>
          <Th align="right">Total</Th>
          <Th align="right">Pagado</Th>
          <Th align="right">Saldo</Th>
          <Th align="right"><span className="sr-only">Acción</span></Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const loc = data.locations.find((l) => l.id === r.invoice.locationId)!;
          const overdue = r.bucket === 'vencida';
          return (
            <Tr key={r.invoice.id} onClick={() => navigate(`/facturas/${r.invoice.id}`)} data-tour={`pagar-${r.invoice.id}`}>
              <Td>
                <Link to={`/facturas/${r.invoice.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-ink hover:underline">
                  {r.supplier?.name}
                </Link>
                <div className="flex items-center gap-2 text-[12.5px] tabular-nums text-ink-3">
                  {r.invoice.number}
                  {r.invoice.status === 'parcialmente_pagada' && <InvoiceStatusBadge status="parcialmente_pagada" />}
                </div>
              </Td>
              <Td><LocationTag id={loc.id} name={loc.name} /></Td>
              <Td className="whitespace-nowrap">
                <span className="tabular-nums">{fmtDate(r.invoice.dueDate)}</span>
                <div className={cn('flex items-center gap-1 text-[12.5px]', overdue ? 'font-medium text-danger-700' : 'text-ink-3')}>
                  {overdue && <TriangleAlert className="size-3" />}
                  {fmtDue(r.invoice.dueDate, today)}
                </div>
              </Td>
              <Td num>{money(r.invoice.totalCents)}</Td>
              <Td num className="text-ink-2">{r.paidCents > 0 ? money(r.paidCents) : <span className="text-ink-4">—</span>}</Td>
              <Td num className="font-semibold">{money(r.balanceCents)}</Td>
              <Td align="right">
                <Button size="sm" variant={overdue ? 'primary' : 'secondary'} onClick={(e) => { e.stopPropagation(); onPay(r.invoice); }}>
                  Registrar pago
                </Button>
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}

export function PagosView() {
  const navigate = useNavigate();
  const data = useDemo((s) => s.data);
  const now = useNow();
  const today = panamaDay(now);
  const filter = useLocationFilter();
  const [vistaRaw, setVista] = useQuery<Vista>('vista', 'vencimientos');
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [selectedDay, setSelectedDay] = useState<DayStr | null>(null);
  const vista: Vista = vistaRaw === 'vencidas' || vistaRaw === 'semana' ? 'vencimientos' : vistaRaw;

  const p = computePayables(data, filter, today);
  const open = [...p.overdue, ...p.week, ...p.later];
  const paid30 = data.payments
    .filter((x) => !x.voidedAt && x.date >= addDays(today, -29))
    .filter((x) => {
      const inv = data.invoices.find((i) => i.id === x.invoiceId);
      return inv && (filter === 'all' || inv.locationId === filter);
    });
  const paid30Cents = paid30.reduce((t, x) => t + x.amountCents, 0);

  const exportCsv = () => {
    const row = (inv: Invoice, estado: string) => {
      const sup = data.suppliers.find((s) => s.id === inv.supplierId)?.name ?? '';
      const loc = data.locations.find((l) => l.id === inv.locationId)!.name;
      const paid = paidCents(data, inv.id);
      return [sup, inv.number, loc, fmtDate(inv.issueDate), fmtDate(inv.dueDate), estado, (inv.totalCents / 100).toFixed(2), (paid / 100).toFixed(2), ((inv.totalCents - paid) / 100).toFixed(2)];
    };
    const rows = [
      ...p.overdue.map((r) => row(r.invoice, 'Vencida')),
      ...p.week.map((r) => row(r.invoice, 'Vence en 7 días')),
      ...p.later.map((r) => row(r.invoice, 'Vence más adelante')),
      ...p.pendingValidation.map((i) => row(i, 'Pendiente de validar')),
      ...p.disputed.map((i) => row(i, 'En disputa')),
    ];
    downloadCsv(`saint-honore-cuentas-por-pagar-${today}.csv`, ['Proveedor', 'N.º de factura', 'Local', 'Emisión', 'Vencimiento', 'Situación', 'Total USD', 'Pagado USD', 'Saldo USD'], rows);
  };

  const buckets = [
    { key: 'vencidas', label: 'Vencidas', cents: p.totals.overdueCents, n: p.overdue.length, icon: AlarmClock, alert: p.overdue.length > 0, sub: p.overdue.length ? `la más antigua, del ${fmtDate(p.overdue[0].invoice.dueDate)}` : 'Nada vencido' },
    { key: 'semana', label: 'Por pagar en 7 días', cents: p.totals.weekCents, n: p.week.length, icon: CalendarClock, sub: p.week.length ? `la primera, el ${fmtDate(p.week[0].invoice.dueDate)}` : 'Nada vence esta semana' },
    { key: 'despues', label: 'Por pagar más adelante', cents: p.totals.laterCents, n: p.later.length, icon: CalendarDays, sub: p.later.length ? `hasta el ${fmtDate(p.later[p.later.length - 1].invoice.dueDate)}` : '—' },
    { key: 'pagadas', label: 'Pagado en 30 días', cents: paid30Cents, n: paid30.length, icon: Check, sub: 'pagos registrados', paid: true },
  ];

  return (
    <div className="space-y-6">
      {/* Lo que se debe, por urgencia */}
      <Panel className="overflow-hidden" data-tour="pagos-resumen">
        <div className="grid grid-cols-2 gap-px bg-line lg:grid-cols-4">
          {buckets.map((b) => (
            <div key={b.key} className="bg-paper px-5 py-4" data-tour={`bucket-${b.key}`}>
              <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-3">
                <b.icon className={cn('size-3.5', b.alert && 'text-danger-700')} strokeWidth={b.paid ? 3 : 2} />
                {b.label}
              </p>
              <p className={cn('mt-1.5 text-[26px] font-semibold leading-none tracking-[-0.02em]', b.alert ? 'text-danger-700' : 'text-forest-900')}>{money0(b.cents)}</p>
              <p className="mt-2 text-[12.5px] text-ink-2">
                {b.paid ? plural(b.n, 'pago', 'pagos') : plural(b.n, 'factura', 'facturas')} <span className="text-ink-3">· {b.sub}</span>
              </p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 border-t border-line bg-linen/50 px-5 py-3 text-[13px]">
          <span className="inline-flex items-center gap-2 text-ink-2">
            <FileSearch className="size-4 text-warn-700" />
            <span>
              Pendiente de validar: <strong className="font-semibold tabular-nums text-ink">{money(p.totals.pendingValidationCents)}</strong> · {plural(p.pendingValidation.length, 'factura', 'facturas')}
              <span className="text-ink-3"> (todavía no es deuda reconocida)</span>
            </span>
            <Link to="/facturas" className="font-medium text-forest-700 hover:underline">Revisar</Link>
          </span>
          <span className="inline-flex items-center gap-2 text-ink-2">
            <Hourglass className="size-4 text-danger-700" />
            <span>
              En disputa: <strong className="font-semibold tabular-nums text-ink">{money(p.totals.disputedCents)}</strong> · {plural(p.disputed.length, 'factura', 'facturas')}
            </span>
            <Link to="/facturas?estado=en_disputa" className="font-medium text-forest-700 hover:underline">Ver</Link>
          </span>
        </div>
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<Vista>
          label="Vista de pagos"
          value={vista}
          onChange={setVista}
          options={[
            { id: 'vencimientos', label: 'Por vencimiento', count: open.length },
            { id: 'calendario', label: 'Calendario' },
            { id: 'proveedores', label: 'Por proveedor' },
            { id: 'pagos', label: 'Pagos registrados' },
          ]}
        />
        <Button icon={<Download className="size-4" />} onClick={exportCsv} data-tour="exportar-csv">
          Exportar CSV
        </Button>
      </div>

      {vista === 'vencimientos' && (
        <div className="space-y-6">
          {open.length === 0 && (
            <Panel>
              <EmptyState icon={<Check className="size-5" />} title="Sin deuda validada pendiente">Todas las facturas validadas están pagadas.</EmptyState>
            </Panel>
          )}
          {p.overdue.length > 0 && (
            <Panel className="ring-1 ring-danger-100" data-tour="lista-vencidas">
              <PanelHeader title={<span className="flex items-center gap-2 text-danger-800"><AlarmClock className="size-[18px]" /> Vencidas</span>} hint={`${money(p.totals.overdueCents)} · ${plural(p.overdue.length, 'factura', 'facturas')}`} />
              <PayTable rows={p.overdue} onPay={setPaying} today={today} />
            </Panel>
          )}
          {p.week.length > 0 && (
            <Panel data-tour="lista-semana">
              <PanelHeader title="Vencen en los próximos 7 días" hint={`${money(p.totals.weekCents)} · ${plural(p.week.length, 'factura', 'facturas')}`} />
              <PayTable rows={p.week} onPay={setPaying} today={today} />
            </Panel>
          )}
          {p.later.length > 0 && (
            <Panel>
              <PanelHeader title="Vencen más adelante" hint={`${money(p.totals.laterCents)} · ${plural(p.later.length, 'factura', 'facturas')}`} />
              <PayTable rows={p.later} onPay={setPaying} today={today} />
            </Panel>
          )}
          <Panel>
            <details>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 hover:bg-linen/50">
                <span className="serif text-[18px] font-[520] text-forest-900">Ya pagadas</span>
                <span className="text-[13px] text-ink-3">{plural(p.paid.length, 'factura saldada', 'facturas saldadas')} · ver las más recientes</span>
              </summary>
              <Table minWidth={720}>
                <thead>
                  <tr>
                    <Th>Factura</Th>
                    <Th>Local</Th>
                    <Th>Vencía</Th>
                    <Th>Último pago</Th>
                    <Th align="right">Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {p.paid.slice(0, 15).map((inv) => {
                    const last = data.payments.filter((x) => x.invoiceId === inv.id && !x.voidedAt).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
                    const loc = data.locations.find((l) => l.id === inv.locationId)!;
                    return (
                      <Tr key={inv.id} onClick={() => navigate(`/facturas/${inv.id}`)}>
                        <Td>
                          <span className="font-medium text-ink">{data.suppliers.find((s) => s.id === inv.supplierId)?.name}</span>
                          <div className="text-[12.5px] tabular-nums text-ink-3">{inv.number}</div>
                        </Td>
                        <Td><LocationTag id={loc.id} name={loc.name} /></Td>
                        <Td className="tabular-nums text-ink-2">{fmtDate(inv.dueDate)}</Td>
                        <Td className="tabular-nums text-ink-2">{last ? `${fmtDate(last.date)} · ${last.reference}` : '—'}</Td>
                        <Td num className="font-medium">{money(inv.totalCents)}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </details>
          </Panel>
        </div>
      )}

      {vista === 'calendario' && <CalendarView rows={open} today={today} selected={selectedDay} onSelect={setSelectedDay} onPay={setPaying} />}

      {vista === 'proveedores' && (
        <Panel data-tour="pagos-proveedores">
          <PanelHeader title="Saldo por proveedor" hint="Deuda validada, lo que aún está en revisión y lo que está en disputa, por separado" />
          <Table minWidth={900}>
            <thead>
              <tr>
                <Th>Proveedor</Th>
                <Th align="right">Saldo por pagar</Th>
                <Th align="right">Vencido</Th>
                <Th align="right">Próximos 7 días</Th>
                <Th>Próximo vencimiento</Th>
                <Th align="right">Por validar</Th>
                <Th align="right">En disputa</Th>
                <Th align="right">Pagado 30 días</Th>
              </tr>
            </thead>
            <tbody>
              {supplierBalances(data, filter, today).map((b) => (
                <Tr key={b.supplier.id}>
                  <Td>
                    <p className="font-medium text-ink">{b.supplier.name}</p>
                    <p className="text-[12.5px] text-ink-3">Pago a {b.supplier.paymentTermsDays} días · {plural(b.openInvoices, 'factura abierta', 'facturas abiertas')}</p>
                  </Td>
                  <Td num className="font-semibold">{money(b.balanceCents)}</Td>
                  <Td num>{b.overdueCents > 0 ? <span className="inline-flex items-center gap-1 font-medium text-danger-700"><TriangleAlert className="size-3" />{money(b.overdueCents)}</span> : <span className="text-ink-4">—</span>}</Td>
                  <Td num>{b.weekCents > 0 ? money(b.weekCents) : <span className="text-ink-4">—</span>}</Td>
                  <Td className="tabular-nums text-ink-2">{b.nextDue ? `${fmtDate(b.nextDue)} · ${fmtDue(b.nextDue, today).toLowerCase()}` : '—'}</Td>
                  <Td num className="text-ink-2">{b.pendingValidationCents > 0 ? money(b.pendingValidationCents) : <span className="text-ink-4">—</span>}</Td>
                  <Td num className="text-ink-2">{b.disputedCents > 0 ? money(b.disputedCents) : <span className="text-ink-4">—</span>}</Td>
                  <Td num className="text-ink-2">{b.paid30Cents > 0 ? money(b.paid30Cents) : <span className="text-ink-4">—</span>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}

      {vista === 'pagos' && (
        <Panel data-tour="pagos-registrados">
          <PanelHeader title="Pagos registrados" hint="Anotaciones de pagos hechos por fuera de la plataforma. Anular un pago recalcula el saldo de su factura." />
          <Table minWidth={860}>
            <thead>
              <tr>
                <Th>Pago</Th>
                <Th>Proveedor y factura</Th>
                <Th>Medio</Th>
                <Th>Registró</Th>
                <Th align="right">Importe</Th>
                <Th align="right"><span className="sr-only">Acción</span></Th>
              </tr>
            </thead>
            <tbody>
              {data.payments
                .filter((x) => {
                  const inv = data.invoices.find((i) => i.id === x.invoiceId);
                  return inv && (filter === 'all' || inv.locationId === filter);
                })
                .slice()
                .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
                .slice(0, 40)
                .map((pay) => {
                  const inv = data.invoices.find((i) => i.id === pay.invoiceId)!;
                  return (
                    <Tr key={pay.id} onClick={() => navigate(`/facturas/${inv.id}`)} className={pay.voidedAt ? 'opacity-55' : undefined}>
                      <Td>
                        <span className="font-medium tabular-nums text-ink">{pay.id}</span>
                        <div className="text-[12.5px] tabular-nums text-ink-3">{fmtDate(pay.date)}</div>
                      </Td>
                      <Td>
                        {data.suppliers.find((s) => s.id === inv.supplierId)?.name}
                        <div className="text-[12.5px] tabular-nums text-ink-3">{inv.number} · {INVOICE_STATUS_LABEL[inv.status].toLowerCase()} · saldo {money(balanceCents(data, inv))}</div>
                      </Td>
                      <Td>
                        {PAYMENT_METHODS.find((m) => m.id === pay.method)?.label}
                        <div className="text-[12.5px] tabular-nums text-ink-3">{pay.reference || 'sin referencia'}</div>
                      </Td>
                      <Td className="text-ink-2">{userName(data, pay.by)}</Td>
                      <Td num className={cn('font-semibold', pay.voidedAt && 'line-through')}>{money(pay.amountCents)}</Td>
                      <Td align="right">
                        {pay.voidedAt ? (
                          <Badge>Anulado</Badge>
                        ) : (
                          <button type="button" className="text-[12.5px] font-medium text-ink-3 hover:text-danger-700 hover:underline" onClick={(e) => { e.stopPropagation(); act((d, ctx) => voidPayment(d, ctx, pay.id), 'Pago anulado · el saldo se ha recalculado'); }}>
                            Anular
                          </button>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
            </tbody>
          </Table>
        </Panel>
      )}

      <Note tone="neutral" icon={<Info className="size-4" />}>
        «Registrar pago» anota en la plataforma un pago que ya hiciste por tu banco: no mueve dinero. Solo la deuda <strong>validada</strong> entra en estas cifras; lo pendiente de validar y lo que está en disputa se muestran aparte.
      </Note>

      <PaymentDialog invoice={paying} onClose={() => setPaying(null)} />
    </div>
  );
}

// ───────────────────────────── Calendario de vencimientos ─────────────────────────────

function CalendarView({ rows, today, selected, onSelect, onPay }: {
  rows: PayableRow[]; today: DayStr; selected: DayStr | null; onSelect: (d: DayStr | null) => void; onPay: (inv: Invoice) => void;
}) {
  const byDay = new Map<DayStr, PayableRow[]>();
  for (const r of rows) byDay.set(r.invoice.dueDate, [...(byDay.get(r.invoice.dueDate) ?? []), r]);
  const overdue = rows.filter((r) => r.bucket === 'vencida');

  // Cinco semanas completas a partir del lunes de la semana en curso.
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  const days = daysRange(monday, addDays(monday, 34));
  const chart: DuePoint[] = daysRange(today, addDays(today, 34)).map((day) => {
    const list = byDay.get(day) ?? [];
    return { day, cents: list.reduce((t, r) => t + r.balanceCents, 0), count: list.length };
  });
  const sel = selected ?? today;
  const selRows = sel === today ? [...overdue, ...(byDay.get(today) ?? [])] : byDay.get(sel) ?? [];

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <Panel className="p-5" data-tour="calendario">
        <ChartFrame
          title="Lo que vence cada día"
          hint="Saldo de facturas validadas · próximos 35 días"
          table={
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-ink-3">
                  <th className="sticky top-0 bg-paper px-3 py-2 font-medium">Día</th>
                  <th className="sticky top-0 bg-paper px-3 py-2 text-right font-medium">Facturas</th>
                  <th className="sticky top-0 bg-paper px-3 py-2 text-right font-medium">Importe</th>
                </tr>
              </thead>
              <tbody>
                {chart.filter((c) => c.count > 0).map((c) => (
                  <tr key={c.day} className="border-t border-line/70">
                    <td className="px-3 py-1.5">{fmtDate(c.day)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{c.count}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(c.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        >
          <DueChart data={chart} today={today} />
        </ChartFrame>

        <div className="mt-6">
          <div className="grid grid-cols-7 gap-px text-center text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
            {['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map((d) => <div key={d} className="pb-1.5">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-line bg-line">
            {days.map((day) => {
              const list = byDay.get(day) ?? [];
              const cents = list.reduce((t, r) => t + r.balanceCents, 0);
              const past = day < today;
              const isToday = day === today;
              const dnum = Number(day.slice(8));
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => onSelect(day)}
                  aria-label={`${fmtDayLong(day)}: ${list.length ? `${plural(list.length, 'factura', 'facturas')}, ${money(cents)}` : 'sin vencimientos'}`}
                  aria-pressed={sel === day}
                  className={cn(
                    'relative flex min-h-[68px] flex-col items-start gap-1 px-2 py-1.5 text-left transition-colors',
                    sel === day ? 'bg-brass-50' : past ? 'bg-linen/60 hover:bg-linen' : 'bg-paper hover:bg-linen/60',
                  )}
                >
                  <span className={cn('flex h-5 items-center rounded-full text-[12px] tabular-nums', isToday ? 'bg-forest-700 px-1.5 font-semibold text-paper' : past ? 'text-ink-4' : 'text-ink-2')}>
                    {dnum === 1 || day === days[0] ? `${dnum} ${monthName(day).slice(0, 3)}` : dnum}
                    {isToday && <span className="ml-1">hoy</span>}
                  </span>
                  {list.length > 0 && (
                    <>
                      <span className={cn('text-[13px] font-semibold tabular-nums', past ? 'text-danger-700' : 'text-forest-900')}>{moneyCompact(cents)}</span>
                      <span className={cn('flex items-center gap-1 text-[11px]', past ? 'text-danger-700' : 'text-ink-3')}>
                        {past && <TriangleAlert className="size-2.5" />}
                        {plural(list.length, 'factura', 'facturas')}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </Panel>

      <Panel className="self-start">
        <PanelHeader
          title={sel === today ? 'Hoy y atrasadas' : fmtDayLong(sel)}
          hint={selRows.length ? `${money(selRows.reduce((t, r) => t + r.balanceCents, 0))} · ${plural(selRows.length, 'factura', 'facturas')}` : 'Sin vencimientos'}
        />
        {selRows.length === 0 ? (
          <EmptyState icon={<CalendarDays className="size-5" />} title="Nada vence este día">Elige otro día del calendario para ver sus facturas.</EmptyState>
        ) : (
          <ul className="divide-y divide-line/80">
            {selRows.map((r) => (
              <li key={r.invoice.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <Link to={`/facturas/${r.invoice.id}`} className="text-[14px] font-medium text-ink hover:underline">{r.supplier?.name}</Link>
                  <p className={cn('text-[12.5px] tabular-nums', r.bucket === 'vencida' ? 'font-medium text-danger-700' : 'text-ink-3')}>
                    {r.invoice.number} · {r.bucket === 'vencida' ? fmtDue(r.invoice.dueDate, today) : `vence el ${fmtDayShort(r.invoice.dueDate)}`}
                  </p>
                </div>
                <span className="text-[14px] font-semibold tabular-nums">{money(r.balanceCents)}</span>
                <Button size="sm" icon={<Banknote className="size-3.5" />} onClick={() => onPay(r.invoice)}>Pagar</Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
