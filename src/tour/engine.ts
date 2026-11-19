import { create } from 'zustand';
import { DomainError } from '@/domain/types';
import { resetDemo, setSession, setTour, toast, useDemo } from '@/store';
import { STEPS, type StepCtx, type StepView, type TourStep } from './steps';

/**
 * Motor del recorrido de demostración.
 *
 * Cada paso sabe tres cosas: dónde hay que mirar (vista + elemento resaltado), qué acción ejecutar
 * y cómo saber si ya está hecha. «Siguiente» ejecuta la acción pendiente o avanza. Las acciones
 * actúan sobre el mismo estado que la interfaz: no hay pantallas de mentira ni datos paralelos.
 * Si quien presenta hace la acción a mano, el recorrido lo detecta y continúa desde ahí.
 */

interface TourUi {
  /** Selector del elemento resaltado. */
  target: string | null;
  /** Se está «pulsando» el elemento resaltado. */
  pressing: boolean;
  busy: boolean;
  /** Hay que confirmar el reinicio antes de empezar. */
  askReset: boolean;
}

export const useTourUi = create<TourUi>(() => ({ target: null, pressing: false, busy: false, askReset: false }));

let navigateFn: (to: string) => void = () => {};
export function registerNavigator(fn: (to: string) => void) {
  navigateFn = fn;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitFor(selector: string, timeout = 1600): Promise<Element | null> {
  const start = Date.now();
  for (;;) {
    const el = document.querySelector(selector);
    if (el) return el;
    if (Date.now() - start > timeout) return null;
    await wait(60);
  }
}

function makeCtx(instant: boolean): StepCtx {
  return {
    d: () => useDemo.getState().data,
    tour: () => useDemo.getState().tour,
    nav: (to) => navigateFn(to),
    setIds: (patch) => setTour((t) => ({ ids: { ...t.ids, ...patch } })),
    setFacts: (patch) => setTour((t) => ({ facts: { ...t.facts, ...patch } })),
    instant,
    pause: (ms) => (instant ? Promise.resolve() : wait(ms)),
    press: async (selector) => {
      if (instant) return;
      useTourUi.setState({ target: selector, pressing: false });
      const el = await waitFor(selector);
      if (!el) return;
      await wait(420);
      useTourUi.setState({ pressing: true });
      await wait(480);
      useTourUi.setState({ pressing: false });
    },
  };
}

export const TOTAL_STEPS = STEPS.length;

export function stepAt(index: number): TourStep | undefined {
  return STEPS[index];
}

/** Estado del paso actual, calculado en vivo: sirve tanto al panel como al motor. */
export function describeStep(index: number): { step: TourStep; done: boolean; view: StepView; text: string } | null {
  const step = STEPS[index];
  if (!step) return null;
  const c = makeCtx(true);
  const done = step.action ? safe(() => step.action!.done(c), false) : false;
  const view = done && step.after ? step.after : step.before;
  return { step, done, view, text: safe(() => view.text(c), '') };
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

async function show(index: number) {
  const info = describeStep(index);
  if (!info) {
    useTourUi.setState({ target: null, pressing: false });
    return;
  }
  const c = makeCtx(false);
  if (useDemo.getState().session.userId !== info.step.actor) setSession({ userId: info.step.actor });
  safe(() => info.view.view(c), undefined);
  useTourUi.setState({ target: safe(() => info.view.target(c), null), pressing: false });
}

function fail(err: unknown) {
  if (err instanceof DomainError) {
    toast('error', 'El recorrido no pudo continuar', `${err.message} Reinicia la demostración para repetirlo desde el principio.`);
  } else {
    console.error(err);
    toast('error', 'El recorrido encontró un problema', 'Reinicia la demostración para repetirlo desde el principio.');
  }
}

/** Botón principal del panel: ejecuta la acción pendiente del paso o pasa al siguiente. */
export async function nextStep() {
  if (useTourUi.getState().busy) return;
  const { tour } = useDemo.getState();
  if (!tour.active) return;
  const step = STEPS[tour.step];
  if (!step) return;
  const c = makeCtx(false);
  if (step.action && !safe(() => step.action!.done(c), false)) {
    useTourUi.setState({ busy: true });
    try {
      if (useDemo.getState().session.userId !== step.actor) setSession({ userId: step.actor });
      await step.action.run(c);
    } catch (err) {
      fail(err);
    } finally {
      useTourUi.setState({ busy: false, pressing: false });
    }
    await wait(120);
    await show(tour.step);
    return;
  }
  const next = tour.step + 1;
  setTour({ step: next, minimized: false });
  if (next >= STEPS.length) {
    setSession({ userId: 'u-antoine' });
    useTourUi.setState({ target: null });
    return;
  }
  await show(next);
}

export async function prevStep() {
  if (useTourUi.getState().busy) return;
  const { tour } = useDemo.getState();
  if (!tour.active || tour.step <= 0) return;
  const prev = Math.min(tour.step, STEPS.length) - 1;
  setTour({ step: prev });
  await show(prev);
}

/** Salta a un paso: ejecuta en silencio las acciones anteriores que falten. */
export async function jumpTo(index: number) {
  if (useTourUi.getState().busy) return;
  const { tour } = useDemo.getState();
  if (!tour.active || index < 0 || index >= STEPS.length) return;
  useTourUi.setState({ busy: true });
  try {
    const c = makeCtx(true);
    for (let i = 0; i < index; i++) {
      const s = STEPS[i];
      if (!s.action || safe(() => s.action!.done(c), false)) continue;
      if (useDemo.getState().session.userId !== s.actor) setSession({ userId: s.actor });
      if (s.id === 'factura') s.before.view(c); // la factura tiene que «llegar» antes de procesarla
      await s.action.run(c);
    }
    setTour({ step: index, minimized: false });
  } catch (err) {
    fail(err);
  } finally {
    useTourUi.setState({ busy: false, pressing: false });
  }
  await show(useDemo.getState().tour.step);
}

function begin(reset: boolean) {
  if (reset) resetDemo({ silent: true });
  setSession({ userId: 'u-antoine', locationFilter: 'all', period: '30d' });
  setTour({ active: true, step: 0, minimized: false, ids: {}, facts: {} });
  useTourUi.setState({ askReset: false, busy: false, pressing: false });
  void show(0);
}

/** Inicia (o retoma) el recorrido. Si los datos ya se han tocado, pide reiniciar antes. */
export function startTour() {
  const { tour, data } = useDemo.getState();
  if (tour.active) {
    setTour({ minimized: false });
    void show(tour.step);
    return;
  }
  if (data.meta.touched) {
    useTourUi.setState({ askReset: true });
    return;
  }
  begin(false);
}

export function confirmStart(reset: boolean) {
  begin(reset);
}

export function cancelStart() {
  useTourUi.setState({ askReset: false });
}

export function exitTour() {
  setTour({ active: false, minimized: false });
  useTourUi.setState({ target: null, pressing: false, busy: false });
  if (useDemo.getState().session.userId !== 'u-antoine') setSession({ userId: 'u-antoine' });
}

export function restartTour() {
  begin(true);
}

/** Al recargar la página con el recorrido en curso, vuelve a situar la interfaz. */
export function resumeTour() {
  const { tour } = useDemo.getState();
  if (tour.active && !tour.minimized) void show(tour.step);
}

export function minimizeTour(minimized: boolean) {
  setTour({ minimized });
  if (minimized) useTourUi.setState({ target: null });
  else void show(useDemo.getState().tour.step);
}
