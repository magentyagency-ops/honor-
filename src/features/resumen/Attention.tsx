import { useNavigate } from 'react-router';
import {
  AlarmClock, ArrowRight, CalendarClock, FileWarning, Hourglass, Inbox, PackageOpen, TrendingDown, Unlink, WifiOff,
} from 'lucide-react';
import type { Alert, AlertKind } from '@/domain/selectors';
import { Button, cn } from '@/ui/primitives';

const ICON: Record<AlertKind, typeof Inbox> = {
  stock: TrendingDown,
  aprobacion: Hourglass,
  factura: FileWarning,
  recepcion_parcial: PackageOpen,
  caja: WifiOff,
  pagos_vencidos: AlarmClock,
  pagos_semana: CalendarClock,
  sin_receta: Unlink,
  documento: Inbox,
};

const CHIP = {
  alta: 'bg-danger-50 text-danger-700 ring-danger-100',
  media: 'bg-warn-50 text-warn-700 ring-warn-100',
  info: 'bg-forest-50 text-forest-700 ring-forest-100',
} as const;

const SEVERITY_TEXT = { alta: 'Prioridad alta', media: 'Prioridad media', info: 'Informativo' } as const;

/** Fila de «lo que requiere tu atención»: qué pasa, dónde, y un botón que lleva a resolverlo. */
export function AttentionRow({ alert, compact, emphasize, onDone }: { alert: Alert; compact?: boolean; emphasize?: boolean; onDone?: () => void }) {
  const navigate = useNavigate();
  const Icon = ICON[alert.kind];
  const open = () => {
    navigate(alert.to);
    onDone?.();
  };
  if (compact) {
    return (
      <button type="button" onClick={open} className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-linen">
        <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset', CHIP[alert.severity])}>
          <Icon className="size-3.5" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="sr-only">{SEVERITY_TEXT[alert.severity]}. </span>
          <span className="block text-[13.5px] font-medium leading-snug text-ink">{alert.title}</span>
          <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-ink-3">{alert.detail}</span>
          <span className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-medium text-forest-700">
            {alert.cta} <ArrowRight className="size-3" />
          </span>
        </span>
      </button>
    );
  }
  return (
    <li data-tour={alert.tourKey} className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-5 py-3.5 sm:flex-nowrap">
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full ring-1 ring-inset', CHIP[alert.severity])}>
        <Icon className="size-[17px]" strokeWidth={1.9} />
      </span>
      <div className="min-w-0 flex-1 basis-[60%]">
        <p className="text-[14.5px] font-medium leading-snug text-ink">
          <span className="sr-only">{SEVERITY_TEXT[alert.severity]}. </span>
          {alert.title}
          {alert.severity === 'alta' && <span className="eyebrow ml-2 align-middle text-danger-700">Urgente</span>}
        </p>
        <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{alert.detail}</p>
      </div>
      <Button
        size="sm"
        variant={emphasize ? 'primary' : 'secondary'}
        onClick={open}
        iconRight={<ArrowRight className="size-3.5" />}
        className="ml-[52px] sm:ml-0"
        data-tour={alert.tourKey ? `${alert.tourKey}-cta` : undefined}
      >
        {alert.cta}
      </Button>
    </li>
  );
}
