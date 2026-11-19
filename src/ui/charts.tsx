import { useState, type ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Table2 } from 'lucide-react';
import type { BaseUnit, Cents, DayStr, LocationId } from '@/domain/types';
import { fmtDate, fmtDayShort, fmtDayWeek } from '@/domain/time';
import { displayUnit, money, money0, moneyCompact, qty as fmtQty, toDisplay } from '@/domain/format';
import type { SalesPoint } from '@/domain/selectors';
import { LOCATION_COLOR, cn } from './primitives';

/**
 * Gráficos sobrios: marcas finas, rejilla de una línea, leyenda siempre presente cuando hay varias
 * series, tooltip que lista todas las series y una vista de tabla como alternativa accesible.
 * El color identifica al local (fijo) y nunca es el único medio para leer un valor.
 */

const GRID = '#e9e1d0';
const AXIS = '#6d726d';
const SURFACE = '#fcfaf5';

const tick = { fill: AXIS, fontSize: 11.5 };

/** Ejes: importes completos por debajo de $10,000; compactos a partir de ahí (un solo estilo por eje). */
const axisMoney = (max: number) => (v: number) => (max < 1_000_000 ? money0(v) : moneyCompact(v));

export function ChartFrame({ title, hint, legend, table, children, className }: {
  title: ReactNode; hint?: ReactNode; legend?: ReactNode; table: ReactNode; children: ReactNode; className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className={cn('m-0', className)}>
      <figcaption className="mb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="serif text-[18px] font-[520] leading-tight text-forest-900">{title}</h3>
            {hint && <p className="mt-0.5 text-[12.5px] text-ink-3">{hint}</p>}
          </div>
          <button
            type="button"
            onClick={() => setAsTable((v) => !v)}
            aria-pressed={asTable}
            className={cn('inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors', asTable ? 'bg-forest-50 text-forest-700' : 'text-ink-3 hover:bg-linen hover:text-ink')}
          >
            <Table2 className="size-3.5" />
            {asTable ? 'Ver gráfico' : 'Ver tabla'}
          </button>
        </div>
        {legend && <div className="mt-2.5">{legend}</div>}
      </figcaption>
      {asTable ? <div className="max-h-[280px] overflow-auto rounded-lg border border-line">{table}</div> : children}
    </figure>
  );
}

export function LegendDot({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] text-ink-2">
      <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: color }} />
      {children}
    </span>
  );
}

