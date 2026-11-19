import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeftRight, ClipboardCheck, Info, Search, Trash2, Truck } from 'lucide-react';
import type { CategoryId, ID, LocationId, MovementType } from '@/domain/types';
import { CATEGORIES } from '@/data/catalog';
import { userName } from '@/domain/core';
import { days as fmtDays, money, money0, plural, qty as fmtQty } from '@/domain/format';
import { atPanama, addDays, fmtDateTime, fmtWhen, minutesBetween, panamaDay } from '@/domain/time';
import { MOVEMENT_LABEL } from '@/domain/inventory';
import { periodRange, stockRows, type StockLevel, type StockRow } from '@/domain/selectors';
import { useDemo, useLocationFilter, useNow, usePeriod, useUser } from '@/store';
import { useQuery } from '@/lib/useQuery';
import {
  Badge, Button, EmptyState, Input, LevelBar, LocationTag, PageHeader, Panel, Segmented, Select, TabBar, Table, Td, Th, Tip, Tr, cn,
} from '@/ui/primitives';
import { StockLevelBadge, levelTone } from '@/ui/status';
import { CountDrawer, TransferDialog, WasteDialog } from './InventoryDialogs';
import { ProductDrawer } from './ProductDrawer';
import { RecipesTab } from './RecipesTab';
import { MOVEMENT_ICON, movementOrigin } from './shared';

type Vista = 'existencias' | 'movimientos' | 'recetas' | 'conteos';
type Nivel = 'todos' | 'bajo' | 'riesgo';

export function InventarioPage() {
  const data = useDemo((s) => s.data);
  const user = useUser();
  const filter = useLocationFilter();
  const today = panamaDay(useNow());
  const [vista, setVista] = useQuery<Vista>('vista', 'existencias');
  const [pid, setPid] = useQuery<string>('producto', '');
  const [en, setEn] = useQuery<string>('en', '');
  const [waste, setWaste] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [count, setCount] = useState(false);

  const drawerLoc = (filter !== 'all' ? filter : en || null) as LocationId | null;
  const drawerOpen = vista === 'existencias' && Boolean(pid) && Boolean(drawerLoc);
  const rows = stockRows(data, today, filter);
  const below = rows.filter((r) => r.level !== 'ok').length;
  const canOperate = user.role !== 'contabilidad';

  return (
    <div>
      <PageHeader
        title="Inventario"
        subtitle="Existencias por producto y por local, calculadas a partir de cada movimiento: recepciones, ventas, mermas, transferencias y conteos."
        actions={
          <>
            <Button icon={<Trash2 className="size-4" />} onClick={() => setWaste(true)} disabledReason={!canOperate && 'Contabilidad consulta el inventario en modo lectura.'}>
              Merma
            </Button>
            <Button icon={<ArrowLeftRight className="size-4" />} onClick={() => setTransfer(true)} disabledReason={!canOperate && 'Contabilidad consulta el inventario en modo lectura.'}>
              Transferir
            </Button>
            <Button variant="primary" icon={<ClipboardCheck className="size-4" />} onClick={() => setCount(true)} disabledReason={!canOperate && 'Contabilidad consulta el inventario en modo lectura.'}>
              Conteo físico
            </Button>
          </>
        }
      />
      <TabBar<Vista>
        label="Secciones de inventario"
        value={vista}
        onChange={(v) => {
          setVista(v);
        }}
        tabs={[
          { id: 'existencias', label: 'Existencias', count: below, attention: below > 0 },
          { id: 'movimientos', label: 'Movimientos' },
          { id: 'recetas', label: 'Recetas', count: data.recipes.length },
          { id: 'conteos', label: 'Conteos físicos', count: data.counts.filter((c) => filter === 'all' || c.locationId === filter).length },
        ]}
      />

      {vista === 'existencias' && (
        <StockTab
          rows={rows}
          onOpen={(productId, locationId) => {
            setPid(productId);
            if (filter === 'all') setEn(locationId);
          }}
        />
      )}
      {vista === 'movimientos' && <MovementsTab />}
      {vista === 'recetas' && <RecipesTab />}
      {vista === 'conteos' && <CountsTab onNew={() => setCount(true)} />}

      <ProductDrawer
        productId={drawerOpen ? pid : null}
        locationId={drawerOpen ? drawerLoc : null}
        onClose={() => {
          setPid(null);
          setEn(null);
        }}
        onWaste={() => setWaste(true)}
        onTransfer={() => setTransfer(true)}
      />
      <WasteDialog open={waste} onClose={() => setWaste(false)} locationId={drawerLoc ?? (filter !== 'all' ? filter : undefined)} productId={pid || undefined} />
      <TransferDialog open={transfer} onClose={() => setTransfer(false)} locationId={drawerLoc ?? (filter !== 'all' ? filter : undefined)} productId={pid || undefined} />
      <CountDrawer open={count} onClose={() => setCount(false)} locationId={filter !== 'all' ? filter : undefined} />
    </div>
  );
}

