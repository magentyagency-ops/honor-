import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeftRight, ArrowRight, Pencil, ShoppingBasket, Trash2, Truck } from 'lucide-react';
import type { ID, LocationId } from '@/domain/types';
import { userName } from '@/domain/core';
import { days as fmtDays, displayUnit, fromDisplay, money, qty as fmtQty, toDisplay } from '@/domain/format';
import { fmtWhen, minutesBetween, panamaDay } from '@/domain/time';
import { MOVEMENT_LABEL, updateStockSetting } from '@/domain/inventory';
import { stockHistory, stockRows } from '@/domain/selectors';
import { act, useDemo, useNow, useUser } from '@/store';
import { Button, Field, Input, LevelBar, cn } from '@/ui/primitives';
import { Drawer } from '@/ui/overlays';
import { StockLevelBadge, levelTone } from '@/ui/status';
import { StockChart } from '@/ui/charts';
import { MOVEMENT_ICON, movementOrigin } from './shared';

export function ProductDrawer({ productId, locationId, onClose, onWaste, onTransfer }: {
  productId: ID | null; locationId: LocationId | null; onClose: () => void; onWaste: () => void; onTransfer: () => void;
}) {
  const navigate = useNavigate();
  const data = useDemo((s) => s.data);
  const user = useUser();
  const now = useNow();
  const today = panamaDay(now);
  const [editing, setEditing] = useState(false);
  const [minV, setMinV] = useState('');
  const [parV, setParV] = useState('');
  useEffect(() => setEditing(false), [productId, locationId]);

  const open = Boolean(productId && locationId);
  const row = open ? stockRows(data, today, locationId!).find((r) => r.product.id === productId) : undefined;
  if (!row || !locationId) return <Drawer open={false} onOpenChange={() => onClose()} title=""><span /></Drawer>;

  const p = row.product;
  const loc = data.locations.find((l) => l.id === locationId)!;
  const supplier = data.suppliers.find((s) => s.id === p.offer.supplierId)!;
  const history = stockHistory(data, locationId, p.id, today);
  const moves = data.movements
    .filter((m) => m.locationId === locationId && m.productId === p.id)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const canOperate = user.role !== 'contabilidad' && (user.role !== 'gerente' || user.locationId === locationId);
  const unit = displayUnit(p.baseUnit);

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => !o && onClose()}
      width="xl"
      tourId="producto-panel"
      eyebrow={`Inventario · ${loc.name}`}
      title={p.name}
      description={`${p.offer.pack.label} · ${supplier.name} · se lleva en ${p.baseUnit === 'g' ? 'gramos (se muestra en kg)' : p.baseUnit === 'ml' ? 'mililitros (se muestra en L)' : 'unidades'}`}
      footer={
        <>
          <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={onWaste} disabledReason={!canOperate && 'Tu perfil no registra movimientos de inventario en este local.'}>
            Registrar merma
          </Button>
          <Button variant="ghost" icon={<ArrowLeftRight className="size-4" />} onClick={onTransfer} disabledReason={user.role === 'contabilidad' && 'Contabilidad no registra transferencias.'}>
            Transferir
          </Button>
          <Button
            variant="primary"
            icon={<ShoppingBasket className="size-4" />}
            onClick={() => navigate(`/compras?local=${locationId}&proveedor=${supplier.id}`)}
            disabled={user.role === 'contabilidad'}
          >
            Pedir a {supplier.short}
          </Button>
        </>
      }
    >
      {/* Cifras clave */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4" data-tour="producto-existencia">
        <div className="bg-paper px-4 py-3.5 sm:col-span-1">
          <p className="text-[12px] text-ink-3">Existencia teórica</p>
          <p className={cn('mt-1 text-[24px] font-semibold leading-none tracking-[-0.02em]', row.level === 'ok' ? 'text-forest-900' : row.level === 'bajo' ? 'text-warn-800' : 'text-danger-700')}>{fmtQty(row.qty, p.baseUnit)}</p>
          <div className="mt-2"><StockLevelBadge level={row.level} /></div>
        </div>
        <div className="bg-paper px-4 py-3.5">
          <p className="text-[12px] text-ink-3">Cobertura</p>
          <p className="mt-1 text-[18px] font-semibold leading-none text-ink">{row.coverageDays !== null ? fmtDays(row.coverageDays) : '—'}</p>
          <p className="mt-2 text-[12px] text-ink-3">{row.avgDaily > 0 ? `a ${fmtQty(row.avgDaily, p.baseUnit)} por día` : 'Sin datos de consumo suficientes'}</p>
        </div>
        <div className="bg-paper px-4 py-3.5">
          <p className="text-[12px] text-ink-3">Mínimo · objetivo</p>
          <p className="mt-1 text-[18px] font-semibold leading-none text-ink">{fmtQty(row.minBase, p.baseUnit)}</p>
          <p className="mt-2 text-[12px] text-ink-3">objetivo {fmtQty(row.parBase, p.baseUnit)}</p>
        </div>
        <div className="bg-paper px-4 py-3.5">
          <p className="text-[12px] text-ink-3">Valor estimado</p>
          <p className="mt-1 text-[18px] font-semibold leading-none text-ink">{money(row.valueCents)}</p>
          <p className="mt-2 text-[12px] text-ink-3">al último costo de compra</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-[180px] flex-1">
          <LevelBar value={row.qty} min={row.minBase} max={row.parBase} tone={levelTone(row.level)} />
        </div>
        {row.inboundBase > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-info-700">
            <Truck className="size-3.5" /> En camino: {fmtQty(row.inboundBase, p.baseUnit)}
          </span>
        )}
        {canOperate && !editing && (
          <button
            type="button"
            onClick={() => {
              setMinV(String(toDisplay(row.minBase, p.baseUnit)));
              setParV(String(toDisplay(row.parBase, p.baseUnit)));
              setEditing(true);
            }}
            className="inline-flex items-center gap-1 text-[12.5px] font-medium text-forest-700 hover:underline"
          >
            <Pencil className="size-3" /> Cambiar mínimo
          </button>
        )}
      </div>
      {editing && (
        <form
          className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white/60 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const res = act(
              (d, ctx) => updateStockSetting(d, ctx, locationId, p.id, { minBase: fromDisplay(Number(minV.replace(',', '.')), p.baseUnit), parBase: fromDisplay(Number(parV.replace(',', '.')), p.baseUnit) }),
              'Mínimo actualizado',
            );
            if (res.ok) setEditing(false);
          }}
        >
          <Field label={`Mínimo (${unit})`} htmlFor="min-base" className="w-28">
            <Input id="min-base" inputMode="decimal" value={minV} onChange={(e) => setMinV(e.target.value)} className="tabular-nums" />
          </Field>
          <Field label={`Objetivo (${unit})`} htmlFor="par-base" className="w-28">
            <Input id="par-base" inputMode="decimal" value={parV} onChange={(e) => setParV(e.target.value)} className="tabular-nums" />
          </Field>
          <Button type="submit" variant="primary">Guardar</Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
        </form>
      )}

      <div className="mt-6">
        <StockChart data={history} baseUnit={p.baseUnit} minBase={row.minBase} />
      </div>

      {/* De dónde viene cada variación */}
      <div className="mt-6" data-tour="producto-movimientos">
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <h3 className="serif text-[18px] font-[520] leading-tight text-forest-900">Movimientos</h3>
            <p className="text-[12.5px] text-ink-3">La existencia es la suma de estas líneas: cada variación tiene un origen.</p>
          </div>
          <Link to={`/inventario?vista=movimientos&producto=${p.id}`} className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-forest-700 hover:underline">
            Ver todos <ArrowRight className="size-3" />
          </Link>
        </div>
        <ul className="divide-y divide-line/80 rounded-xl border border-line bg-white/60">
          {moves.slice(0, 14).map((m) => {
            const Icon = MOVEMENT_ICON[m.type];
            const origin = movementOrigin(data, m);
            const fresh = minutesBetween(m.at, now) < 3;
            return (
              <li key={m.id} data-tour={`mov-${m.type}`} className={cn('flex items-center gap-3 px-4 py-2.5', fresh && 'animate-flash')}>
                <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset', m.qty >= 0 ? 'bg-ok-50 text-ok-700 ring-ok-100' : 'bg-linen text-ink-2 ring-line')}>
                  <Icon className="size-3.5" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium leading-snug text-ink">
                    {MOVEMENT_LABEL[m.type]}
                    {fresh && <span className="eyebrow ml-2 text-brass-700">Nuevo</span>}
                  </p>
                  <p className="truncate text-[12.5px] text-ink-3">
                    {origin.to ? <Link to={origin.to} className="hover:text-forest-700 hover:underline">{origin.text}</Link> : origin.text}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={cn('text-[14px] font-semibold tabular-nums', m.qty >= 0 ? 'text-ok-700' : 'text-ink')}>{fmtQty(m.qty, p.baseUnit, { sign: true })}</p>
                  <p className="text-[12px] text-ink-3">{fmtWhen(m.at, now)} · {userName(data, m.by)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Drawer>
  );
}