function TipBox({ title, rows, footer }: { title: string; rows: { color: string; label: string; value: string }[]; footer?: { label: string; value: string } }) {
  return (
    <div className="rounded-lg border border-line bg-paper px-3 py-2.5 text-[12.5px] shadow-pop">
      <p className="mb-1.5 font-medium text-ink">{title}</p>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-5">
            <span className="flex items-center gap-1.5 text-ink-2">
              <span aria-hidden className="h-[3px] w-3 rounded-full" style={{ background: r.color }} />
              {r.label}
            </span>
            <span className="font-semibold tabular-nums text-ink">{r.value}</span>
          </div>
        ))}
      </div>
      {footer && (
        <div className="mt-1.5 flex items-center justify-between gap-5 border-t border-line pt-1.5">
          <span className="text-ink-2">{footer.label}</span>
          <span className="font-semibold tabular-nums text-ink">{footer.value}</span>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Ventas diarias por local ─────────────────────────────

export function SalesChart({ data, locations, height = 250 }: {
  data: SalesPoint[];
  locations: { id: LocationId; name: string }[];
  height?: number;
}) {
  const multi = locations.length > 1;
  const top = locations[locations.length - 1]?.id;
  const rows = data.map((p) => ({ ...p, label: fmtDayShort(p.day) }));
  const total = (p: SalesPoint) => locations.reduce((t, l) => t + p[l.id], 0);
  return (
    <ChartFrame
      title="Ventas diarias"
      hint={multi ? 'Ingresos por día, apilados por local' : `Ingresos por día · ${locations[0]?.name ?? ''}`}
      legend={multi ? <div className="flex flex-wrap gap-x-3.5 gap-y-1">{locations.map((l) => <LegendDot key={l.id} color={LOCATION_COLOR[l.id]}>{l.name}</LegendDot>)}</div> : undefined}
      table={
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-ink-3">
              <th className="sticky top-0 bg-paper px-3 py-2 font-medium">Día</th>
              {locations.map((l) => <th key={l.id} className="sticky top-0 bg-paper px-3 py-2 text-right font-medium">{l.name}</th>)}
              {multi && <th className="sticky top-0 bg-paper px-3 py-2 text-right font-medium">Total</th>}
            </tr>
          </thead>
          <tbody>
            {[...data].reverse().map((p) => (
              <tr key={p.day} className="border-t border-line/70">
                <td className="px-3 py-1.5">{fmtDayWeek(p.day)}</td>
                {locations.map((l) => <td key={l.id} className="px-3 py-1.5 text-right tabular-nums">{money(p[l.id])}</td>)}
                {multi && <td className="px-3 py-1.5 text-right font-medium tabular-nums">{money(total(p))}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div style={{ height }} role="img" aria-label="Gráfico de ventas diarias por local. Usa «Ver tabla» para consultar los valores.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={28} tickMargin={8} />
            <YAxis tick={tick} tickLine={false} axisLine={false} width={48} tickFormatter={axisMoney(Math.max(0, ...data.map(total)))} tickCount={5} />
            <Tooltip
              cursor={{ fill: 'rgb(33 72 56 / 0.06)' }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as SalesPoint | undefined) : undefined;
                if (!p) return null;
                return (
                  <TipBox
                    title={fmtDayWeek(p.day)}
                    rows={[...locations].reverse().map((l) => ({ color: LOCATION_COLOR[l.id], label: l.name, value: money(p[l.id]) }))}
                    footer={multi ? { label: 'Total', value: money(total(p)) } : undefined}
                  />
                );
              }}
            />
            {locations.map((l) => (
              <Bar
                key={l.id}
                dataKey={l.id}
                stackId="ventas"
                fill={LOCATION_COLOR[l.id]}
                stroke={SURFACE}
                strokeWidth={multi ? 1.5 : 0}
                maxBarSize={22}
                radius={l.id === top ? [4, 4, 0, 0] : 0}
                animationDuration={350}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}

// ───────────────────────────── Evolución de la existencia de un producto ─────────────────────────────

export function StockChart({ data, baseUnit, minBase, height = 190 }: { data: { day: DayStr; qty: number }[]; baseUnit: BaseUnit; minBase: number; height?: number }) {
  const unit = displayUnit(baseUnit);
  const rows = data.map((p) => ({ day: p.day, label: fmtDayShort(p.day), v: toDisplay(p.qty, baseUnit) }));
  const min = toDisplay(minBase, baseUnit);
  return (
    <ChartFrame
      title="Existencia al cierre de cada día"
      hint={`Últimos 30 días · en ${unit} · la línea marca el mínimo`}
      table={
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-ink-3">
              <th className="sticky top-0 bg-paper px-3 py-2 font-medium">Día</th>
              <th className="sticky top-0 bg-paper px-3 py-2 text-right font-medium">Existencia</th>
            </tr>
          </thead>
          <tbody>
            {[...data].reverse().map((p) => (
              <tr key={p.day} className="border-t border-line/70">
                <td className="px-3 py-1.5">{fmtDate(p.day)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(p.qty, baseUnit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div style={{ height }} role="img" aria-label="Evolución de la existencia en los últimos 30 días. Usa «Ver tabla» para consultar los valores.">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={32} tickMargin={8} />
            <YAxis tick={tick} tickLine={false} axisLine={false} width={40} tickCount={4} domain={[0, 'auto']} />
            <Tooltip
              cursor={{ stroke: '#9a9e97', strokeWidth: 1 }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as { day: DayStr; v: number } | undefined) : undefined;
                if (!p) return null;
                return <TipBox title={fmtDayWeek(p.day)} rows={[{ color: '#214838', label: 'Existencia', value: `${p.v.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit}` }]} />;
              }}
            />
            {min > 0 && (
              <ReferenceLine
                y={min}
                stroke="#a93a25"
                strokeWidth={1}
                label={{ value: `Mínimo ${min.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit}`, position: 'insideBottomLeft', fill: '#8a2e1d', fontSize: 11 }}
              />
            )}
            <Area type="linear" dataKey="v" stroke="#214838" strokeWidth={2} fill="#214838" fillOpacity={0.1} dot={false} activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2, fill: '#214838' }} animationDuration={350} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}

// ───────────────────────────── Vencimientos por día ─────────────────────────────

export interface DuePoint {
  day: DayStr;
  cents: Cents;
  count: number;
}

export function DueChart({ data, today, height = 180 }: { data: DuePoint[]; today: DayStr; height?: number }) {
  const rows = data.map((p) => ({ ...p, label: fmtDayShort(p.day) }));
  return (
    <div style={{ height }} role="img" aria-label="Importe que vence cada día en las próximas semanas. La lista inferior contiene los mismos datos.">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: 0 }} barCategoryGap="24%">
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={30} tickMargin={8} />
          <YAxis tick={tick} tickLine={false} axisLine={false} width={48} tickFormatter={axisMoney(Math.max(0, ...data.map((p) => p.cents)))} tickCount={4} />
          <Tooltip
            cursor={{ fill: 'rgb(33 72 56 / 0.06)' }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as DuePoint | undefined) : undefined;
              if (!p) return null;
              return (
                <TipBox
                  title={`${fmtDayWeek(p.day)}${p.day === today ? ' · hoy' : ''}`}
                  rows={[{ color: '#214838', label: p.count === 1 ? '1 factura' : `${p.count} facturas`, value: money(p.cents) }]}
                />
              );
            }}
          />
          <Bar dataKey="cents" fill="#2b5b48" maxBarSize={20} radius={[4, 4, 0, 0]} animationDuration={350} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ───────────────────────────── Barras ordenadas (HTML) ─────────────────────────────

/** Comparación de magnitudes en una sola escala: un color, valor al final de cada barra. */
export function RankedBars({ rows, format = money0, color = '#2b5b48' }: {
  rows: { key: string; label: ReactNode; value: number; sub?: ReactNode }[];
  format?: (v: number) => string;
  color?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,10.5rem)_1fr_auto] items-center gap-3 text-[13px]">
          <span className="truncate text-ink">{r.label}</span>
          <span className="relative h-2 rounded-full bg-linen" aria-hidden>
            <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%`, background: color }} />
          </span>
          <span className="min-w-[4.5rem] text-right font-medium tabular-nums text-ink">
            {format(r.value)}
            {r.sub && <span className="ml-1.5 font-normal text-ink-3">{r.sub}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
