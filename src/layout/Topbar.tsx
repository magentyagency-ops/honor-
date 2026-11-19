import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Dialog } from 'radix-ui';
import {
  Bell, CalendarDays, Globe, ChevronDown, CirclePlay, FlaskConical, Lock, MapPin, Menu as MenuIcon, RotateCcw, ScrollText, Smartphone,
} from 'lucide-react';
import type { LocationFilter, PeriodId } from '@/domain/types';
import { PERIOD_LABEL, alerts as computeAlerts } from '@/domain/selectors';
import { DEMO_PROFILES } from '@/data/catalog';
import { EMBED, resetDemo, setSession, toast, useDemo, useLocationFilter, useNow, usePeriod, useUser } from '@/store';
import { Avatar, IconButton, LocationDot, Tip, cn } from '@/ui/primitives';
import { ConfirmDialog, Menu, MenuItem, MenuLabel, MenuSeparator, Pop } from '@/ui/overlays';
import { BrandMark } from '@/brand/BrandLogo';
import { AttentionRow } from '@/features/resumen/Attention';
import { startTour } from '@/tour/engine';
import { setLang, useLang } from '@/i18n/dom';
import type { Lang } from '@/i18n/engine';

const LANGS: { id: Lang; short: string; label: string }[] = [
  { id: 'es', short: 'ES', label: 'Español' },
  { id: 'fr', short: 'FR', label: 'Français' },
  { id: 'en', short: 'EN', label: 'English' },
];
import { SidebarContent } from './Sidebar';

const PERIODS: PeriodId[] = ['hoy', '7d', '30d', 'mes'];

function FilterButton({ icon, label, value, locked }: { icon: React.ReactNode; label: string; value: React.ReactNode; locked?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex h-9 max-w-full items-center gap-2 rounded-lg border border-line-strong bg-paper pl-2.5 pr-2 text-[13.5px] font-medium text-ink transition-colors',
        !locked && 'hover:bg-linen',
      )}
    >
      <span className="text-ink-3">{icon}</span>
      <span className="sr-only">{label}: </span>
      <span className="truncate">{value}</span>
      {locked ? <Lock className="size-3.5 text-ink-3" /> : <ChevronDown className="size-3.5 text-ink-3" />}
    </span>
  );
}

