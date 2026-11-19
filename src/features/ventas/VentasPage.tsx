import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowRight, Check, CopyCheck, FlaskConical, Info, Link2, Plus, RefreshCw, Trash2, TriangleAlert, Unlink, Utensils,
} from 'lucide-react';
import type { ID, LocationId, PosItem, SyncRun } from '@/domain/types';
import { userName } from '@/domain/core';
import { fmtInt, money, money0, plural, qty as fmtQty, qtyBase } from '@/domain/format';
import { addDays, fmtAgo, fmtDate, fmtDateTime, fmtTime, fmtWhen, panamaDay } from '@/domain/time';
import { explainConsumption, mapPosItem, queueDemoSale } from '@/domain/sales';
import { itemSales, periodRange, posNeedsAttention, salesSeries, salesTotals, undeductedByItem } from '@/domain/selectors';
import { act, syncPos, toast, useDemo, useLocationFilter, useNow, usePeriod, useUser } from '@/store';
import { useQuery } from '@/lib/useQuery';
import {
  Badge, Button, Checkbox, EmptyState, Field, LocationTag, Note, PageHeader, Panel, PanelHeader, Select, Stepper, TabBar, Table, Td, Th, Tr, cn,
} from '@/ui/primitives';
import { Drawer, Modal } from '@/ui/overlays';
import { PosStatusBadge } from '@/ui/status';
import { RankedBars, SalesChart } from '@/ui/charts';
import { RecipeEditor } from '@/features/inventario/RecipesTab';

type Vista = 'resumen' | 'correspondencias' | 'sincronizaciones';

export function VentasPage() {
  const data = useDemo((s) => s.data);
  const syncing = useDemo((s) => s.ui.syncing);
  const filter = useLocationFilter();
  const [vista, setVista] = useQuery<Vista>('vista', 'resumen');
  const [syncId, setSyncId] = useQuery<string>('sync', '');
  const [demoSale, setDemoSale] = useState<LocationId | null>(null);

  const scope = data.locations.filter((l) => filter === 'all' || l.id === filter);
  const pending = data.posItems.filter((i) => i.mapping === 'pendiente').length;
  const anySyncing = scope.some((l) => syncing[l.id]);

  const sync = async (ids: LocationId[]) => {
    const runs: SyncRun[] = [];
    for (const id of ids) {
      const r = await syncPos(id);
      if (r) runs.push(r);
    }
    if (runs.length === 0) return;
    const imported = runs.reduce((t, r) => t + r.imported, 0);
    const dup = runs.reduce((t, r) => t + r.duplicates, 0);
    toast(
      'ok',
      imported > 0 ? `${plural(imported, 'ticket nuevo importado', 'tickets nuevos importados')}` : 'Sin tickets nuevos',
      dup > 0 ? `${plural(dup, 'ticket ya estaba importado y se omitió', 'tickets ya estaban importados y se omitieron')}: nada se duplica.` : undefined,
    );
    if (runs.length === 1) setSyncId(runs[0].id);
  };

  const run = syncId ? data.syncRuns.find((r) => r.id === syncId) : undefined;

  return (
    <div>
      <PageHeader
        title="Ventas y cajas"
        subtitle="Las ventas de cada caja llegan a un mismo lugar. Cada ticket se importa una sola vez y descuenta del inventario según su receta."
        actions={
          <Button variant="primary" icon={<RefreshCw className={cn('size-4', anySyncing && 'animate-spin')} />} disabled={anySyncing} onClick={() => void sync(scope.map((l) => l.id))} data-tour="sync-todas">
            {scope.length === 1 ? 'Sincronizar ventas' : 'Sincronizar todas las cajas'}
          </Button>
        }
      />
      <TabBar<Vista>
        label="Secciones de ventas"
        value={vista}
        onChange={setVista}
        tabs={[
          { id: 'resumen', label: 'Ventas y cajas' },
          { id: 'correspondencias', label: 'Artículos y recetas', count: pending > 0 ? pending : undefined, attention: pending > 0 },
          { id: 'sincronizaciones', label: 'Sincronizaciones' },
        ]}
      />
      {vista === 'resumen' && <ResumenTab onSync={(id) => void sync([id])} onDemoSale={setDemoSale} onOpenRun={setSyncId} />}
      {vista === 'correspondencias' && <MappingTab />}
      {vista === 'sincronizaciones' && <RunsTab onOpen={setSyncId} />}

      <SyncDrawer run={run} onClose={() => setSyncId(null)} />
      <DemoSaleDialog locationId={demoSale} onClose={() => setDemoSale(null)} />
    </div>
  );
}

