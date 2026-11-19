import { NavLink } from 'react-router';
import { Boxes, CirclePlay, LayoutDashboard, Plug, ReceiptText, ScrollText, ShoppingBasket, Store } from 'lucide-react';
import { BrandLogo } from '@/brand/BrandLogo';
import { cn } from '@/ui/primitives';
import { useDemo, useLocationFilter, useNow, useUser } from '@/store';
import { inLocation, posNeedsAttention, stockRows } from '@/domain/selectors';
import { panamaDay } from '@/domain/time';
import { startTour } from '@/tour/engine';

function useNavCounts() {
  const data = useDemo((s) => s.data);
  const now = useNow();
  const user = useUser();
  const filter = useLocationFilter();
  const scope = user.role === 'gerente' ? filter : 'all';
  const finance = user.role !== 'gerente';
  return {
    compras: user.role === 'direccion' ? data.orders.filter((o) => o.status === 'pendiente_aprobacion').length : 0,
    inventario: user.role !== 'contabilidad' ? stockRows(data, panamaDay(now), scope).filter((r) => r.level === 'critico' || r.level === 'agotado').length : 0,
    ventas: data.posConnections.filter((c) => inLocation(scope, c.locationId) && posNeedsAttention(c, now)).length,
    facturas: finance
      ? data.invoices.filter((i) => i.status === 'por_revisar').length + data.documents.filter((x) => x.status === 'recibido' && !x.invoiceId).length
      : 0,
  };
}

const NAV = [
  { to: '/resumen', label: 'Resumen', icon: LayoutDashboard, key: 'resumen' },
  { to: '/compras', label: 'Compras', icon: ShoppingBasket, key: 'compras' },
  { to: '/inventario', label: 'Inventario', icon: Boxes, key: 'inventario' },
  { to: '/ventas', label: 'Ventas y cajas', icon: Store, key: 'ventas' },
  { to: '/facturas', label: 'Facturas y pagos', icon: ReceiptText, key: 'facturas' },
  { to: '/integraciones', label: 'Integraciones', icon: Plug, key: 'integraciones' },
] as const;

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const counts = useNavCounts() as Record<string, number>;
  const tourActive = useDemo((s) => s.tour.active);
  return (
    <div className="flex h-full flex-col bg-forest-900 text-forest-100">
      <div className="px-6 pb-5 pt-7">
        <NavLink to="/resumen" onClick={onNavigate} aria-label="Saint-Honoré · Ir al resumen" className="block rounded-lg">
          <BrandLogo className="mx-auto h-auto w-[158px] text-brass-400" />
        </NavLink>
      </div>

      <nav aria-label="Navegación principal" className="flex-1 space-y-0.5 overflow-y-auto px-3 pt-2">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            data-tour={`nav-${item.key}`}
            className={({ isActive }) =>
              cn(
                'group relative flex h-10 items-center gap-3 rounded-lg px-3 text-[14px] font-medium transition-colors',
                isActive ? 'bg-white/[0.09] text-paper' : 'text-forest-200 hover:bg-white/[0.05] hover:text-paper',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span aria-hidden className={cn('absolute left-0 top-2 h-6 w-[3px] rounded-r-full bg-brass-400 transition-opacity', isActive ? 'opacity-100' : 'opacity-0')} />
                <item.icon className={cn('size-[18px] shrink-0', isActive ? 'text-brass-400' : 'text-forest-300 group-hover:text-forest-100')} strokeWidth={1.75} />
                <span className="flex-1 truncate">{item.label}</span>
                {counts[item.key] > 0 && (
                  <span className="rounded-full bg-brass-400/20 px-1.5 py-px text-[11.5px] font-semibold tabular-nums text-brass-300" aria-label={`${counts[item.key]} pendientes`}>
                    {counts[item.key]}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-1 border-t border-white/10 px-3 py-4">
        <NavLink
          to="/actividad"
          onClick={onNavigate}
          className={({ isActive }) =>
            cn('flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors', isActive ? 'bg-white/[0.09] text-paper' : 'text-forest-300 hover:bg-white/[0.05] hover:text-paper')
          }
        >
          <ScrollText className="size-4" strokeWidth={1.75} />
          Registro de actividad
        </NavLink>
        <button
          type="button"
          data-tour="tour-start"
          onClick={() => {
            onNavigate?.();
            startTour();
          }}
          className={cn(
            'flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] transition-colors',
            tourActive ? 'bg-brass-400/15 text-brass-300' : 'text-forest-300 hover:bg-white/[0.05] hover:text-paper',
          )}
        >
          <CirclePlay className="size-4" strokeWidth={1.75} />
          {tourActive ? 'Recorrido en curso' : 'Recorrido de demostración'}
        </button>
        <p className="px-3 pt-2 text-[11.5px] leading-snug text-forest-400">
          Modo demostración · datos ficticios.
          <br />
          WhatsApp, cajas y lectura de facturas están simulados.
        </p>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-[236px] shrink-0 lg:block">
      <SidebarContent />
    </aside>
  );
}