export function Topbar({ onPhone }: { onPhone: () => void }) {
  const navigate = useNavigate();
  const data = useDemo((s) => s.data);
  const user = useUser();
  const now = useNow();
  const filter = useLocationFilter();
  const period = usePeriod();
  const [navOpen, setNavOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const locked = user.role === 'gerente';
  const locLabel = filter === 'all' ? 'Todos los locales' : data.locations.find((l) => l.id === filter)!.name;
  const list = computeAlerts(data, user, now);

  const locButton = (
    <button type="button" className="min-w-0 rounded-lg" data-tour="filtro-local" aria-label={`Local: ${locLabel}`}>
      <FilterButton icon={filter === 'all' ? <MapPin className="size-4" /> : <LocationDot id={filter} className="mx-1" />} label="Local" value={locLabel} locked={locked} />
    </button>
  );

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ivory/90 backdrop-blur-md">
      <div className="flex h-[60px] items-center gap-2 px-4 sm:gap-2.5 sm:px-6 lg:px-8">
        {/* Navegación en móvil */}
        <Dialog.Root open={navOpen} onOpenChange={setNavOpen}>
          <Dialog.Trigger asChild>
            <button type="button" aria-label="Abrir navegación" className="-ml-1.5 flex size-9 items-center justify-center rounded-lg text-forest-800 hover:bg-linen lg:hidden">
              <MenuIcon className="size-5" />
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-forest-950/40 animate-fade-in lg:hidden" />
            <Dialog.Content aria-describedby={undefined} className="fixed inset-y-0 left-0 z-50 w-[260px] shadow-pop focus:outline-none lg:hidden">
              <Dialog.Title className="sr-only">Navegación</Dialog.Title>
              <SidebarContent onNavigate={() => setNavOpen(false)} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
        <BrandMark className="h-7 w-auto text-brass-600 lg:hidden" />

        {/* Filtros globales: se aplican a todo lo que hay debajo */}
        {locked ? (
          <Tip content="Como gerente, ves únicamente tu local.">{locButton}</Tip>
        ) : (
          <Menu trigger={locButton} align="start" width={230}>
            <MenuLabel>Local</MenuLabel>
            <MenuItem icon={<MapPin className="size-4" />} checked={filter === 'all'} onSelect={() => setSession({ locationFilter: 'all' })}>
              Todos los locales
            </MenuItem>
            {data.locations.map((l) => (
              <MenuItem key={l.id} icon={<LocationDot id={l.id} className="mx-1" />} checked={filter === l.id} onSelect={() => setSession({ locationFilter: l.id as LocationFilter })}>
                {l.name}
              </MenuItem>
            ))}
          </Menu>
        )}

        <Menu
          align="start"
          width={210}
          trigger={
            <button type="button" className="hidden min-w-0 rounded-lg sm:block" data-tour="filtro-periodo" aria-label={`Período: ${PERIOD_LABEL[period]}`}>
              <FilterButton icon={<CalendarDays className="size-4" />} label="Período" value={PERIOD_LABEL[period]} />
            </button>
          }
        >
          <MenuLabel>Período</MenuLabel>
          {PERIODS.map((p) => (
            <MenuItem key={p} checked={period === p} onSelect={() => setSession({ period: p })}>
              {PERIOD_LABEL[p]}
            </MenuItem>
          ))}
        </Menu>

        <div className="flex-1" />

        <Tip content="Datos ficticios. WhatsApp, las cajas y la lectura de facturas están simulados: no se envía ningún mensaje ni se hace ningún pago." side="bottom">
          <span tabIndex={0} className="hidden h-7 items-center gap-1.5 rounded-full bg-brass-50 px-2.5 text-[12px] font-medium text-brass-800 ring-1 ring-inset ring-brass-200 md:inline-flex">
            <FlaskConical className="size-3.5" />
            Modo demostración
          </span>
        </Tip>

        <LangSwitch />

        {!EMBED && (
          <IconButton label="Vista móvil del gerente" onClick={onPhone} className="hidden lg:inline-flex" data-tour="vista-movil">
            <Smartphone className="size-[18px]" strokeWidth={1.75} />
          </IconButton>
        )}

        <Pop
          open={bellOpen}
          onOpenChange={setBellOpen}
          className="w-[380px] max-w-[calc(100vw-1.5rem)]"
          trigger={
            <button type="button" aria-label={`Notificaciones: ${list.length} pendientes`} className="relative flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-linen hover:text-ink">
              <Bell className="size-[18px]" strokeWidth={1.75} />
              {list.length > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-600 px-1 text-[10.5px] font-semibold tabular-nums text-white ring-2 ring-ivory">
                  {list.length}
                </span>
              )}
            </button>
          }
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="serif text-[17px] font-[520] text-forest-900">Notificaciones</p>
            <span className="text-[12.5px] text-ink-3">{list.length === 0 ? 'Todo al día' : `${list.length} requieren acción`}</span>
          </div>
          <div className="max-h-[min(440px,60vh)] overflow-y-auto p-1.5">
            {list.length === 0 && <p className="px-3 py-8 text-center text-[13.5px] text-ink-3">No hay nada pendiente por ahora.</p>}
            {list.map((a) => (
              <AttentionRow key={a.id} alert={a} compact onDone={() => setBellOpen(false)} />
            ))}
          </div>
        </Pop>

        <Menu
          width={280}
          trigger={
            <button type="button" data-tour="perfil" className="flex h-10 items-center gap-2.5 rounded-lg py-1 pl-1 pr-2 hover:bg-linen" aria-label={`Perfil: ${user.name}, ${user.roleLabel}`}>
              <Avatar initials={user.initials} tone={user.role === 'direccion' ? 'brass' : 'forest'} size={32} />
              <span className="hidden min-w-0 text-left md:block">
                <span className="block truncate text-[13.5px] font-medium leading-tight text-ink">{user.name}</span>
                <span className="block truncate text-[12px] leading-tight text-ink-3">{user.roleLabel}</span>
              </span>
              <ChevronDown className="hidden size-3.5 text-ink-3 md:block" />
            </button>
          }
        >
          <MenuLabel>Ver la plataforma como</MenuLabel>
          {DEMO_PROFILES.map((id) => {
            const u = data.users.find((x) => x.id === id)!;
            return (
              <MenuItem
                key={id}
                icon={<Avatar initials={u.initials} tone={u.role === 'direccion' ? 'brass' : 'forest'} size={26} />}
                hint={u.roleLabel}
                checked={user.id === id}
                onSelect={() => {
                  if (user.id === id) return;
                  setSession({ userId: id });
                  toast('info', `Ahora ves la plataforma como ${u.name}`, `${u.roleLabel}. Los permisos de cada perfil son una simulación.`);
                }}
              >
                {u.name}
              </MenuItem>
            );
          })}
          <p className="px-2.5 pb-1 pt-1.5 text-[11.5px] leading-snug text-ink-3">Simulación de permisos para la demostración: no es un inicio de sesión real.</p>
          <MenuSeparator />
          <MenuItem icon={<ScrollText className="size-4" />} onSelect={() => navigate('/actividad')}>
            Registro de actividad
          </MenuItem>
          {!EMBED && (
            <MenuItem icon={<CirclePlay className="size-4" />} onSelect={() => startTour()}>
              Recorrido de demostración
            </MenuItem>
          )}
          <MenuItem icon={<RotateCcw className="size-4" />} onSelect={() => setConfirmReset(true)}>
            Reiniciar demostración
          </MenuItem>
        </Menu>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="¿Reiniciar la demostración?"
        confirmLabel="Reiniciar"
        onConfirm={() => {
          resetDemo();
          navigate('/resumen');
        }}
      >
        Se descartan los cambios hechos (pedidos, recepciones, pagos…) y se restauran los datos iniciales de hoy.
      </ConfirmDialog>
    </header>
  );
}

function LangSwitch() {
  const lang = useLang((s) => s.lang);
  const cur = LANGS.find((l) => l.id === lang)!;
  return (
    <Menu
      width={180}
      trigger={
        <button type="button" data-no-i18n aria-label={`Idioma / Langue / Language: ${cur.label}`} className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold text-ink-2 hover:bg-linen hover:text-ink">
          <Globe className="size-4" strokeWidth={1.75} />
          {cur.short}
        </button>
      }
    >
      <div data-no-i18n>
        {LANGS.map((l) => (
          <MenuItem key={l.id} checked={l.id === lang} hint={l.short} onSelect={() => setLang(l.id)}>
            {l.label}
          </MenuItem>
        ))}
      </div>
    </Menu>
  );
}
