import { useState } from 'react';
import { Link } from 'react-router';
import { Banknote, ClipboardList, FileText, PackageCheck, ReceiptText, Search, Send, ShieldCheck, Store } from 'lucide-react';
import type { AuditEntity, AuditEvent, DemoData } from '@/domain/types';
import { userName } from '@/domain/core';
import { plural } from '@/domain/format';
import { fmtDayLong, fmtTime, panamaDay } from '@/domain/time';
import { useDemo, useLocationFilter } from '@/store';
import { Avatar, Button, EmptyState, Input, LocationTag, PageHeader, Panel, Segmented, Select } from '@/ui/primitives';

type Grupo = 'todo' | 'compras' | 'inventario' | 'cajas' | 'facturas' | 'config';
const GROUP: Record<Grupo, AuditEntity[] | null> = {
  todo: null,
  compras: ['pedido', 'recepcion'],
  inventario: ['inventario', 'receta'],
  cajas: ['caja'],
  facturas: ['factura', 'documento', 'pago'],
  config: ['configuracion'],
};

const ICON: Record<AuditEntity, typeof Send> = {
  pedido: Send, recepcion: PackageCheck, factura: FileText, pago: Banknote, inventario: ClipboardList, caja: Store, receta: ClipboardList,
  documento: ReceiptText, configuracion: ShieldCheck,
};

function linkFor(d: DemoData, e: AuditEvent): string | undefined {
  if (!e.entityId) return undefined;
  switch (e.entity) {
    case 'pedido': return `/compras/pedidos/${e.entityId}`;
    case 'recepcion': {
      const r = d.receptions.find((x) => x.id === e.entityId);
      return r ? `/compras/pedidos/${r.orderId}` : undefined;
    }
    case 'factura': return d.invoices.some((i) => i.id === e.entityId) ? `/facturas/${e.entityId}` : undefined;
    case 'documento': return d.documents.some((x) => x.id === e.entityId) ? `/facturas/${e.entityId}` : undefined;
    case 'pago': {
      const p = d.payments.find((x) => x.id === e.entityId);
      return p ? `/facturas/${p.invoiceId}` : d.invoices.some((i) => i.id === e.entityId) ? `/facturas/${e.entityId}` : undefined;
    }
    case 'caja': return e.entityId.startsWith('SYN') ? `/ventas?vista=sincronizaciones&sync=${e.entityId}` : '/ventas?vista=correspondencias';
    case 'inventario': return e.entityId.startsWith('CON') ? '/inventario?vista=conteos' : '/inventario?vista=movimientos';
    case 'receta': return '/inventario?vista=recetas';
    default: return undefined;
  }
}

export function ActividadPage() {
  const data = useDemo((s) => s.data);
  const filter = useLocationFilter();
  const [grupo, setGrupo] = useState<Grupo>('todo');
  const [autor, setAutor] = useState('todos');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(80);

  const needle = q.trim().toLowerCase();
  const list = data.audit
    .filter((e) => filter === 'all' || !e.locationId || e.locationId === filter)
    .filter((e) => !GROUP[grupo] || GROUP[grupo]!.includes(e.entity))
    .filter((e) => autor === 'todos' || e.by === autor)
    .filter((e) => !needle || e.summary.toLowerCase().includes(needle))
    .slice()
    .reverse();
  const authors = [...new Set(data.audit.map((e) => e.by))];
  const days = new Map<string, AuditEvent[]>();
  for (const e of list.slice(0, limit)) {
    const day = panamaDay(e.at);
    days.set(day, [...(days.get(day) ?? []), e]);
  }

  return (
    <div>
      <PageHeader
        title="Registro de actividad"
        subtitle="Quién hizo qué, cuándo y sobre qué documento. Las correcciones nunca sobrescriben en silencio: dejan rastro."
      />
      <Panel>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
          <Segmented<Grupo>
            label="Tipo de actividad"
            value={grupo}
            onChange={(v) => { setGrupo(v); setLimit(80); }}
            options={[
              { id: 'todo', label: 'Todo' },
              { id: 'compras', label: 'Compras' },
              { id: 'inventario', label: 'Inventario' },
              { id: 'cajas', label: 'Cajas' },
              { id: 'facturas', label: 'Facturas y pagos' },
              { id: 'config', label: 'Configuración' },
            ]}
          />
          <Select value={autor} onChange={(e) => setAutor(e.target.value)} aria-label="Autor" className="w-auto min-w-[180px]">
            <option value="todos">Todas las personas</option>
            {authors.map((a) => <option key={a} value={a}>{userName(data, a)}</option>)}
          </Select>
          <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-[280px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en el registro…" aria-label="Buscar en el registro" className="pl-9" />
          </div>
        </div>
        {list.length === 0 ? (
          <EmptyState icon={<Search className="size-5" />} title="Sin actividad en esta vista">Cambia los filtros o la búsqueda.</EmptyState>
        ) : (
          <>
            {[...days.entries()].map(([day, events]) => (
              <section key={day}>
                <h2 className="eyebrow sticky top-[60px] z-10 border-b border-line bg-linen/95 px-5 py-2 text-ink-2 backdrop-blur">{fmtDayLong(day)} · {plural(events.length, 'evento', 'eventos')}</h2>
                <ul className="divide-y divide-line/70">
                  {events.map((e) => {
                    const Icon = ICON[e.entity];
                    const to = linkFor(data, e);
                    const u = data.users.find((x) => x.id === e.by);
                    const loc = e.locationId ? data.locations.find((l) => l.id === e.locationId) : undefined;
                    return (
                      <li key={e.id} className="flex items-start gap-3.5 px-5 py-3">
                        <span className="mt-0.5 w-[68px] shrink-0 text-[12.5px] tabular-nums text-ink-3">{fmtTime(e.at)}</span>
                        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-linen text-ink-2 ring-1 ring-inset ring-line">
                          <Icon className="size-3.5" strokeWidth={1.9} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13.5px] leading-snug text-ink">
                            {to ? <Link to={to} className="hover:text-forest-700 hover:underline">{e.summary}</Link> : e.summary}
                          </p>
                          <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-ink-3">
                            <span className="inline-flex items-center gap-1.5">
                              {u && <Avatar initials={u.initials} size={18} tone={u.role === 'direccion' ? 'brass' : 'forest'} />}
                              {userName(data, e.by)}
                            </span>
                            {loc && <LocationTag id={loc.id} name={loc.name} />}
                            <span className="tabular-nums">{e.id}</span>
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {list.length > limit && (
              <div className="border-t border-line px-5 py-3 text-center">
                <Button variant="ghost" size="sm" onClick={() => setLimit((n) => n + 100)}>Mostrar más ({list.length - limit} restantes)</Button>
              </div>
            )}
          </>
        )}
        <p className="border-t border-line px-5 py-3 text-[12.5px] text-ink-3">
          La demostración conserva el detalle de los últimos días. Además, cada pedido, recepción, factura y pago guarda su propia trazabilidad.
        </p>
      </Panel>
    </div>
  );
}
