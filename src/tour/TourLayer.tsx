import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, ArrowRight, Check, ChevronUp, CirclePlay, Minus, RotateCcw, Smartphone, X } from 'lucide-react';
import { money, qty as fmtQty } from '@/domain/format';
import { paidCents } from '@/domain/invoices';
import { useDemo } from '@/store';
import { Avatar, Button, Kbd, Tip, cn } from '@/ui/primitives';
import { Modal } from '@/ui/overlays';
import {
  TOTAL_STEPS, cancelStart, confirmStart, describeStep, exitTour, jumpTo, minimizeTour, nextStep, prevStep, restartTour, resumeTour, stepAt, useTourUi,
} from './engine';

// ───────────────────────────── Resaltado del elemento en curso ─────────────────────────────

function Spotlight({ enabled }: { enabled: boolean }) {
  const target = useTourUi((s) => s.target);
  const pressing = useTourUi((s) => s.pressing);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    if (!target || !enabled) {
      setRect(null);
      return;
    }
    let raf = 0;
    let last = '';
    let scrolled = false;
    const tick = () => {
      const el = document.querySelector(target) as HTMLElement | null;
      if (el) {
        const r = el.getBoundingClientRect();
        if (!scrolled && r.width > 0) {
          scrolled = true;
          const dock = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-space')) || 0;
          const limit = window.innerHeight - dock - 12;
          if (r.top < 72 || r.bottom > limit) el.scrollIntoView({ block: r.height > limit * 0.7 ? 'start' : 'center', behavior: 'smooth' });
        }
        const key = `${Math.round(r.left)}|${Math.round(r.top)}|${Math.round(r.width)}|${Math.round(r.height)}`;
        if (key !== last) {
          last = key;
          setRect(r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null);
        }
      } else if (last !== '') {
        last = '';
        setRect(null);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled]);

  if (!rect) return null;
  const pad = 6;
  return (
    <div
      aria-hidden
      key={target}
      className={cn('pointer-events-none fixed z-[95] rounded-xl border-2 border-brass-500 animate-fade-in', pressing ? 'animate-press' : 'animate-halo')}
      style={{ left: rect.x - pad, top: rect.y - pad, width: rect.w + pad * 2, height: rect.h + pad * 2, boxShadow: '0 0 0 4px rgb(192 147 86 / 0.22)' }}
    >
      {pressing && <span className="absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-brass-400/50" />}
    </div>
  );
}

// ───────────────────────────── Fin del recorrido ─────────────────────────────