// ───────────────────────────── Existencias ─────────────────────────────

function StockTab({ rows, onOpen }: { rows: StockRow[]; onOpen: (productId: ID, locationId: LocationId) => void }) {
  const data = useDemo((s) => s.data);
  const now = useNow();
  const filter = useLocationFilter();
  const [q, setQ] = useState('');
  const [cat, setCat] = useQuery<CategoryId | 'todas'>('categoria', 'todas');
  const [nivel, setNivel] = useQuery<Nivel>('nivel', 'todos');

  const needle = q.trim().toLowerCase();
  const match = (r: StockRow) =>
    (cat === 'todas' || r.product.category === cat) && (!needle || r.product.name.toLowerCase().includes(needle));
  const levelOk = (l: StockLevel) => (nivel === 'todos' ? true : nivel === 'bajo' ? l !== 'ok' : l === 'critico' || l === 'agotado');
  const counts = { bajo: rows.filter((r) => r.level !== 'ok').length, riesgo: rows.filter((r) => r.level === 'critico' || r.level === 'agotado').length };
  const total = rows.reduce((t, r) => t + r.valueCents, 0);

  const toolbar = (
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
      <div className="relative min-w-[200px] flex-1 sm:max-w-[300px]">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto…" aria-label="Buscar producto" className="pl-9" />
      </div>
      <Select value={cat} onChange={(e) => setCat(e.target.value as CategoryId | 'todas')} aria-label="Categoría" className="w-auto min-w-[170px]">
        <option value="todas">Todas las categorías</option>
        {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </Select>
      <Segmented<Nivel>
        label="Nivel de existencia"
        value={nivel}
        onChange={setNivel}
        options={[
          { id: 'todos', label: 'Todos' },
          { id: 'bajo', label: 'Bajo mínimo', count: counts.bajo },
          { id: 'riesgo', label: 'Riesgo de quiebre', count: counts.riesgo },
        ]}
      />
      <span className="ml-auto text-[13px] text-ink-2">
        Valor estimado <strong className="ml-1 font-semibold tabular-nums text-forest-900">{money0(total)}</strong>
      </span>
    </div>
  );

  const footnote = (
    <p className="flex items-start gap-2 border-t border-line px-5 py-3 text-[12.5px] leading-snug text-ink-3">
      <Info className="mt-px size-3.5 shrink-0" />
      <span>
        Estas existencias son <strong className="font-medium text-ink-2">teóricas</strong>: resultan de sumar los movimientos registrados. Concílialas con conteos físicos periódicos;
        los productos que no pasan por recetas (empaques, limpieza) solo se actualizan al contarlos.
      </span>
    </p>
  );

  if (filter === 'all') {
    // Vista comparada: un producto por fila, un local por columna.
    const byProduct = data.products
      .map((p) => ({ product: p, cells: data.locations.map((l) => rows.find((r) => r.product.id === p.id && r.locationId === l.id)!) }))
      .filter((x) => match(x.cells[0]) && x.cells.some((c) => levelOk(c.level)));
    return (
      <Panel data-tour="existencias">
        {toolbar}
        {byProduct.length === 0 ? (
          <EmptyState icon={<Search className="size-5" />} title="Ningún producto coincide">Cambia la búsqueda o los filtros.</EmptyState>
        ) : (
          <Table minWidth={820}>
            <thead>
              <tr>
                <Th>Producto</Th>
                {data.locations.map((l) => (
                  <Th key={l.id} align="right"><LocationTag id={l.id} name={l.name} /></Th>
                ))}
                <Th align="right">Total</Th>
                <Th align="right">Valor</Th>
              </tr>
            </thead>
            <tbody>
              {byProduct.map(({ product: p, cells }) => (
                <Tr key={p.id}>
                  <Td>
                    <p className="font-medium text-ink">{p.name}</p>
                    <p className="text-[12.5px] text-ink-3">{CATEGORIES.find((c) => c.id === p.category)!.label}</p>
                  </Td>
                  {cells.map((c) => (
                    <Td key={c.locationId} align="right" className="p-0">
                      <button
                        type="button"
                        onClick={() => onOpen(p.id, c.locationId)}
                        data-tour={`stock-${c.locationId}-${p.id}`}
                        className="flex w-full flex-col items-end gap-1 px-3 py-2.5 text-right transition-colors hover:bg-linen/70"
                        aria-label={`${p.name} en ${data.locations.find((l) => l.id === c.locationId)!.name}: ${fmtQty(c.qty, p.baseUnit)}`}
                      >
                        <span className={cn('font-medium tabular-nums', c.level === 'ok' ? 'text-ink' : c.level === 'bajo' ? 'text-warn-800' : 'text-danger-700')}>{fmtQty(c.qty, p.baseUnit)}</span>
                        {c.level !== 'ok' ? <StockLevelBadge level={c.level} /> : <span className="text-[12px] text-ink-3">{c.coverageDays !== null ? fmtDays(c.coverageDays) : 'sin datos'}</span>}
                      </button>
                    </Td>
                  ))}
                  <Td num className="font-medium">{fmtQty(cells.reduce((t, c) => t + c.qty, 0), p.baseUnit)}</Td>
                  <Td num>{money(cells.reduce((t, c) => t + c.valueCents, 0))}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {footnote}
      </Panel>
    );
  }

  const list = rows.filter((r) => match(r) && levelOk(r.level));
  return (
    <Panel data-tour="existencias">
      {toolbar}
      {list.length === 0 ? (
        <EmptyState icon={<Search className="size-5" />} title="Ningún producto coincide">Cambia la búsqueda o los filtros.</EmptyState>
      ) : (
        <>
          <div className="hidden md:block">
            <Table minWidth={900}>
              <thead>
                <tr>
                  <Th>Producto</Th>
                  <Th className="w-[210px]">Existencia</Th>
                  <Th align="right">Mínimo</Th>
                  <Th align="right">Consumo medio</Th>
                  <Th align="right">
                    <Tip content="Días que dura la existencia al ritmo de consumo actual. Se muestra solo si hay datos suficientes."><span tabIndex={0}>Cobertura</span></Tip>
                  </Th>
                  <Th>Último movimiento</Th>
                  <Th align="right">Valor</Th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const p = r.product;
                  return (
                    <Tr key={p.id} onClick={() => onOpen(p.id, r.locationId)} data-tour={`stock-${r.locationId}-${p.id}`}>
                      <Td>
                        <button type="button" className="text-left font-medium text-ink hover:underline" onClick={(e) => { e.stopPropagation(); onOpen(p.id, r.locationId); }}>
                          {p.name}
                        </button>
                        <p className="text-[12.5px] text-ink-3">{CATEGORIES.find((c) => c.id === p.category)!.label}</p>
                      </Td>
                      <Td>
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn('font-semibold tabular-nums', r.level === 'ok' ? 'text-ink' : r.level === 'bajo' ? 'text-warn-800' : 'text-danger-700')}>{fmtQty(r.qty, p.baseUnit)}</span>
                          {r.level !== 'ok' && <StockLevelBadge level={r.level} />}
                        </div>
                        <div className="mt-1.5"><LevelBar value={r.qty} min={r.minBase} max={r.parBase} tone={levelTone(r.level)} /></div>
                        {r.inboundBase > 0 && (
                          <p className="mt-1 flex items-center gap-1 text-[12px] text-info-700"><Truck className="size-3" /> en camino {fmtQty(r.inboundBase, p.baseUnit)}</p>
                        )}
                      </Td>
                      <Td num className="text-ink-2">{fmtQty(r.minBase, p.baseUnit)}</Td>
                      <Td num>{r.avgDaily > 0 ? <>{fmtQty(r.avgDaily, p.baseUnit)}<span className="text-ink-3"> / día</span></> : <span className="text-ink-4">—</span>}</Td>
                      <Td num className={cn(r.coverageDays !== null && r.coverageDays < 1 && 'font-semibold text-danger-700')}>
                        {r.coverageDays !== null ? fmtDays(r.coverageDays) : <Tip content="Aún no hay consumo registrado para estimarla."><span className="text-ink-4">Sin datos</span></Tip>}
                      </Td>
                      <Td>
                        {r.last ? (
                          <>
                            <span className="text-ink">{MOVEMENT_LABEL[r.last.type]}</span>
                            <div className="text-[12px] text-ink-3">{fmtQty(r.last.qty, p.baseUnit, { sign: true })} · {fmtWhen(r.last.at, now)}</div>
                          </>
                        ) : (
                          <Badge tone="warn">Sin inventario inicial</Badge>
                        )}
                      </Td>
                      <Td num>{money(r.valueCents)}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
          {/* Móvil */}
          <ul className="divide-y divide-line/80 md:hidden">
            {list.map((r) => (
              <li key={r.product.id}>
                <button type="button" onClick={() => onOpen(r.product.id, r.locationId)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-ink">{r.product.name}</p>
                    <p className="mt-0.5 text-[12.5px] text-ink-3">
                      Mínimo {fmtQty(r.minBase, r.product.baseUnit)} · {r.coverageDays !== null ? `cubre ${fmtDays(r.coverageDays)}` : 'sin datos de consumo'}
                    </p>
                    <div className="mt-2"><LevelBar value={r.qty} min={r.minBase} max={r.parBase} tone={levelTone(r.level)} /></div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={cn('text-[15px] font-semibold tabular-nums', r.level === 'ok' ? 'text-ink' : r.level === 'bajo' ? 'text-warn-800' : 'text-danger-700')}>{fmtQty(r.qty, r.product.baseUnit)}</p>
                    {r.level !== 'ok' && <div className="mt-1"><StockLevelBadge level={r.level} /></div>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {footnote}
    </Panel>
  );
}

// ───────────────────────────── Movimientos ─────────────────────────────

type TipoFiltro = 'todos' | 'recepcion' | 'venta' | 'merma' | 'transferencia' | 'conteo';
const TIPO_MATCH: Record<TipoFiltro, MovementType[] | null> = {
  todos: null,
  recepcion: ['recepcion'],
  venta: ['venta'],
  merma: ['merma'],
  transferencia: ['transferencia_entrada', 'transferencia_salida'],
  conteo: ['ajuste_conteo', 'inventario_inicial'],
};

function MovementsTab() {
  const data = useDemo((s) => s.data);
  const now = useNow();
  const today = panamaDay(now);
  const filter = useLocationFilter();
  const period = usePeriod();
  const range = periodRange(period, today);
  const [tipo, setTipo] = useQuery<TipoFiltro>('tipo', 'todos');
  const [producto, setProducto] = useQuery<string>('producto', 'todos');
  const [ref, setRef] = useQuery<string>('ref', '');
  const [limit, setLimit] = useState(60);

  const from = atPanama(range.from, 0);
  const to = atPanama(addDays(range.to, 1), 0);
  const types = TIPO_MATCH[tipo];
  const list = data.movements
    .filter((m) => (filter === 'all' || m.locationId === filter) && (ref ? m.refId === ref : m.at >= from && m.at < to))
    .filter((m) => (!types || types.includes(m.type)) && (producto === 'todos' || m.productId === producto))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1));

  return (
    <Panel data-tour="movimientos">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
        <Segmented<TipoFiltro>
          label="Tipo de movimiento"
          value={tipo}
          onChange={(v) => { setTipo(v); setLimit(60); }}
          options={[
            { id: 'todos', label: 'Todos' },
            { id: 'recepcion', label: 'Recepciones' },
            { id: 'venta', label: 'Ventas' },
            { id: 'merma', label: 'Mermas' },
            { id: 'transferencia', label: 'Transferencias' },
            { id: 'conteo', label: 'Conteos' },
          ]}
        />
        <Select value={producto} onChange={(e) => setProducto(e.target.value)} aria-label="Producto" className="w-auto min-w-[200px]">
          <option value="todos">Todos los productos</option>
          {data.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        {ref && (
          <Badge tone="brass">
            Origen: {ref}
            <button type="button" onClick={() => setRef(null)} aria-label="Quitar filtro de origen" className="ml-1 font-semibold">×</button>
          </Badge>
        )}
        <span className="ml-auto text-[12.5px] text-ink-3">{plural(list.length, 'movimiento', 'movimientos')} · {ref ? 'todas las fechas' : range.label}</span>
      </div>
      {list.length === 0 ? (
        <EmptyState icon={<Search className="size-5" />} title="Sin movimientos en esta vista">Amplía el período en la barra superior o quita algún filtro.</EmptyState>
      ) : (
        <>
          <Table minWidth={900}>
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Producto</Th>
                <Th>Movimiento</Th>
                <Th align="right">Variación</Th>
                <Th>Origen de la variación</Th>
                <Th>Registró</Th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, limit).map((m) => {
                const p = data.products.find((x) => x.id === m.productId)!;
                const loc = data.locations.find((l) => l.id === m.locationId)!;
                const Icon = MOVEMENT_ICON[m.type];
                const origin = movementOrigin(data, m);
                const fresh = minutesBetween(m.at, now) < 3;
                return (
                  <Tr key={m.id} className={fresh ? 'animate-flash' : undefined}>
                    <Td className="whitespace-nowrap tabular-nums text-ink-2">{fmtDateTime(m.at)}</Td>
                    <Td>
                      <span className="font-medium text-ink">{p.name}</span>
                      {filter === 'all' && <div className="text-[12px] text-ink-3"><LocationTag id={loc.id} name={loc.name} /></div>}
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <Icon className="size-3.5 text-ink-3" strokeWidth={2} /> {MOVEMENT_LABEL[m.type]}
                      </span>
                    </Td>
                    <Td num className={cn('whitespace-nowrap font-semibold', m.qty >= 0 ? 'text-ok-700' : 'text-ink')}>{fmtQty(m.qty, p.baseUnit, { sign: true })}</Td>
                    <Td className="max-w-[320px] text-ink-2">
                      {origin.to ? <Link to={origin.to} className="hover:text-forest-700 hover:underline">{origin.text}</Link> : origin.text}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{userName(data, m.by)}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          {list.length > limit && (
            <div className="border-t border-line px-5 py-3 text-center">
              <Button variant="ghost" size="sm" onClick={() => setLimit((n) => n + 100)}>Mostrar más ({list.length - limit} restantes)</Button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

// ───────────────────────────── Conteos ─────────────────────────────

function CountsTab({ onNew }: { onNew: () => void }) {
  const data = useDemo((s) => s.data);
  const user = useUser();
  const filter = useLocationFilter();
  const list = data.counts.filter((c) => filter === 'all' || c.locationId === filter).sort((a, b) => (a.at < b.at ? 1 : -1));
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <p className="max-w-[70ch] text-[13.5px] text-ink-2">
          El inventario teórico se desvía con el tiempo. Cada conteo físico lo vuelve a alinear con la realidad y deja el ajuste explicado.
        </p>
        <Button variant="primary" icon={<ClipboardCheck className="size-4" />} onClick={onNew} disabledReason={user.role === 'contabilidad' && 'Contabilidad consulta el inventario en modo lectura.'}>
          Nuevo conteo
        </Button>
      </div>
      <ul className="divide-y divide-line/80">
        {list.map((c) => {
          const loc = data.locations.find((l) => l.id === c.locationId)!;
          const adjusted = c.lines.filter((l) => Math.abs(l.countedBase - l.theoreticalBase) > 1e-6);
          return (
            <li key={c.id}>
              <details className="group">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3.5 transition-colors hover:bg-linen/60">
                  <span className="font-medium tabular-nums text-forest-800">{c.id}</span>
                  <span className="text-[13.5px] text-ink-2">{fmtDateTime(c.at)}</span>
                  <LocationTag id={loc.id} name={loc.name} className="text-[13.5px]" />
                  <Badge tone={c.kind === 'inicial' ? 'brass' : 'neutral'}>{c.kind === 'inicial' ? 'Inventario inicial' : 'Conteo cíclico'}</Badge>
                  <span className="ml-auto text-[13px] text-ink-3">
                    {plural(c.lines.length, 'producto', 'productos')} · {plural(adjusted.length, 'ajuste', 'ajustes')} · {userName(data, c.by)}
                  </span>
                </summary>
                <div className="border-t border-line/70 bg-white/50 px-5 py-3">
                  {c.note && <p className="mb-2 text-[12.5px] italic text-ink-2">«{c.note}»</p>}
                  {adjusted.length === 0 ? (
                    <p className="text-[13px] text-ink-3">Todo coincidió con la existencia teórica.</p>
                  ) : (
                    <ul className="grid gap-x-8 gap-y-1 text-[13px] sm:grid-cols-2">
                      {adjusted.map((l) => {
                        const p = data.products.find((x) => x.id === l.productId)!;
                        return (
                          <li key={l.productId} className="flex justify-between gap-3">
                            <span className="truncate text-ink-2">{p.name}</span>
                            <span className="whitespace-nowrap tabular-nums text-ink">
                              {fmtQty(l.theoreticalBase, p.baseUnit)} → {fmtQty(l.countedBase, p.baseUnit)}
                              <span className="ml-2 font-medium text-warn-800">{fmtQty(l.countedBase - l.theoreticalBase, p.baseUnit, { sign: true })}</span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
