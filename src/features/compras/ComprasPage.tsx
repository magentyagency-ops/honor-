import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  ArrowRight, CalendarDays, Info, Lightbulb, MessageCircle, Phone, Search, Settings2, ShieldCheck, ShoppingBasket, Sparkles, Trash2, Truck,
} from 'lucide-react';
import type { CategoryId, ID, LocationId, OrderStatus, PurchaseOrder } from '@/domain/types';
import { CATEGORIES } from '@/data/catalog';
import { orderTotals, userName } from '@/domain/core';
import { days as fmtDays, money, money0, packs as fmtPacks, parseMoney, plural, qty as fmtQty, unitCost } from '@/domain/format';
import { fmtDate, fmtDayWeek, fmtWhen, panamaDay } from '@/domain/time';
import { cartGroups, setApprovalRule, setCartQty, submitCart, clearCart } from '@/domain/purchasing';
import {
  periodRange, purchaseFlow, purchasesBySupplier, stockRows, suggestions as computeSuggestions, type StockRow, type Suggestion,
} from '@/domain/selectors';
import { act, run, setSession, toast, useDemo, useLocationFilter, useNow, usePeriod, useUser } from '@/store';
import { useQuery } from '@/lib/useQuery';
import { useMediaQuery } from '@/lib/useMediaQuery';
import {
  Badge, Button, Checkbox, EmptyState, Field, Input, LocationDot, LocationTag, Note, PageHeader, Panel, PanelHeader, Segmented, Select,
  Stepper, TabBar, Table, Td, Textarea, Th, Tr, cn,
} from '@/ui/primitives';
import { Drawer, Modal } from '@/ui/overlays';
import { OrderStatusBadge, StockLevelBadge } from '@/ui/status';
import { RankedBars } from '@/ui/charts';

type Vista = 'pedir' | 'pedidos' | 'proveedores';

export function ComprasPage() {
  const user = useUser();
  const data = useDemo((s) => s.data);
  const filter = useLocationFilter();
  const [vista, setVista] = useQuery<Vista>('vista', user.role === 'contabilidad' ? 'pedidos' : 'pedir');
  const open = data.orders.filter((o) => !['recibido', 'cancelado'].includes(o.status) && (filter === 'all' || o.locationId === filter)).length;
  const waiting = data.orders.filter((o) => o.status === 'pendiente_aprobacion').length;

  return (
    <div>
      <PageHeader
        title="Compras"
        subtitle="Qué pedir, para qué local y a qué proveedor. Cada pedido se envía por WhatsApp y se confirma al recibir la mercancía."
        actions={<ApprovalRule />}
      />
      <TabBar<Vista>
        label="Secciones de compras"
        value={vista}
        onChange={setVista}
        tabs={[
          { id: 'pedir', label: 'Pedir' },
          { id: 'pedidos', label: 'Pedidos', count: open, attention: user.role === 'direccion' && waiting > 0 },
          { id: 'proveedores', label: 'Proveedores' },
        ]}
      />
      {vista === 'pedir' && <PedirTab />}
      {vista === 'pedidos' && <PedidosTab />}
      {vista === 'proveedores' && <ProveedoresTab />}
    </div>
  );
}

// ───────────────────────────── Regla de aprobación ─────────────────────────────

function ApprovalRule() {
  const settings = useDemo((s) => s.data.settings);
  const user = useUser();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(settings.approvalEnabled);
  const [amount, setAmount] = useState(String(settings.approvalThresholdCents / 100));
  const canEdit = user.role === 'direccion';
  const cents = parseMoney(amount);
  return (
    <>
      <Button
        variant="secondary"
        icon={<ShieldCheck className="size-4 text-forest-600" />}
        iconRight={canEdit ? <Settings2 className="size-3.5 text-ink-3" /> : undefined}
        disabledReason={!canEdit && 'Solo Dirección puede cambiar la regla de aprobación.'}
        onClick={() => {
          setEnabled(settings.approvalEnabled);
          setAmount(String(settings.approvalThresholdCents / 100));
          setOpen(true);
        }}
        data-tour="regla-aprobacion"
      >
        {settings.approvalEnabled ? `Aprobación a partir de ${money0(settings.approvalThresholdCents)}` : 'Sin regla de aprobación'}
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        size="sm"
        title="Regla de aprobación de pedidos"
        description="Los pedidos de un gerente que superen el umbral quedan pendientes hasta que Dirección los apruebe. Los demás se aprueban automáticamente."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button
              variant="primary"
              disabled={enabled && cents === null}
              onClick={() => {
                const res = act((d, ctx) => setApprovalRule(d, ctx, { approvalEnabled: enabled, approvalThresholdCents: cents ?? settings.approvalThresholdCents }), 'Regla de aprobación actualizada');
                if (res.ok) setOpen(false);
              }}
            >
              Guardar regla
            </Button>
          </>
        }
      >
        <div className="space-y-4 pb-1">
          <Checkbox checked={enabled} onChange={setEnabled}>Exigir aprobación de Dirección por encima de un importe</Checkbox>
          <Field label="Umbral por pedido (USD, impuestos incluidos)" htmlFor="umbral" hint="Se evalúa cada pedido por separado: un carrito con dos proveedores genera dos pedidos.">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">$</span>
              <Input id="umbral" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!enabled} className="pl-6 tabular-nums" />
            </div>
          </Field>
        </div>
      </Modal>
    </>
  );
}