function Recap() {
  const navigate = useNavigate();
  const data = useDemo((s) => s.data);
  const tour = useDemo((s) => s.tour);
  const order = data.orders.find((o) => o.id === tour.ids.orderId);
  const reception = data.receptions.find((r) => r.id === tour.ids.receptionId);
  const run = data.syncRuns.find((r) => r.id === tour.ids.syncId);
  const invoice = data.invoices.find((i) => i.id === tour.ids.invoiceId);
  const milkLine = reception?.lines.find((l) => l.productId === 'p-leche');
  const chain: { label: string; value: string; to: string }[] = [];
  if (order) chain.push({ label: 'Pedido', value: order.id, to: `/compras/pedidos/${order.id}` });
  if (reception && milkLine) chain.push({ label: 'Recepción parcial', value: `+${fmtQty(milkLine.baseQty, 'ml')} de leche`, to: '/inventario?producto=p-leche&en=sf' });
  if (run) chain.push({ label: 'Caja sincronizada', value: `${run.imported} tickets`, to: `/ventas?sync=${run.id}` });
  if (invoice) {
    const paid = paidCents(data, invoice.id);
    chain.push({ label: 'Factura', value: invoice.number, to: `/facturas/${invoice.id}` });
    chain.push({ label: 'Saldo pendiente', value: money(invoice.totalCents - paid), to: '/facturas/pagos?vista=calendario' });
  }
  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow text-brass-300">Recorrido completado</p>
          <h2 className="serif mt-1 text-[21px] font-[520] leading-tight text-paper">Del aviso de quiebre al saldo pendiente, sin salir de un mismo lugar</h2>
          <p className="mt-1.5 max-w-[70ch] text-[13.5px] leading-snug text-paper/75">
            Un pedido, una recepción, las ventas de la caja, una factura y un pago: cinco hechos que hoy viven en WhatsApp y en hojas de cálculo, enlazados entre sí y trazables.
          </p>
        </div>
        <button type="button" onClick={exitTour} aria-label="Cerrar el recorrido" className="rounded-lg p-1.5 text-paper/60 hover:bg-white/10 hover:text-paper">
          <X className="size-4" />
        </button>
      </div>
      <ol className="mt-3.5 flex flex-wrap items-stretch gap-2">
        {chain.map((c, i) => (
          <li key={c.label} className="flex items-center gap-2">
            <button type="button" onClick={() => navigate(c.to)} className="rounded-xl bg-white/[0.07] px-3 py-2 text-left ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/[0.12]">
              <span className="block text-[11.5px] text-paper/60">{c.label}</span>
              <span className="block text-[13.5px] font-semibold tabular-nums text-paper">{c.value}</span>
            </button>
            {i < chain.length - 1 && <ArrowRight className="size-3.5 text-brass-400" />}
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Button variant="inverse" icon={<RotateCcw className="size-4" />} onClick={restartTour}>Repetir desde el principio</Button>
        <Button variant="brass" onClick={exitTour}>Seguir explorando</Button>
      </div>
    </div>
  );
}

// ───────────────────────────── Panel del recorrido ─────────────────────────────

function Dock({ onPhone }: { onPhone: (path: string) => void }) {
  const tour = useDemo((s) => s.tour);
  const users = useDemo((s) => s.data.users);
  // El texto de cada paso usa cifras en vivo: se recalcula cuando cambian los datos.
  useDemo((s) => s.data);
  const busy = useTourUi((s) => s.busy);
  const ref = useRef<HTMLElement>(null);

  // Reserva espacio para que el panel nunca tape contenido ni acciones.
  useLayoutEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el) {
      root.style.setProperty('--dock-space', '0px');
      return;
    }
    const apply = () => root.style.setProperty('--dock-space', `${Math.ceil(el.getBoundingClientRect().height) + 20}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty('--dock-space', '0px');
    };
  }, [tour.active, tour.minimized, tour.step]);

  // Flechas del teclado, salvo mientras se escribe en un campo.
  useEffect(() => {
    if (!tour.active || tour.minimized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        void nextStep();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        void prevStep();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tour.active, tour.minimized]);

  if (!tour.active) return null;

  if (tour.minimized) {
    return (
      <div data-keep-open className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex justify-center pb-4">
        <section ref={ref} style={{ pointerEvents: 'auto' }} className="flex items-center gap-3 rounded-full bg-forest-950 py-2 pl-4 pr-2 text-paper shadow-pop ring-1 ring-white/10">
          <CirclePlay className="size-4 text-brass-400" />
          <span className="text-[13px]">
            Recorrido · {tour.step >= TOTAL_STEPS ? 'completado' : `paso ${tour.step + 1} de ${TOTAL_STEPS}`}
          </span>
          <Button size="sm" variant="brass" onClick={() => minimizeTour(false)} icon={<ChevronUp className="size-3.5" />}>Continuar</Button>
          <button type="button" onClick={exitTour} aria-label="Salir del recorrido" className="rounded-full p-1.5 text-paper/60 hover:bg-white/10 hover:text-paper">
            <X className="size-4" />
          </button>
        </section>
      </div>
    );
  }

  const finished = tour.step >= TOTAL_STEPS;
  const info = finished ? null : describeStep(tour.step);
  const actor = info ? users.find((u) => u.id === info.step.actor) : undefined;
  const needsAction = Boolean(info?.step.action && !info.done);
  const showPhone = info?.step.id === 'recepcion' && needsAction && tour.ids.orderId;

  return (
    <div data-keep-open className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex justify-center px-2 pb-2 sm:px-4 sm:pb-4">
      <section
        ref={ref}
        style={{ pointerEvents: 'auto' }}
        role="region"
        aria-label="Recorrido de demostración"
        data-tour-dock
        className="w-full max-w-[940px] overflow-hidden rounded-2xl bg-forest-950 text-paper shadow-pop ring-1 ring-white/10"
      >
        {/* Progreso: cada tramo es un paso y permite saltar a él */}
        <div className="flex gap-1 px-4 pt-3" role="list" aria-label="Pasos del recorrido">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => {
            const s = stepAt(i)!;
            return (
              <Tip key={s.id} content={`${i + 1}. ${s.title}`}>
                <button
                  type="button"
                  role="listitem"
                  disabled={busy}
                  aria-label={`Ir al paso ${i + 1}: ${s.title}`}
                  aria-current={i === tour.step ? 'step' : undefined}
                  onClick={() => void jumpTo(i)}
                  className="group flex h-4 flex-1 items-center"
                >
                  <span className={cn('h-1.5 w-full rounded-full transition-colors', i < tour.step || finished ? 'bg-brass-500' : i === tour.step ? 'bg-brass-300' : 'bg-white/15 group-hover:bg-white/30')} />
                </button>
              </Tip>
            );
          })}
        </div>

        {finished || !info ? (
          <Recap />
        ) : (
          <div className="flex flex-col gap-3 px-4 pb-3.5 pt-2 sm:flex-row sm:items-end sm:gap-5 sm:px-5">
            <div className="min-w-0 flex-1" aria-live="polite">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="eyebrow text-brass-300">Paso {tour.step + 1} de {TOTAL_STEPS}</span>
                {actor && (
                  <span key={actor.id} className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] py-0.5 pl-0.5 pr-2.5 text-[12px] text-paper/85 ring-1 ring-inset ring-white/10 animate-fade-in">
                    <Avatar initials={actor.initials} size={20} tone={actor.role === 'direccion' ? 'brass' : 'paper'} />
                    {actor.first} · {actor.roleLabel}
                  </span>
                )}
                {info.step.action && info.done && (
                  <span className="inline-flex items-center gap-1 text-[12px] font-medium text-brass-300">
                    <Check className="size-3.5" strokeWidth={3} /> Hecho
                  </span>
                )}
              </div>
              <h2 className="serif mt-1.5 text-[20px] font-[520] leading-tight text-paper">{info.step.title}</h2>
              <p className="mt-1 text-[13.5px] leading-[1.45] text-paper/80">{info.text}</p>
            </div>

            <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
              <div className="hidden items-center justify-end gap-1 sm:flex">
                <span className="mr-1 flex items-center gap-1 text-[11.5px] text-paper/45">
                  <Kbd>←</Kbd>
                  <Kbd>→</Kbd>
                </span>
                <Tip content="Minimizar el recorrido">
                  <button type="button" onClick={() => minimizeTour(true)} aria-label="Minimizar el recorrido" className="rounded-lg p-1.5 text-paper/60 hover:bg-white/10 hover:text-paper">
                    <Minus className="size-4" />
                  </button>
                </Tip>
                <Tip content="Salir del recorrido">
                  <button type="button" onClick={exitTour} aria-label="Salir del recorrido" className="rounded-lg p-1.5 text-paper/60 hover:bg-white/10 hover:text-paper">
                    <X className="size-4" />
                  </button>
                </Tip>
              </div>
              <div className="flex items-center gap-2">
                {showPhone && (
                  <Button variant="inverse" icon={<Smartphone className="size-4" />} onClick={() => onPhone(window.location.pathname + window.location.search)} className="hidden lg:inline-flex">
                    Verlo en su móvil
                  </Button>
                )}
                <Button variant="inverse" onClick={() => void prevStep()} disabled={tour.step === 0 || busy} aria-label="Paso anterior" icon={<ArrowLeft className="size-4" />}>
                  <span className="sm:hidden lg:inline">Anterior</span>
                </Button>
                <Button
                  variant="brass"
                  size="lg"
                  loading={busy}
                  onClick={() => void nextStep()}
                  iconRight={!busy ? <ArrowRight className="size-[18px]" /> : undefined}
                  className="min-w-[168px] flex-1 font-semibold sm:flex-none"
                  data-tour-next
                >
                  {busy ? 'En curso…' : needsAction ? info.step.action!.label : tour.step === TOTAL_STEPS - 1 ? 'Terminar' : 'Siguiente'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ───────────────────────────── Capa completa ─────────────────────────────

export function TourLayer({ onPhone }: { onPhone: (path: string) => void }) {
  const active = useDemo((s) => s.tour.active);
  const minimized = useDemo((s) => s.tour.minimized);
  const askReset = useTourUi((s) => s.askReset);

  // Si se recarga la página a mitad del recorrido, se vuelve a situar la interfaz.
  useEffect(() => {
    const t = setTimeout(resumeTour, 150);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <Spotlight enabled={active && !minimized} />
      <Dock onPhone={onPhone} />
      <Modal
        open={askReset}
        onOpenChange={(o) => !o && cancelStart()}
        size="sm"
        title="Empezar el recorrido de demostración"
        description="El recorrido parte de los datos iniciales (la leche a punto de agotarse en San Francisco). Como ya has hecho cambios, hay que reiniciar la demostración antes de empezar."
        footer={
          <>
            <Button variant="ghost" onClick={cancelStart}>Ahora no</Button>
            <Button variant="primary" icon={<RotateCcw className="size-4" />} onClick={() => confirmStart(true)}>Reiniciar y empezar</Button>
          </>
        }
      />
    </>
  );
}
