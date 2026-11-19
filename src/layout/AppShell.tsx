import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Tooltip } from 'radix-ui';
import type { LocationFilter } from '@/domain/types';
import { EMBED, autoSyncTick, setSession } from '@/store';
import { Toaster } from '@/ui/overlays';
import { registerNavigator } from '@/tour/engine';
import { TourLayer } from '@/tour/TourLayer';
import { PhonePreview } from './PhonePreview';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const [phone, setPhone] = useState<string | null>(null);

  useEffect(() => {
    registerNavigator((to) => navigate(to));
  }, [navigate]);

  // Un enlace con ?local=sf aplica el filtro global de local.
  useEffect(() => {
    const local = params.get('local');
    if (!local) return;
    if (['all', 'cv', 'sf', 'ce'].includes(local)) setSession({ locationFilter: local as LocationFilter });
    const next = new URLSearchParams(params);
    next.delete('local');
    setParams(next, { replace: true });
  }, [params, setParams]);

  // Las cajas conectadas se sincronizan solas.
  useEffect(() => {
    autoSyncTick();
    const t = setInterval(autoSyncTick, 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  // Dentro del marco de teléfono, Escape cierra la vista móvil (si no hay un panel abierto que cerrar antes).
  useEffect(() => {
    if (!EMBED) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) window.parent.postMessage({ type: 'sh-demo:cerrar-movil' }, window.location.origin);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Tooltip.Provider delayDuration={250} skipDelayDuration={200}>
      <div className="flex min-h-dvh">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onPhone={() => setPhone(window.location.pathname + window.location.search)} />
          <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 pt-6 sm:px-6 lg:px-8" style={{ paddingBottom: 'calc(var(--dock-space) + 56px)' }}>
            <Outlet />
          </main>
        </div>
      </div>
      {!EMBED && <TourLayer onPhone={(path) => setPhone(path)} />}
      {!EMBED && <PhonePreview path={phone} onClose={() => setPhone(null)} />}
      <Toaster />
    </Tooltip.Provider>
  );
}