// ───────────────────────────── Ventas y cajas ─────────────────────────────

function ResumenTab({ onSync, onDemoSale, onOpenRun }: { onSync: (id: LocationId) => void; onDemoSale: (id: LocationId) => void; onOpenRun: (id: string) => void }) {
  const data = useDemo((s) => s.data);
  const syncing = useDemo((s) => s.ui.syncing);
  const now = useNow();
  const today = panamaDay(now);
  const filter = useLocationFilter();
  const period = usePeriod();
  const range = periodRange(period, today);
  const scope = data.locations.filter((l) => filter === 'all' || l.id === filter);
  const totals = salesTotals(data, range.from, range.to, filter);
  const items = itemSales(data, range.from, range.to, filter);
  const chartFrom = period === 'hoy' ? addDays(today, -6) : range.from;
  const tickets = data.tickets.filter((t) => filter === 'all' || t.locationId === filter).slice(-400).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 10);
  const itemName = (id: ID) => data.posItems.find((i) => i.id === id)?.name ?? id;

  return (
    <div className="space-y-6">
      <Panel className="overflow-hidden">
        <div className="grid grid-cols-1 gap-px bg-line sm:grid-cols-3">
          {[
            { label: 'Ventas', value: money0(totals.revenueCents), sub: range.label },
            { label: 'Tickets', value: fmtInt(totals.tickets), sub: `${fmtInt(Math.round(totals.tickets / range.days))} por día de media` },
            { label: 'Ticket medio', value: money(totals.avgTicketCents), sub: 'Ingresos ÷ tickets' },
          ].map((k) => (
            <div key={k.label} className="bg-paper px-5 py-4">
              <p className="text-[12.5px] font-medium text-ink-3">{k.label}</p>
              <p className="mt-1.5 text-[26px] font-semibold leading-none tracking-[-0.02em] text-forest-900">{k.value}</p>
              <p className="mt-2 text-[12.5px] text-ink-2">{k.sub}</p>
            </div>
          ))}
        </div>
      </Panel>

      {/* Una tarjeta por caja */}
      <div className={cn('grid gap-4', scope.length > 1 && 'lg:grid-cols-3')} data-tour="cajas">
        {scope.map((l) => {
          const conn = data.posConnections.find((c) => c.locationId === l.id)!;
          const t = salesTotals(data, range.from, range.to, l.id);
          const stale = posNeedsAttention(conn, now);
          const unmapped = undeductedByItem(data, l.id);
          const queued = data.posDemoQueue.filter((x) => x.locationId === l.id);
          const lastRun = [...data.syncRuns].reverse().find((r) => r.locationId === l.id);
          return (
            <Panel key={l.id} data-tour={`caja-${l.id}`} className={cn('flex flex-col', stale && 'ring-1 ring-danger-100')}>
              <div className="flex items-start justify-between gap-3 px-5 pt-4">
                <div>
                  <h2 className="serif text-[19px] font-[520] leading-tight text-forest-900"><LocationTag id={l.id} name={l.name} /></h2>
                  <p className="mt-0.5 text-[12.5px] text-ink-3">{conn.label} · conector simulado</p>
                </div>
                <PosStatusBadge conn={conn} stale={stale} compact />
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-px border-y border-line bg-line">
                <div className="bg-paper px-5 py-3">
                  <dt className="text-[12px] text-ink-3">Ventas</dt>
                  <dd className="mt-0.5 text-[17px] font-semibold tabular-nums text-ink">{money0(t.revenueCents)}</dd>
                </div>
                <div className="bg-paper px-4 py-3">
                  <dt className="text-[12px] text-ink-3">Tickets</dt>
                  <dd className="mt-0.5 text-[17px] font-semibold tabular-nums text-ink">{fmtInt(t.tickets)}</dd>
                </div>
                <div className="bg-paper px-4 py-3">
                  <dt className="text-[12px] text-ink-3">Ticket medio</dt>
                  <dd className="mt-0.5 text-[17px] font-semibold tabular-nums text-ink">{money(t.avgTicketCents)}</dd>
                </div>
              </dl>
              <div className="flex-1 space-y-2 px-5 py-3.5 text-[13px]">
                <p className={cn('flex items-start gap-2', stale ? 'text-danger-800' : 'text-ink-2')}>
                  {stale ? <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> : <Check className="mt-0.5 size-3.5 shrink-0 text-ok-700" strokeWidth={3} />}
                  <span>
                    Última sincronización: <strong className="font-medium">{fmtWhen(conn.lastSyncAt, now)}</strong> ({fmtAgo(conn.lastSyncAt, now)})
                    {conn.issue && <span className="block text-[12.5px]">{conn.issue}</span>}
                    {!conn.issue && conn.autoSync && <span className="block text-[12.5px] text-ink-3">Automática cada 15 minutos</span>}
                  </span>
                </p>
                {unmapped.length > 0 && (
                  <p className="flex items-start gap-2 text-warn-800">
                    <Unlink className="mt-0.5 size-3.5 shrink-0" />
                    <Link to="/ventas?vista=correspondencias" className="hover:underline">
                      {plural(unmapped.length, 'artículo sin receta', 'artículos sin receta')} · {plural(unmapped.reduce((s, u) => s + u.qty, 0), 'venta', 'ventas')} sin descontar
                    </Link>
                  </p>
                )}
                {queued.length > 0 && (
                  <p className="flex items-start gap-2 text-brass-800">
                    <FlaskConical className="mt-0.5 size-3.5 shrink-0" />
                    {plural(queued.length, 'venta simulada pendiente', 'ventas simuladas pendientes')} de sincronizar
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
                <Button
                  variant={stale ? 'primary' : 'secondary'}
                  size="sm"
                  loading={syncing[l.id]}
                  icon={<RefreshCw className="size-3.5" />}
                  onClick={() => onSync(l.id)}
                  data-tour={`caja-${l.id}-sync`}
                >
                  {syncing[l.id] ? 'Sincronizando…' : 'Sincronizar'}
                </Button>
                <Button variant="ghost" size="sm" icon={<FlaskConical className="size-3.5" />} onClick={() => onDemoSale(l.id)}>
                  Simular una venta
                </Button>
                {lastRun && (
                  <button type="button" onClick={() => onOpenRun(lastRun.id)} className="ml-auto text-[12.5px] font-medium text-forest-700 hover:underline">
                    Último detalle
                  </button>
                )}
              </div>
            </Panel>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel className="p-5">
          <SalesChart data={salesSeries(data, chartFrom, today)} locations={scope} />
        </Panel>
        <Panel>
          <PanelHeader title="Artículos más vendidos" hint={`Por ingresos · ${range.label}`} />
          <div className="px-5 py-4">
            {items.length === 0 ? (
              <p className="py-6 text-center text-[13.5px] text-ink-3">Sin ventas en este período.</p>
            ) : (
              <RankedBars rows={items.slice(0, 10).map((i) => ({ key: i.itemId, label: itemName(i.itemId), value: i.revenueCents, sub: `${fmtInt(i.qty)} u` }))} />
            )}
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Últimos tickets importados" hint="Cada ticket conserva su identificador de caja: es la clave que impide importarlo dos veces" />
        {tickets.length === 0 ? (
          <EmptyState title="Aún no hay tickets hoy">Los tickets aparecerán aquí al sincronizar las cajas.</EmptyState>
        ) : (
          <Table minWidth={720}>
            <thead>
              <tr>
                <Th>Ticket</Th>
                <Th>Hora</Th>
                <Th>Local</Th>
                <Th>Artículos</Th>
                <Th align="right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <Tr key={t.id}>
                  <Td className="font-medium tabular-nums text-ink">{t.id}</Td>
                  <Td className="whitespace-nowrap tabular-nums text-ink-2">{fmtWhen(t.at, now)}</Td>
                  <Td><LocationTag id={t.locationId} name={data.locations.find((l) => l.id === t.locationId)!.name} /></Td>
                  <Td className="text-ink-2">{t.lines.map((l) => `${l.qty} × ${itemName(l.itemId)}`).join(', ')}</Td>
                  <Td num className="font-medium">{money(t.totalCents)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

// ───────────────────────────── Detalle de una sincronización ─────────────────────────────

function SyncDrawer({ run, onClose }: { run?: SyncRun; onClose: () => void }) {
  const data = useDemo((s) => s.data);
  if (!run) return <Drawer open={false} onOpenChange={() => onClose()} title=""><span /></Drawer>;
  const loc = data.locations.find((l) => l.id === run.locationId)!;
  const explained = explainConsumption(data, run.itemsSold);
  const itemName = (id: ID) => data.posItems.find((i) => i.id === id)?.name ?? id;
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      width="xl"
      tourId="sync-panel"
      eyebrow={`Sincronización ${run.id} · ${loc.name}`}
      title={run.imported > 0 ? `${plural(run.imported, 'ticket nuevo', 'tickets nuevos')} · ${money(run.revenueCents)}` : 'Sin tickets nuevos'}
      description={`${run.trigger === 'manual' ? 'Sincronización manual' : 'Sincronización automática'} del ${fmtDateTime(run.at)} · ${userName(data, run.by)}`}
      footer={
        <>
          <Link to={`/inventario?vista=movimientos&ref=${run.id}`} className="mr-auto inline-flex items-center gap-1 text-[13px] font-medium text-forest-700 hover:underline">
            Ver estos movimientos en inventario <ArrowRight className="size-3.5" />
          </Link>
          <Button variant="primary" onClick={onClose}>Entendido</Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line" data-tour="sync-resumen">
        <div className="bg-paper px-4 py-3">
          <p className="text-[12px] text-ink-3">Recibidos de la caja</p>
          <p className="mt-1 text-[20px] font-semibold leading-none tabular-nums text-ink">{run.fetched}</p>
        </div>
        <div className="bg-paper px-4 py-3">
          <p className="text-[12px] text-ink-3">Importados</p>
          <p className="mt-1 text-[20px] font-semibold leading-none tabular-nums text-ok-700">{run.imported}</p>
        </div>
        <div className="bg-paper px-4 py-3">
          <p className="text-[12px] text-ink-3">Ya importados, omitidos</p>
          <p className="mt-1 text-[20px] font-semibold leading-none tabular-nums text-ink">{run.duplicates}</p>
        </div>
      </div>
      {run.duplicates > 0 && (
        <Note tone="forest" icon={<CopyCheck className="size-4" />} className="mt-3">
          La caja reenvió {plural(run.duplicates, 'ticket que ya estaba', 'tickets que ya estaban')} en la plataforma. Se reconocieron por su identificador y <strong>no se contaron ni se descontaron dos veces</strong>.
        </Note>
      )}

      {run.imported > 0 && (
        <>
          <h3 className="serif mb-1 mt-6 text-[18px] font-[520] text-forest-900">De las ventas al inventario</h3>
          <p className="mb-3 text-[12.5px] text-ink-3">Cada artículo vendido se multiplica por su receta. El resultado se descuenta en {loc.name}, no en los demás locales.</p>
          <div className="overflow-hidden rounded-xl border border-line bg-white/60" data-tour="sync-recetas">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                  <th scope="col" className="border-b border-line px-4 py-2.5 text-left">Artículo vendido</th>
                  <th scope="col" className="border-b border-line px-3 py-2.5 text-right">Uds.</th>
                  <th scope="col" className="border-b border-line px-4 py-2.5 text-left">Receta × unidades = consumo</th>
                </tr>
              </thead>
              <tbody>
                {explained.map((e) => (
                  <tr key={e.itemId} data-tour={`sync-item-${e.itemId}`}>
                    <td className="border-b border-line/70 px-4 py-2.5 align-top font-medium text-ink">{itemName(e.itemId)}</td>
                    <td className="border-b border-line/70 px-3 py-2.5 text-right align-top font-semibold tabular-nums">{e.qty}</td>
                    <td className="border-b border-line/70 px-4 py-2.5 align-top">
                      {e.ingredients.length === 0 ? (
                        <span className="inline-flex items-center gap-1.5 text-warn-800">
                          <Unlink className="size-3.5" /> Sin receta: se registra el ingreso, no se descuenta nada
                        </span>
                      ) : (
                        <ul className="space-y-0.5 tabular-nums text-ink-2">
                          {e.ingredients.map((ing) => {
                            const p = data.products.find((x) => x.id === ing.productId)!;
                            return (
                              <li key={ing.productId}>
                                {qtyBase(ing.perUnit, p.baseUnit)} × {e.qty} = <strong className="font-semibold text-ink">{fmtQty(ing.total, p.baseUnit)}</strong> de {p.name}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="serif mb-2 mt-6 text-[18px] font-[520] text-forest-900">Descontado del inventario de {loc.name}</h3>
          <ul className="grid gap-x-8 gap-y-1.5 text-[13.5px] sm:grid-cols-2" data-tour="sync-consumo">
            {[...run.consumption].sort((a, b) => b.qty - a.qty).map((c) => {
              const p = data.products.find((x) => x.id === c.productId)!;
              return (
                <li key={c.productId} className="flex items-center justify-between gap-3 border-b border-line/70 pb-1.5">
                  <Link to={`/inventario?local=${run.locationId}&producto=${p.id}`} className="truncate text-ink-2 hover:text-forest-700 hover:underline">{p.name}</Link>
                  <span className="font-semibold tabular-nums text-ink">{fmtQty(-c.qty, p.baseUnit, { sign: true })}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Drawer>
  );
}

// ───────────────────────────── Artículos de caja ↔ recetas ─────────────────────────────

function MappingTab() {
  const data = useDemo((s) => s.data);
  const user = useUser();
  const today = panamaDay(useNow());
  const filter = useLocationFilter();
  const period = usePeriod();
  const range = periodRange(period, today);
  const sales = new Map(itemSales(data, range.from, range.to, filter).map((i) => [i.itemId, i]));
  const pending = new Map(undeductedByItem(data, 'all').map((u) => [u.itemId, u]));
  const [mapping, setMapping] = useState<PosItem | null>(null);
  const canEdit = user.role !== 'contabilidad';

  return (
    <>
      <Panel data-tour="correspondencias">
        <PanelHeader
          title="Artículos de caja y sus recetas"
          hint="Lo que se vende en caja se traduce a ingredientes. Un artículo sin receta no descuenta nada: se señala para resolverlo, no se adivina."
        />
        <Table minWidth={820}>
          <thead>
            <tr>
              <Th>Artículo en caja</Th>
              <Th align="right">Precio</Th>
              <Th align="right">Vendidos · {range.label}</Th>
              <Th>Receta asociada</Th>
              <Th align="right"><span className="sr-only">Acción</span></Th>
            </tr>
          </thead>
          <tbody>
            {data.posItems.map((item) => {
              const recipe = data.recipes.find((r) => r.id === item.recipeId);
              const s = sales.get(item.id);
              const u = pending.get(item.id);
              return (
                <Tr key={item.id} selected={item.mapping === 'pendiente'} data-tour={`item-${item.id}`}>
                  <Td>
                    <p className="font-medium text-ink">{item.name}</p>
                    <p className="text-[12px] tabular-nums text-ink-3">{item.id} · «{item.posName}»{item.since ? ` · en carta desde el ${fmtDate(item.since)}` : ''}</p>
                  </Td>
                  <Td num>{money(item.priceCents)}</Td>
                  <Td num>
                    {s ? fmtInt(s.qty) : 0}
                    <div className="text-[12px] text-ink-3">{s ? money0(s.revenueCents) : '—'}</div>
                  </Td>
                  <Td>
                    {item.mapping === 'receta' && recipe && (
                      <>
                        <span className="inline-flex items-center gap-1.5 font-medium text-ink"><Link2 className="size-3.5 text-forest-600" /> {recipe.name}</span>
                        <div className="text-[12px] text-ink-3">
                          {recipe.ingredients.map((ing) => `${qtyBase(ing.qty, data.products.find((p) => p.id === ing.productId)!.baseUnit)} ${data.products.find((p) => p.id === ing.productId)!.name.split(' ')[0].toLowerCase()}`).join(' · ')}
                        </div>
                      </>
                    )}
                    {item.mapping === 'sin_impacto' && <Badge>Sin impacto en inventario</Badge>}
                    {item.mapping === 'pendiente' && (
                      <>
                        <Badge tone="danger" icon={<Unlink className="size-3" />}>Sin receta</Badge>
                        {u && <div className="mt-1 text-[12px] text-warn-800">{plural(u.qty, 'venta', 'ventas')} sin descontar desde el {fmtDate(u.firstDay)}</div>}
                      </>
                    )}
                  </Td>
                  <Td align="right">
                    <Button size="sm" variant={item.mapping === 'pendiente' ? 'primary' : 'ghost'} onClick={() => setMapping(item)} disabledReason={!canEdit && 'Contabilidad no modifica las correspondencias.'} data-tour={item.mapping === 'pendiente' ? 'asignar-receta' : undefined}>
                      {item.mapping === 'pendiente' ? 'Asignar receta' : 'Cambiar'}
                    </Button>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Panel>
      <MappingDialog item={mapping} onClose={() => setMapping(null)} />
    </>
  );
}

function MappingDialog({ item, onClose }: { item: PosItem | null; onClose: () => void }) {
  const data = useDemo((s) => s.data);
  const [choice, setChoice] = useState<string>('');
  const [retro, setRetro] = useState(true);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (item) {
      setChoice(item.recipeId ?? (item.mapping === 'sin_impacto' ? 'sin_impacto' : ''));
      setRetro(true);
    }
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pendingQty = item ? undeductedByItem(data, 'all').find((u) => u.itemId === item.id)?.qty ?? 0 : 0;
  const recipe = data.recipes.find((r) => r.id === choice);

  return (
    <>
      <Modal
        open={Boolean(item) && !creating}
        onOpenChange={(o) => !o && onClose()}
        title={item ? `Receta para «${item.name}»` : ''}
        description="Elige qué ingredientes consume cada unidad vendida de este artículo."
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button
              variant="primary"
              disabled={!choice}
              onClick={() => {
                if (!item) return;
                const res = act(
                  (d, ctx) => mapPosItem(d, ctx, item.id, choice === 'sin_impacto' ? { kind: 'sin_impacto' } : { kind: 'receta', recipeId: choice }, retro),
                  choice === 'sin_impacto' ? 'Artículo marcado sin impacto en inventario' : pendingQty > 0 && retro ? `Receta asociada · ${pendingQty} ventas regularizadas` : 'Receta asociada',
                );
                if (res.ok) onClose();
              }}
            >
              Guardar correspondencia
            </Button>
          </>
        }
      >
        <div className="space-y-4 pb-1">
          <Field label="Receta" htmlFor="map-receta">
            <Select id="map-receta" value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="" disabled>Elige una receta…</option>
              {data.recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              <option value="sin_impacto">Sin impacto en inventario (no descuenta nada)</option>
            </Select>
          </Field>
          <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
            Crear una receta nueva para este artículo
          </Button>
          {recipe && (
            <ul className="rounded-lg border border-line bg-white/60 px-3 py-2 text-[13px]">
              {recipe.ingredients.map((ing) => {
                const p = data.products.find((x) => x.id === ing.productId)!;
                return (
                  <li key={ing.productId} className="flex justify-between py-0.5">
                    <span className="text-ink-2">{p.name}</span>
                    <span className="font-medium tabular-nums">{qtyBase(ing.qty, p.baseUnit)}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {pendingQty > 0 && choice && choice !== 'sin_impacto' && (
            <div className="rounded-lg bg-warn-50 px-3 py-2.5 ring-1 ring-inset ring-warn-100">
              <Checkbox checked={retro} onChange={setRetro}>
                Regularizar las <strong>{pendingQty} ventas</strong> ya registradas: descontar ahora sus ingredientes, con un movimiento explícito en cada local.
              </Checkbox>
            </div>
          )}
        </div>
      </Modal>
      <RecipeEditor open={creating} onClose={() => setCreating(false)} presetName={item?.name} onSaved={(id) => setChoice(id)} />
    </>
  );
}

// ───────────────────────────── Historial de sincronizaciones ─────────────────────────────

function RunsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const data = useDemo((s) => s.data);
  const filter = useLocationFilter();
  const list = data.syncRuns.filter((r) => filter === 'all' || r.locationId === filter).slice().reverse();
  return (
    <Panel>
      <PanelHeader title="Historial de sincronizaciones" hint="Cada importación deja constancia de lo que trajo la caja, lo que entró y lo que se omitió por estar ya importado" />
      {list.length === 0 ? (
        <EmptyState title="Sin sincronizaciones todavía">Pulsa «Sincronizar ventas» para traer los tickets de las cajas.</EmptyState>
      ) : (
        <Table minWidth={760}>
          <thead>
            <tr>
              <Th>Sincronización</Th>
              <Th>Local</Th>
              <Th>Origen</Th>
              <Th align="right">Importados</Th>
              <Th align="right">Omitidos</Th>
              <Th align="right">Ventas</Th>
              <Th align="right">Sin receta</Th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 40).map((r) => {
              const unmapped = Object.values(r.unmapped).reduce((t, n) => t + n, 0);
              return (
                <Tr key={r.id} onClick={() => onOpen(r.id)}>
                  <Td>
                    <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(r.id); }} className="font-medium tabular-nums text-forest-800 hover:underline">{r.id}</button>
                    <div className="text-[12px] text-ink-3">{fmtDate(r.at)} · {fmtTime(r.at)}</div>
                  </Td>
                  <Td><LocationTag id={r.locationId} name={data.locations.find((l) => l.id === r.locationId)!.name} /></Td>
                  <Td>{r.trigger === 'manual' ? <Badge tone="brass">Manual · {userName(data, r.by)}</Badge> : <Badge>Automática</Badge>}</Td>
                  <Td num className="font-medium">{r.imported}</Td>
                  <Td num className="text-ink-2">{r.duplicates}</Td>
                  <Td num>{money(r.revenueCents)}</Td>
                  <Td num>{unmapped > 0 ? <span className="text-warn-800">{unmapped}</span> : <span className="text-ink-4">0</span>}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}

// ───────────────────────────── Caja de demostración ─────────────────────────────

function DemoSaleDialog({ locationId, onClose }: { locationId: LocationId | null; onClose: () => void }) {
  const data = useDemo((s) => s.data);
  const [lines, setLines] = useState<{ itemId: ID; qty: number }[]>([{ itemId: 'CAP', qty: 10 }]);
  useEffect(() => {
    if (locationId) setLines([{ itemId: 'CAP', qty: 10 }]);
  }, [locationId]);
  const loc = data.locations.find((l) => l.id === locationId);
  const total = lines.reduce((t, l) => t + l.qty * (data.posItems.find((i) => i.id === l.itemId)?.priceCents ?? 0), 0);
  return (
    <Modal
      open={Boolean(locationId)}
      onOpenChange={(o) => !o && onClose()}
      title={`Simular una venta en la caja de ${loc?.name ?? ''}`}
      description="Herramienta de demostración: teclea una venta como si se hiciera en la caja. Queda allí hasta la próxima sincronización; entonces verás cómo descuenta el inventario."
      footer={
        <>
          <span className="mr-auto text-[13px] text-ink-2">Total del ticket <strong className="ml-1 tabular-nums text-forest-900">{money(total)}</strong></span>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            icon={<Utensils className="size-4" />}
            onClick={() => {
              if (!locationId) return;
              const res = act((d, ctx) => queueDemoSale(d, ctx, locationId, lines), (t) => `Venta ${t.id} registrada en la caja simulada`);
              if (res.ok) {
                toast('info', 'Ahora pulsa «Sincronizar»', 'La venta aún no está en la plataforma: llegará con la próxima sincronización.');
                onClose();
              }
            }}
          >
            Registrar en la caja
          </Button>
        </>
      }
    >
      <ul className="space-y-2 pb-1">
        {lines.map((l, idx) => (
          <li key={idx} className="grid grid-cols-[minmax(0,1fr)_auto_36px] items-center gap-2">
            <Select value={l.itemId} onChange={(e) => setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, itemId: e.target.value } : x)))} aria-label={`Artículo ${idx + 1}`}>
              {data.posItems.map((i) => <option key={i.id} value={i.id}>{i.name} · {money(i.priceCents)}</option>)}
            </Select>
            <Stepper label="Unidades" value={l.qty} min={1} onChange={(v) => setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, qty: v } : x)))} />
            <button type="button" aria-label="Quitar línea" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))} className="flex size-9 items-center justify-center rounded-lg text-ink-3 hover:bg-linen hover:text-danger-700 disabled:opacity-30">
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setLines((ls) => [...ls, { itemId: 'LAT', qty: 1 }])}>
        Añadir artículo
      </Button>
      <Note tone="neutral" icon={<Info className="size-4" />} className="mt-3">
        Ejemplo: 10 cappuccinos deben descontar 180 g de café y 1.5 L de leche en este local, y nada en los demás.
      </Note>
    </Modal>
  );
}