// ───────────────────────────── Pedir ─────────────────────────────

function LocationChooser() {
  const data = useDemo((s) => s.data);
  const today = panamaDay(useNow());
  return (
    <Panel>
      <PanelHeader title="¿Para qué local quieres pedir?" hint="Un pedido siempre pertenece a un local: es el que recibe la mercancía y donde entra el inventario." />
      <ul className="divide-y divide-line/80">
        {data.locations.map((l) => {
          const sug = computeSuggestions(data, l.id, today);
          const crit = stockRows(data, today, l.id).filter((r) => r.level === 'critico' || r.level === 'agotado').length;
          const cart = data.carts[l.id].length;
          return (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => setSession({ locationFilter: l.id })}
                data-tour={`elegir-local-${l.id}`}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 text-left transition-colors hover:bg-linen/60"
              >
                <LocationDot id={l.id} className="size-2.5" />
                <span className="min-w-0 flex-1 basis-[220px]">
                  <span className="block text-[15px] font-medium text-ink">{l.name}</span>
                  <span className="block text-[12.5px] text-ink-3">{l.address}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {crit > 0 && <StockLevelBadge level="critico" />}
                  {sug.length > 0 ? <Badge tone="brass" icon={<Lightbulb className="size-3" />}>{plural(sug.reduce((t, s) => t + s.lines.length, 0), 'producto sugerido', 'productos sugeridos')}</Badge> : <Badge>Sin sugerencias</Badge>}
                  {cart > 0 && <Badge tone="forest" icon={<ShoppingBasket className="size-3" />}>{plural(cart, 'artículo en el pedido', 'artículos en el pedido')}</Badge>}
                </span>
                <ArrowRight className="size-4 text-ink-3" />
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function PedirTab() {
  const data = useDemo((s) => s.data);
  const user = useUser();
  const now = useNow();
  const today = panamaDay(now);
  const filter = useLocationFilter();
  const wide = useMediaQuery('(min-width: 1280px)');
  const [q, setQ] = useState('');
  const [cat, setCat] = useQuery<CategoryId | 'todas'>('categoria', 'todas');
  const [sup, setSup] = useQuery<string>('proveedor', 'todos');
  const [sugId, setSugId] = useQuery<string>('sugerencia', '');
  const [cartOpen, setCartOpen] = useState(false);

  const L = filter === 'all' ? null : filter;
  const rows = useMemo(() => (L ? stockRows(data, today, L) : []), [data, today, L]);
  const sug = useMemo(() => (L ? computeSuggestions(data, L, today) : []), [data, today, L]);

  if (!L) return <LocationChooser />;

  const loc = data.locations.find((l) => l.id === L)!;
  const readOnly = user.role === 'contabilidad';
  const cart = data.carts[L];
  const cartQty = new Map(cart.map((c) => [c.productId, c.packs]));
  const suggested = new Map<ID, number>();
  for (const s of sug) for (const l of s.lines) suggested.set(l.product.id, l.packs);
  const groups = cartGroups(data, L, user, today);
  const cartTotal = groups.reduce((t, g) => t + g.totalCents, 0);
  const needle = q.trim().toLowerCase();
  const visible = rows.filter(
    (r) =>
      (cat === 'todas' || r.product.category === cat) &&
      (sup === 'todos' || r.product.offer.supplierId === sup) &&
      (!needle || r.product.name.toLowerCase().includes(needle) || r.product.offer.sku.toLowerCase().includes(needle)),
  );
  const setQty = (productId: ID, packs: number) => run((d) => setCartQty(d, L, productId, packs));
  const openSuggestion = sug.find((s) => s.supplier.id === sugId);

  const cartEl = <Cart locationId={L} bare={!wide} />;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-6">
        {/* Sugerencias */}
        <section data-tour="sugerencias">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="serif text-[19px] font-[520] text-forest-900">Reabastecimiento sugerido</h2>
              <p className="mt-0.5 text-[13px] text-ink-3">
                Para <LocationTag id={L} name={loc.name} className="font-medium text-ink-2" />: productos cuya existencia, sumando lo ya pedido, no cubre hasta la próxima entrega posible.
              </p>
            </div>
          </div>
          {sug.length === 0 ? (
            <Note tone="ok" icon={<ShieldCheck className="size-4" />}>No hay nada urgente que pedir: las existencias de {loc.name} cubren hasta la próxima entrega de cada proveedor.</Note>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {sug.map((s) => (
                <SuggestionCard key={s.supplier.id} s={s} onOpen={() => setSugId(s.supplier.id)} />
              ))}
            </div>
          )}
        </section>

        {/* Catálogo */}
        <Panel data-tour="catalogo">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto o referencia…" aria-label="Buscar en el catálogo" className="pl-9" />
            </div>
            <Select value={sup} onChange={(e) => setSup(e.target.value)} aria-label="Proveedor" className="w-auto min-w-[190px]">
              <option value="todos">Todos los proveedores</option>
              {data.suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </div>
          <div className="border-b border-line px-5 py-2.5">
            <Segmented<CategoryId | 'todas'>
              size="sm"
              label="Categoría"
              value={cat}
              onChange={setCat}
              options={[{ id: 'todas', label: 'Todas' }, ...CATEGORIES.map((c) => ({ id: c.id, label: c.label }))]}
            />
          </div>

          {visible.length === 0 ? (
            <EmptyState icon={<Search className="size-5" />} title="Ningún producto coincide">
              Prueba con otra búsqueda o quita los filtros de categoría y proveedor.
            </EmptyState>
          ) : (
            <>
              {/* Escritorio: tabla */}
              <div className="hidden md:block">
                <Table>
                  <thead>
                    <tr>
                      <Th>Producto</Th>
                      <Th align="right" className="w-[92px] 2xl:w-[112px]">Precio</Th>
                      <Th className="w-[150px] 2xl:w-[190px]">Existencia</Th>
                      <Th align="right" className="w-[136px] 2xl:w-[150px]">Cantidad</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => (
                      <CatalogRow key={r.product.id} r={r} qty={cartQty.get(r.product.id) ?? 0} suggested={suggested.get(r.product.id)} setQty={setQty} readOnly={readOnly} supplierName={data.suppliers.find((s) => s.id === r.product.offer.supplierId)!.short} />
                    ))}
                  </tbody>
                </Table>
              </div>
              {/* Móvil: lista con botones grandes */}
              <ul className="divide-y divide-line/80 md:hidden">
                {visible.map((r) => {
                  const p = r.product;
                  const n = cartQty.get(p.id) ?? 0;
                  const s = suggested.get(p.id);
                  return (
                    <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium leading-snug text-ink">{p.name}</p>
                        <p className="text-[12.5px] text-ink-3">{p.offer.pack.label} · {money(p.offer.priceCents)}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-2">
                          Hay {fmtQty(r.qty, p.baseUnit)}
                          {r.level !== 'ok' && <StockLevelBadge level={r.level} />}
                          {s ? <span className="text-brass-700">· sugerido {s}</span> : null}
                        </p>
                      </div>
                      <Stepper size="lg" label={`Cantidad de ${p.name}`} value={n} onChange={(v) => setQty(p.id, v)} />
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <p className="flex items-start gap-2 border-t border-line px-5 py-3 text-[12.5px] leading-snug text-ink-3">
            <Info className="mt-px size-3.5 shrink-0" />
            Se pide en presentaciones del proveedor (caja, saco, cartón…). Al recibir, la plataforma las convierte a la unidad de inventario: una caja de 12 × 1 L son 12 L.
          </p>
        </Panel>
      </div>

      {/* Pedido en curso */}
      {wide ? (
        <aside className="sticky top-[84px] self-start" style={{ maxHeight: 'calc(100dvh - 108px - var(--dock-space))' }}>
          {cartEl}
        </aside>
      ) : (
        <>
          {cart.length > 0 && (
            <div className="fixed inset-x-0 z-20 px-4" style={{ bottom: 'calc(var(--dock-space) + 14px)' }}>
              <Button variant="primary" size="lg" block onClick={() => setCartOpen(true)} icon={<ShoppingBasket className="size-[18px]" />} className="shadow-pop">
                Ver pedido · {plural(cart.length, 'artículo', 'artículos')} · {money(cartTotal)}
              </Button>
            </div>
          )}
          <Drawer open={cartOpen} onOpenChange={setCartOpen} title={`Pedido para ${loc.name}`} description="Revisa las cantidades antes de validar.">
            <div className="-mx-6 -my-5 flex min-h-full flex-col">{cartEl}</div>
          </Drawer>
        </>
      )}

      <SuggestionDrawer suggestion={openSuggestion} locationName={loc.name} onClose={() => setSugId(null)} />
    </div>
  );
}

function SuggestionCard({ s, onOpen }: { s: Suggestion; onOpen: () => void }) {
  const names = s.lines.slice(0, 2).map((l) => l.product.name);
  return (
    <article data-tour={`sugerencia-${s.supplier.id}`} className="flex flex-col rounded-xl border border-line bg-paper p-4 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-ink">{s.supplier.name}</h3>
          <p className="text-[12.5px] text-ink-3">{s.supplier.categoryLabel}</p>
        </div>
        {s.worst === 'ok' ? <Badge tone="brass" icon={<Lightbulb className="size-3" />}>Previsto</Badge> : <StockLevelBadge level={s.worst} />}
      </div>
      <p className="mt-3 text-[13px] leading-snug text-ink-2">
        {names.join(', ')}
        {s.lines.length > 2 && ` y ${s.lines.length - 2} más`}
      </p>
      <div className="mt-3 flex items-end justify-between gap-3 border-t border-line pt-3">
        <div>
          <p className="text-[18px] font-semibold leading-none tabular-nums text-forest-900">{money(s.totalCents)}</p>
          <p className="mt-1 flex items-center gap-1 text-[12px] text-ink-3">
            <Truck className="size-3.5" /> Entrega estimada {fmtDayWeek(s.deliveryDay)}
          </p>
        </div>
        <Button size="sm" variant={s.worst === 'ok' ? 'secondary' : 'primary'} onClick={onOpen} data-tour={`sugerencia-${s.supplier.id}-abrir`}>
          Ver sugerencia
        </Button>
      </div>
    </article>
  );
}

function CatalogRow({ r, qty, suggested, setQty, readOnly, supplierName }: {
  r: StockRow; qty: number; suggested?: number; setQty: (id: ID, packs: number) => void; readOnly: boolean; supplierName: string;
}) {
  const p = r.product;
  return (
    <Tr selected={qty > 0}>
      <Td>
        <p className="font-medium text-ink">{p.name}</p>
        <p className="text-[12.5px] text-ink-3">
          {p.offer.pack.label} · {supplierName}
        </p>
      </Td>
      <Td num className="whitespace-nowrap">
        <span className="font-medium">{money(p.offer.priceCents)}</span>
        <div className="text-[12px] text-ink-3">
          {unitCost(p)}
          {p.offer.taxRate > 0 && ' + ITBMS'}
        </div>
      </Td>
      <Td>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium tabular-nums">{fmtQty(r.qty, p.baseUnit)}</span>
          {r.level !== 'ok' && <StockLevelBadge level={r.level} />}
        </div>
        <p className="text-[12px] text-ink-3">
          {r.coverageDays !== null ? `Cubre ${fmtDays(r.coverageDays)}` : 'Sin datos de consumo'}
          {r.inboundBase > 0 && ` · en camino ${fmtQty(r.inboundBase, p.baseUnit)}`}
        </p>
      </Td>
      <Td align="right">
        {readOnly ? (
          <span className="text-ink-4">—</span>
        ) : (
          <div className="flex flex-col items-end gap-1">
            <Stepper size="sm" label={`Cantidad de ${p.name}`} value={qty} onChange={(v) => setQty(p.id, v)} />
            {suggested && qty !== suggested ? (
              <button
                type="button"
                onClick={() => setQty(p.id, suggested)}
                className="inline-flex items-center gap-1 whitespace-nowrap rounded px-1 text-[12px] font-medium text-brass-700 hover:bg-brass-50"
                title="Necesidad estimada: usar la cantidad sugerida"
              >
                <Sparkles className="size-3" />
                Sugerido: {fmtPacks(suggested, p.offer.pack)}
              </button>
            ) : null}
          </div>
        )}
      </Td>
    </Tr>
  );
}

// ───────────────────────────── Sugerencia de reabastecimiento ─────────────────────────────

function SuggestionDrawer({ suggestion, locationName, onClose }: { suggestion?: Suggestion; locationName: string; onClose: () => void }) {
  const user = useUser();
  const [edits, setEdits] = useState<Record<ID, number>>({});
  const s = suggestion;
  const key = s ? `${s.supplier.id}:${s.locationId}` : '';
  const [forKey, setForKey] = useState(key);
  if (key !== forKey) {
    setForKey(key);
    setEdits({});
  }
  const packsOf = (id: ID, fallback: number) => edits[id] ?? fallback;
  const total = s ? s.lines.reduce((t, l) => t + Math.round(packsOf(l.product.id, l.packs) * l.product.offer.priceCents * (1 + l.product.offer.taxRate)), 0) : 0;

  const add = () => {
    if (!s) return;
    run((d) => {
      for (const l of s.lines) setCartQty(d, s.locationId, l.product.id, packsOf(l.product.id, l.packs));
    });
    toast('ok', 'Sugerencia añadida al pedido', 'Puedes ajustar las cantidades antes de validar.');
    onClose();
  };

  return (
    <Drawer
      open={Boolean(s)}
      onOpenChange={(o) => !o && onClose()}
      width="lg"
      tourId="sugerencia-panel"
      eyebrow={`Sugerencia · ${locationName}`}
      title={s?.supplier.name ?? ''}
      description={s ? `Entrega estimada ${fmtDayWeek(s.deliveryDay)} (${fmtDays(s.supplier.leadTimeDays)} de plazo). La cantidad propuesta lleva cada producto a su nivel objetivo.` : undefined}
      footer={
        <>
          <span className="mr-auto text-[13.5px] text-ink-2">
            Total sugerido <strong className="ml-1 text-[16px] font-semibold tabular-nums text-forest-900">{money(total)}</strong>
          </span>
          <Button variant="ghost" onClick={onClose}>Cerrar</Button>
          <Button variant="primary" onClick={add} disabledReason={user.role === 'contabilidad' && 'Contabilidad consulta las compras en modo lectura.'} data-tour="sugerencia-add" icon={<ShoppingBasket className="size-4" />}>
            Añadir al pedido
          </Button>
        </>
      }
    >
      {s && (
        <ul className="space-y-3">
          {s.lines.map((l) => {
            const p = l.product;
            const n = packsOf(p.id, l.packs);
            return (
              <li key={p.id} data-tour={`sugerencia-linea-${p.id}`} className="rounded-xl border border-line bg-white/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-[14.5px] font-medium text-ink">
                      {p.name}
                      {l.level !== 'ok' && <StockLevelBadge level={l.level} />}
                    </p>
                    <p className="text-[12.5px] text-ink-3">{p.offer.pack.label} · {money(p.offer.priceCents)}</p>
                  </div>
                  <Stepper label={`Cantidad de ${p.name}`} value={n} onChange={(v) => setEdits((e) => ({ ...e, [p.id]: v }))} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-4">
                  <div>
                    <dt className="text-ink-3">Existencia</dt>
                    <dd className="font-medium tabular-nums text-ink">{fmtQty(l.qty, p.baseUnit)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-3">Consumo medio</dt>
                    <dd className="font-medium tabular-nums text-ink">{l.avgDaily > 0 ? `${fmtQty(l.avgDaily, p.baseUnit)} / día` : 'Sin datos'}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-3">Cobertura</dt>
                    <dd className={cn('font-medium tabular-nums', l.coverageDays !== null && l.coverageDays < 1 ? 'text-danger-700' : 'text-ink')}>{l.coverageDays !== null ? fmtDays(l.coverageDays) : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-3">Objetivo</dt>
                    <dd className="font-medium tabular-nums text-ink">{fmtQty(l.parBase, p.baseUnit)}</dd>
                  </div>
                </dl>
                <p className="mt-3 border-t border-line pt-2.5 text-[12.5px] text-ink-2">
                  {fmtPacks(n, p.offer.pack)} = <strong className="font-semibold">{fmtQty(n * p.offer.pack.baseQty, p.baseUnit)}</strong>
                  <span className="text-ink-3"> · quedarían {fmtQty(l.qty + l.inboundBase + n * p.offer.pack.baseQty, p.baseUnit)}</span>
                  {l.inboundBase > 0 && <span className="text-ink-3"> (incluye {fmtQty(l.inboundBase, p.baseUnit)} en camino)</span>}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Drawer>
  );
}

// ───────────────────────────── Carrito ─────────────────────────────

function Cart({ locationId, bare }: { locationId: LocationId; bare?: boolean }) {
  const navigate = useNavigate();
  const data = useDemo((s) => s.data);
  const user = useUser();
  const today = panamaDay(useNow());
  const loc = data.locations.find((l) => l.id === locationId)!;
  const groups = cartGroups(data, locationId, user, today);
  const [note, setNote] = useState('');
  const [delivery, setDelivery] = useState<Record<ID, string>>({});
  const total = groups.reduce((t, g) => t + g.totalCents, 0);
  const anyApproval = groups.some((g) => g.requiresApproval);
  const readOnly = user.role === 'contabilidad';

  const submit = (asDraft: boolean) => {
    const res = act((d, ctx) => submitCart(d, ctx, locationId, { asDraft, note: note.trim() || undefined, delivery }));
    if (!res.ok) return;
    setNote('');
    setDelivery({});
    const ids = res.value;
    if (ids.length === 1) {
      toast('ok', asDraft ? `Borrador ${ids[0]} guardado` : anyApproval ? `Pedido ${ids[0]} enviado a aprobación` : `Pedido ${ids[0]} validado`, asDraft || anyApproval ? undefined : 'El mensaje de WhatsApp está listo para enviarse.');
      navigate(`/compras/pedidos/${ids[0]}`);
    } else {
      toast('ok', `Se crearon ${ids.length} pedidos, uno por proveedor`, ids.join(' · '));
      navigate('/compras?vista=pedidos');
    }
  };

  return (
    <section className={cn('flex flex-col', bare ? 'flex-1' : 'max-h-[inherit] overflow-hidden rounded-xl border border-line bg-paper shadow-panel')} data-tour="cart">
      {bare ? (
        groups.length > 0 && (
          <div className="flex items-center justify-between border-b border-line px-5 py-2.5 text-[13px] text-ink-3">
            {plural(data.carts[locationId].length, 'artículo', 'artículos')} · {plural(groups.length, 'proveedor', 'proveedores')}
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => run((d) => clearCart(d, locationId))}>Vaciar</Button>
          </div>
        )
      ) : (
        <PanelHeader
          title={<>Pedido para {loc.name}</>}
          hint={groups.length === 0 ? 'Aún no has añadido nada' : `${plural(data.carts[locationId].length, 'artículo', 'artículos')} · ${plural(groups.length, 'proveedor', 'proveedores')}`}
          actions={
            groups.length > 0 ? (
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => run((d) => clearCart(d, locationId))}>
                Vaciar
              </Button>
            ) : undefined
          }
        />
      )}
      {groups.length === 0 ? (
        <EmptyState icon={<ShoppingBasket className="size-5" />} title="Tu pedido está vacío">
          Añade productos desde el catálogo o parte de una sugerencia de reabastecimiento.
        </EmptyState>
      ) : (
        <>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {groups.length > 1 && (
              <Note tone="info" icon={<Info className="size-4" />}>
                Se generarán <strong>{groups.length} pedidos</strong>, uno por proveedor. Cada uno se aprueba y se envía por separado.
              </Note>
            )}
            {groups.map((g) => {
              const supplier = data.suppliers.find((s) => s.id === g.supplierId)!;
              return (
                <section key={g.supplierId} className="rounded-xl border border-line bg-white/60">
                  <header className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
                    <h3 className="truncate text-[14px] font-semibold text-ink">{supplier.name}</h3>
                    <span className="text-[13px] font-semibold tabular-nums text-forest-900">{money(g.totalCents)}</span>
                  </header>
                  <ul className="divide-y divide-line/70">
                    {g.lines.map((l) => {
                      const p = data.products.find((x) => x.id === l.productId)!;
                      return (
                        <li key={l.productId} className="flex items-center gap-2.5 px-3.5 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13.5px] font-medium text-ink">{p.name}</p>
                            <p className="truncate text-[12px] text-ink-3">
                              {l.packLabel} · {fmtQty(l.packs * l.packBaseQty, p.baseUnit)} · {money(Math.round(l.packs * l.unitPriceCents))}
                            </p>
                          </div>
                          <Stepper size="sm" label={`Cantidad de ${p.name}`} value={l.packs} onChange={(v) => run((d) => setCartQty(d, locationId, p.id, v))} data-tour={`cart-qty-${p.id}`} />
                        </li>
                      );
                    })}
                  </ul>
                  <div className="space-y-2 border-t border-line px-3.5 py-2.5">
                    {g.taxCents > 0 && (
                      <p className="flex justify-between text-[12.5px] text-ink-3">
                        <span>Subtotal {money(g.subtotalCents)} + ITBMS 7 %</span>
                        <span className="tabular-nums">{money(g.taxCents)}</span>
                      </p>
                    )}
                    <label className="flex items-center justify-between gap-2 text-[12.5px] text-ink-2">
                      <span className="flex items-center gap-1.5">
                        <CalendarDays className="size-3.5 text-ink-3" /> Entrega solicitada
                      </span>
                      <input
                        type="date"
                        min={today}
                        value={delivery[g.supplierId] ?? g.requestedDelivery}
                        onChange={(e) => setDelivery((dv) => ({ ...dv, [g.supplierId]: e.target.value || g.requestedDelivery }))}
                        className="h-7 rounded-md border border-line-strong bg-white px-1.5 text-[12.5px] tabular-nums focus:border-forest-600 focus:outline-none"
                      />
                    </label>
                    {user.role === 'gerente' &&
                      (g.requiresApproval ? (
                        <p className="flex items-start gap-1.5 text-[12.5px] leading-snug text-warn-800">
                          <ShieldCheck className="mt-px size-3.5 shrink-0" /> Supera {money0(data.settings.approvalThresholdCents)}: necesitará la aprobación de Dirección.
                        </p>
                      ) : (
                        <p className="flex items-start gap-1.5 text-[12.5px] leading-snug text-ok-700">
                          <ShieldCheck className="mt-px size-3.5 shrink-0" /> Bajo el umbral: se aprueba automáticamente.
                        </p>
                      ))}
                  </div>
                </section>
              );
            })}
            <Field label="Nota para el proveedor (opcional)" htmlFor="nota-pedido">
              <Textarea id="nota-pedido" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Por ejemplo: entregar por la puerta de servicio." className="min-h-[52px]" />
            </Field>
          </div>
          <footer className="space-y-2.5 border-t border-line px-5 py-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[13.5px] text-ink-2">Total del pedido</span>
              <span className="text-[20px] font-semibold tabular-nums text-forest-900">{money(total)}</span>
            </div>
            <Button variant="primary" size="lg" block onClick={() => submit(false)} disabledReason={readOnly && 'Contabilidad consulta las compras en modo lectura.'} data-tour="cart-submit">
              {user.role === 'direccion' ? (groups.length > 1 ? `Validar ${groups.length} pedidos` : 'Validar pedido') : anyApproval ? 'Enviar a aprobación' : groups.length > 1 ? `Validar ${groups.length} pedidos` : 'Validar pedido'}
            </Button>
            <Button variant="ghost" block onClick={() => submit(true)} disabled={readOnly}>
              Guardar como borrador
            </Button>
          </footer>
        </>
      )}
    </section>
  );
}

// ───────────────────────────── Pedidos ─────────────────────────────

type EstadoFiltro = 'en_curso' | 'pendiente_aprobacion' | 'recibidos' | 'cancelados' | 'todos';
const EN_CURSO: OrderStatus[] = ['borrador', 'pendiente_aprobacion', 'aprobado', 'enviado', 'confirmado', 'recibido_parcial'];

function nextAction(o: PurchaseOrder, role: string): string | null {
  if (o.status === 'pendiente_aprobacion') return role === 'direccion' ? 'Aprobar' : null;
  if (role === 'contabilidad') return null;
  if (o.status === 'borrador') return 'Completar';
  if (o.status === 'aprobado') return 'Enviar';
  if (o.status === 'enviado' || o.status === 'confirmado') return 'Recibir';
  if (o.status === 'recibido_parcial') return 'Recibir faltante';
  return null;
}

function PedidosTab() {
  const navigate = useNavigate();
  const data = useDemo((s) => s.data);
  const user = useUser();
  const now = useNow();
  const filter = useLocationFilter();
  const [estado, setEstado] = useQuery<EstadoFiltro>('estado', 'en_curso');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(25);

  const inScope = data.orders.filter((o) => filter === 'all' || o.locationId === filter);
  const counts = {
    en_curso: inScope.filter((o) => EN_CURSO.includes(o.status)).length,
    pendiente_aprobacion: inScope.filter((o) => o.status === 'pendiente_aprobacion').length,
    recibidos: inScope.filter((o) => o.status === 'recibido').length,
    cancelados: inScope.filter((o) => o.status === 'cancelado').length,
    todos: inScope.length,
  };
  const needle = q.trim().toLowerCase();
  const list = inScope
    .filter((o) =>
      estado === 'todos' ? true
      : estado === 'en_curso' ? EN_CURSO.includes(o.status)
      : estado === 'recibidos' ? o.status === 'recibido'
      : estado === 'cancelados' ? o.status === 'cancelado'
      : o.status === 'pendiente_aprobacion',
    )
    .filter((o) => !needle || o.id.toLowerCase().includes(needle) || data.suppliers.find((s) => s.id === o.supplierId)!.name.toLowerCase().includes(needle))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return (
    <Panel data-tour="pedidos">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
        <Segmented<EstadoFiltro>
          label="Estado de los pedidos"
          value={estado}
          onChange={(v) => {
            setEstado(v);
            setLimit(25);
          }}
          options={[
            { id: 'en_curso', label: 'En curso', count: counts.en_curso },
            { id: 'pendiente_aprobacion', label: 'Por aprobar', count: counts.pendiente_aprobacion },
            { id: 'recibidos', label: 'Recibidos', count: counts.recibidos },
            { id: 'cancelados', label: 'Cancelados', count: counts.cancelados },
            { id: 'todos', label: 'Todos', count: counts.todos },
          ]}
        />
        <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-[280px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por número o proveedor…" aria-label="Buscar pedidos" className="pl-9" />
        </div>
      </div>
      {list.length === 0 ? (
        <EmptyState icon={<ShoppingBasket className="size-5" />} title="No hay pedidos en esta vista" action={<Button onClick={() => navigate('/compras')}>Ir al catálogo</Button>}>
          Cambia el filtro de estado o de local, o prepara un pedido nuevo desde el catálogo.
        </EmptyState>
      ) : (
        <>
          <ul className="divide-y divide-line/80 md:hidden">
            {list.slice(0, limit).map((o) => {
              const supplier = data.suppliers.find((x) => x.id === o.supplierId)!;
              const action = nextAction(o, user.role);
              return (
                <li key={o.id}>
                  <Link to={`/compras/pedidos/${o.id}`} className="flex items-center gap-3 px-4 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-ink">
                        <span className="tabular-nums">{o.id}</span>
                        <OrderStatusBadge order={o} />
                      </p>
                      <p className="mt-1 truncate text-[13px] text-ink-2">{supplier.name} · {money(orderTotals(o).totalCents)}</p>
                      <p className="text-[12.5px] text-ink-3">Entrega {fmtDate(o.requestedDelivery)}</p>
                    </div>
                    {action ? <span className="shrink-0 rounded-lg bg-forest-700 px-3 py-2 text-[13px] font-medium text-paper">{action}</span> : <ArrowRight className="size-4 shrink-0 text-ink-3" />}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="hidden md:block">
          <Table minWidth={860}>
            <thead>
              <tr>
                <Th>Pedido</Th>
                <Th>Proveedor</Th>
                <Th>Local</Th>
                <Th>Entrega solicitada</Th>
                <Th align="right">Total</Th>
                <Th>Estado</Th>
                <Th align="right">
                  <span className="sr-only">Siguiente paso</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, limit).map((o) => {
                const supplier = data.suppliers.find((s) => s.id === o.supplierId)!;
                const loc = data.locations.find((l) => l.id === o.locationId)!;
                const action = nextAction(o, user.role);
                return (
                  <Tr key={o.id} onClick={() => navigate(`/compras/pedidos/${o.id}`)} data-tour={`pedido-${o.id}`}>
                    <Td>
                      <Link to={`/compras/pedidos/${o.id}`} onClick={(e) => e.stopPropagation()} className="font-medium tabular-nums text-forest-800 hover:underline">
                        {o.id}
                      </Link>
                      <div className="text-[12px] text-ink-3">
                        {fmtWhen(o.createdAt, now)} · {userName(data, o.createdBy)}
                      </div>
                    </Td>
                    <Td>
                      {supplier.name}
                      <div className="text-[12px] text-ink-3">{plural(o.lines.length, 'artículo', 'artículos')}</div>
                    </Td>
                    <Td><LocationTag id={loc.id} name={loc.name} /></Td>
                    <Td className="tabular-nums">{fmtDate(o.requestedDelivery)}</Td>
                    <Td num className="font-medium">{money(orderTotals(o).totalCents)}</Td>
                    <Td><OrderStatusBadge order={o} /></Td>
                    <Td align="right">
                      {action && (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-medium text-forest-700">
                          {action} <ArrowRight className="size-3.5" />
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
              <Button variant="ghost" size="sm" onClick={() => setLimit((n) => n + 25)}>
                Mostrar más ({list.length - limit} restantes)
              </Button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

// ───────────────────────────── Proveedores ─────────────────────────────

function ProveedoresTab() {
  const data = useDemo((s) => s.data);
  const today = panamaDay(useNow());
  const filter = useLocationFilter();
  const period = usePeriod();
  const range = periodRange(period, today);
  const bySupplier = purchasesBySupplier(data, range.from, range.to, filter);
  const flow = purchaseFlow(data, range.from, range.to, filter);
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <Panel>
        <PanelHeader title="Proveedores" hint="Proveedores ficticios de la demostración, con sus condiciones habituales" />
        <Table minWidth={720}>
          <thead>
            <tr>
              <Th>Proveedor</Th>
              <Th>Contacto</Th>
              <Th align="right">Plazo de entrega</Th>
              <Th align="right">Condiciones de pago</Th>
              <Th align="right">Productos</Th>
            </tr>
          </thead>
          <tbody>
            {data.suppliers.map((s) => (
              <Tr key={s.id}>
                <Td>
                  <p className="font-medium text-ink">{s.name}</p>
                  <p className="text-[12.5px] text-ink-3">{s.categoryLabel} · RUC {s.ruc}</p>
                </Td>
                <Td>
                  {s.contactName}
                  <div className="flex items-center gap-1 text-[12.5px] text-ink-3">
                    <Phone className="size-3" /> <span className="tabular-nums">{s.whatsapp}</span>
                    <MessageCircle className="ml-1 size-3" /> WhatsApp
                  </div>
                </Td>
                <Td num>
                  {fmtDays(s.leadTimeDays)}
                  <div className="text-[12px] text-ink-3">entrega cada {fmtDays(s.cadenceDays)}</div>
                </Td>
                <Td num>{s.paymentTermsDays} días</Td>
                <Td num>{data.products.filter((p) => p.offer.supplierId === s.id).length}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Panel>
      <Panel className="self-start">
        <PanelHeader title="Compras recibidas por proveedor" hint={`${range.label} · total ${money0(flow.receivedCents)}, sin impuestos`} />
        <div className="px-5 py-4">
          {flow.receivedCents === 0 ? (
            <p className="py-6 text-center text-[13.5px] text-ink-3">No hay recepciones en este período.</p>
          ) : (
            <RankedBars rows={bySupplier.map((b) => ({ key: b.supplier.id, label: b.supplier.name, value: b.cents }))} />
          )}
        </div>
      </Panel>
    </div>
  );
}
