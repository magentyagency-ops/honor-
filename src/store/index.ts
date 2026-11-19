import { create } from 'zustand';
import { current, isDraft, produce } from 'immer';
import type {
  Ctx, DemoData, ID, IsoDateTime, LocationFilter, LocationId, PeriodId, SyncRun, User,
} from '@/domain/types';
import { DomainError } from '@/domain/types';
import { SCHEMA_VERSION, createSeed } from '@/data/seed';
import { addMinutes, minutesBetween, panamaDay } from '@/domain/time';
import { composeOrderMessage, confirmOrder, sendOrder } from '@/domain/purchasing';
import { importTickets } from '@/domain/sales';
import { applyExtraction, createManualInvoice, receiveDocument, type ReceiveDocumentInput } from '@/domain/invoices';
import { generateTickets, simulatedPos } from '@/adapters/pos';
import { simulatedWhatsApp } from '@/adapters/whatsapp';
import { simulateExtraction, simulatedExtractor } from '@/adapters/extraction';
import { buildDuplicateResend, buildInvoiceDocumentForOrder, buildNoOrderInvoice, orderAwaitingInvoice } from '@/data/scenarios';

// ───────────────────────────── Tipos de estado ─────────────────────────────

export interface Session {
  userId: ID;
  locationFilter: LocationFilter;
  period: PeriodId;
}

export interface TourState {
  active: boolean;
  step: number;
  minimized: boolean;
  /** Identificadores de lo creado durante el recorrido. */
  ids: { orderId?: ID; receptionId?: ID; syncId?: ID; documentId?: ID; invoiceId?: ID; paymentId?: ID };
  /** Cifras capturadas en cada paso, para contarlas después. */
  facts: Record<string, number>;
}

export interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info';
  title: string;
  detail?: string;
}

export interface UiState {
  toasts: Toast[];
  syncing: Partial<Record<LocationId, boolean>>;
  extracting: Record<ID, boolean>;
  sending: Record<ID, boolean>;
  awaitingReply: Record<ID, boolean>;
  /** Última sincronización manual, para mostrar su detalle. */
  lastSyncId?: ID;
}

export interface DemoStore {
  data: DemoData;
  session: Session;
  tour: TourState;
  ui: UiState;
  now: IsoDateTime;
}

const DATA_KEY = 'saint-honore-demo:data';
const SESSION_KEY = 'saint-honore-demo:session';

const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
/** La aplicación se muestra dentro del marco de teléfono de «Vista móvil». */
export const EMBED = params.get('frame') === 'phone';

const DEFAULT_SESSION: Session = { userId: 'u-antoine', locationFilter: 'all', period: '30d' };
const DEFAULT_TOUR: TourState = { active: false, step: 0, minimized: false, ids: {}, facts: {} };

const nowIso = () => new Date().toISOString();
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ───────────────────────────── Carga inicial ─────────────────────────────

let bootNotice: Toast | null = null;

function loadData(now: IsoDateTime): DemoData {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoData;
      if (parsed?.meta?.schema === SCHEMA_VERSION && parsed.meta.seedDay === panamaDay(now)) return parsed;
      // Datos de otro día (o de una versión anterior): se regeneran para que «hoy» sea hoy.
      bootNotice = { id: 1, kind: 'info', title: 'Datos de demostración actualizados a hoy', detail: 'Se regeneran cada día para que fechas y vencimientos sigan teniendo sentido.' };
    }
  } catch {
    /* almacenamiento no disponible: se sigue con datos en memoria */
  }
  return createSeed(now);
}

function loadSession(): { session: Session; tour: TourState } {
  if (EMBED) {
    const as = params.get('as');
    return { session: { ...DEFAULT_SESSION, userId: as ?? 'u-luis' }, tour: DEFAULT_TOUR };
  }
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { session?: Session; tour?: TourState; seedDay?: string };
      return {
        session: { ...DEFAULT_SESSION, ...p.session },
        tour: p.seedDay === panamaDay(nowIso()) ? { ...DEFAULT_TOUR, ...p.tour } : DEFAULT_TOUR,
      };
    }
  } catch {
    /* ignorar */
  }
  return { session: DEFAULT_SESSION, tour: DEFAULT_TOUR };
}

const bootNow = nowIso();
const bootData = loadData(bootNow);
const bootSession = loadSession();
if (!bootData.users.some((u) => u.id === bootSession.session.userId)) bootSession.session.userId = DEFAULT_SESSION.userId;

export const useDemo = create<DemoStore>(() => ({
  data: bootData,
  session: bootSession.session,
  tour: bootSession.tour,
  ui: { toasts: bootNotice ? [bootNotice] : [], syncing: {}, extracting: {}, sending: {}, awaitingReply: {} },
  now: bootNow,
}));

// ───────────────────────────── Persistencia y pestañas ─────────────────────────────

let lastSaved: DemoData | null = null;
let lastSession = '';
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function flush() {
  const s = useDemo.getState();
  try {
    if (s.data !== lastSaved) {
      localStorage.setItem(DATA_KEY, JSON.stringify(s.data));
      lastSaved = s.data;
    }
    if (!EMBED) {
      const sess = JSON.stringify({ session: s.session, tour: s.tour, seedDay: s.data.meta.seedDay });
      if (sess !== lastSession) {
        localStorage.setItem(SESSION_KEY, sess);
        lastSession = sess;
      }
    }
  } catch (err) {
    console.warn('No se pudo guardar el estado de la demostración', err);
  }
}

if (typeof window !== 'undefined') {
  useDemo.subscribe(() => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 200);
  });
  flush();
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => document.hidden && flush());
  // Otra pestaña (o la vista móvil) cambió los datos: se adoptan aquí también.
  window.addEventListener('storage', (e) => {
    if (e.key !== DATA_KEY || !e.newValue) return;
    try {
      const data = JSON.parse(e.newValue) as DemoData;
      lastSaved = data;
      useDemo.setState({ data });
    } catch {
      /* ignorar */
    }
  });
  setInterval(() => useDemo.setState({ now: nowIso() }), 20_000);
}

// ───────────────────────────── Acciones ─────────────────────────────

let toastId = 10;

export function toast(kind: Toast['kind'], title: string, detail?: string) {
  const id = ++toastId;
  useDemo.setState((s) => ({ ui: { ...s.ui, toasts: [...s.ui.toasts.slice(-3), { id, kind, title, detail }] } }));
  setTimeout(() => dismissToast(id), kind === 'error' ? 7000 : 4800);
}

export function dismissToast(id: number) {
  useDemo.setState((s) => ({ ui: { ...s.ui, toasts: s.ui.toasts.filter((t) => t.id !== id) } }));
}

function setUi(patch: (ui: UiState) => Partial<UiState>) {
  useDemo.setState((s) => ({ ui: { ...s.ui, ...patch(s.ui) } }));
}

export function currentCtx(as?: ID): Ctx {
  return { now: nowIso(), userId: as ?? useDemo.getState().session.userId };
}

/**
 * Lo que devuelve una operación puede referirse a objetos del borrador de immer, que dejan de ser
 * válidos al terminar. Se copian aquí (también si vienen dentro de un objeto o un arreglo).
 */
function detach<T>(value: T): T {
  if (isDraft(value)) return current(value as unknown as object) as T;
  if (Array.isArray(value)) return value.map((v) => detach(v)) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = isDraft(v) ? current(v as object) : v;
    return out as T;
  }
  return value;
}

/**
 * Ejecuta una operación de dominio sobre una copia del estado (immer) y la confirma si no falla.
 * Si la regla de negocio rechaza la operación, lanza DomainError y el estado no cambia.
 */
export function run<T>(fn: (d: DemoData, ctx: Ctx) => T, as?: ID): T {
  const ctx = currentCtx(as);
  let result!: T;
  const next = produce(useDemo.getState().data, (draft) => {
    result = detach(fn(draft as DemoData, ctx));
  });
  useDemo.setState({ data: next, now: ctx.now });
  return result;
}

/** Como `run`, pero muestra el error de negocio al usuario en lugar de propagarlo. */
export function act<T>(fn: (d: DemoData, ctx: Ctx) => T, okMessage?: string | ((value: T) => string)): { ok: true; value: T } | { ok: false } {
  try {
    const value = run(fn);
    if (okMessage) toast('ok', typeof okMessage === 'function' ? okMessage(value) : okMessage);
    return { ok: true, value };
  } catch (err) {
    if (err instanceof DomainError) {
      toast('error', err.message);
      return { ok: false };
    }
    throw err;
  }
}

export function setSession(patch: Partial<Session>) {
  useDemo.setState((s) => ({ session: { ...s.session, ...patch } }));
}

export function setTour(patch: Partial<TourState> | ((t: TourState) => Partial<TourState>)) {
  useDemo.setState((s) => ({ tour: { ...s.tour, ...(typeof patch === 'function' ? patch(s.tour) : patch) } }));
}

/** Vuelve a los datos iniciales del día. */
export function resetDemo(opts: { silent?: boolean } = {}) {
  const now = nowIso();
  useDemo.setState({
    data: createSeed(now),
    session: { ...DEFAULT_SESSION },
    tour: { ...DEFAULT_TOUR },
    ui: { toasts: [], syncing: {}, extracting: {}, sending: {}, awaitingReply: {} },
    now,
  });
  if (!opts.silent) toast('ok', 'Demostración reiniciada', 'Se restauraron los datos iniciales de hoy.');
}

// ── WhatsApp (simulado) ──

export async function sendOrderViaWhatsApp(orderId: ID, opts: { instant?: boolean } = {}): Promise<boolean> {
  const { data } = useDemo.getState();
  const order = data.orders.find((o) => o.id === orderId);
  if (!order) return false;
  const supplier = data.suppliers.find((s) => s.id === order.supplierId)!;
  if (!opts.instant) {
    setUi((ui) => ({ sending: { ...ui.sending, [orderId]: true } }));
    await simulatedWhatsApp.sendText({ to: supplier.whatsapp, body: composeOrderMessage(data, order) });
  }
  const res = act((d, ctx) => sendOrder(d, ctx, orderId));
  setUi((ui) => ({ sending: { ...ui.sending, [orderId]: false } }));
  if (!res.ok) return false;
  if (!opts.instant) {
    setUi((ui) => ({ awaitingReply: { ...ui.awaitingReply, [orderId]: true } }));
    await wait(simulatedWhatsApp.simulatedReplyDelayMs ?? 2000);
  }
  run((d, ctx) => confirmOrder(d, ctx, orderId));
  setUi((ui) => ({ awaitingReply: { ...ui.awaitingReply, [orderId]: false } }));
  return true;
}

// ── Cajas (simuladas) ──

/** Solape con el que se vuelve a pedir la ventana anterior: demuestra que no se duplica nada. */
const SYNC_OVERLAP_MIN = 30;

export async function syncPos(locationId: LocationId, opts: { instant?: boolean } = {}): Promise<SyncRun | null> {
  const { data } = useDemo.getState();
  const conn = data.posConnections.find((c) => c.locationId === locationId);
  const loc = data.locations.find((l) => l.id === locationId);
  if (!conn || !loc) return null;
  const now = nowIso();
  const req = { locationId, code: loc.code, since: addMinutes(conn.lastSyncAt, -SYNC_OVERLAP_MIN), until: now, menu: data.posItems, today: panamaDay(now) };
  setUi((ui) => ({ syncing: { ...ui.syncing, [locationId]: true } }));
  try {
    const tickets = opts.instant ? generateTickets(req) : await simulatedPos.fetchTickets(req);
    const result = run((d, ctx) => {
      const queued = d.posDemoQueue.filter((t) => t.locationId === locationId);
      const r = importTickets(d, ctx, locationId, [...tickets, ...queued], 'manual');
      d.posDemoQueue = d.posDemoQueue.filter((t) => t.locationId !== locationId);
      return r;
    });
    setUi(() => ({ lastSyncId: result.id }));
    return result;
  } finally {
    setUi((ui) => ({ syncing: { ...ui.syncing, [locationId]: false } }));
  }
}

/** Las cajas conectadas se sincronizan solas cada 15 minutos (sin avisos). */
export function autoSyncTick() {
  if (EMBED) return;
  const { data } = useDemo.getState();
  const now = nowIso();
  for (const c of data.posConnections) {
    if (!c.autoSync || c.status !== 'conectado' || minutesBetween(c.lastSyncAt, now) < 15) continue;
    const loc = data.locations.find((l) => l.id === c.locationId)!;
    const tickets = generateTickets({ locationId: c.locationId, code: loc.code, since: c.lastSyncAt, until: now, menu: data.posItems, today: panamaDay(now) });
    run((d) => importTickets(d, { now, userId: 'sistema' }, c.locationId, tickets, 'auto'));
  }
}

// ── Documentos y extracción (simulada) ──

export async function processDocument(documentId: ID, opts: { instant?: boolean } = {}): Promise<ID | null> {
  const doc = useDemo.getState().data.documents.find((x) => x.id === documentId);
  if (!doc) return null;
  if (doc.invoiceId) return doc.invoiceId;
  setUi((ui) => ({ extracting: { ...ui.extracting, [documentId]: true } }));
  try {
    const result = opts.instant ? simulateExtraction(doc) : await simulatedExtractor.extract(doc);
    const inv = run((d, ctx) => (result ? applyExtraction(d, ctx, documentId, result) : createManualInvoice(d, ctx, documentId)));
    return inv.id;
  } finally {
    setUi((ui) => ({ extracting: { ...ui.extracting, [documentId]: false } }));
  }
}

export type InboundKind = 'pedido' | 'precio' | 'sin_pedido' | 'duplicado';

/** Simula la llegada de una factura por WhatsApp. Devuelve el documento creado (o el ya existente). */
export function simulateInbound(kind: InboundKind, opts: { orderId?: ID; locationId?: LocationId } = {}): { documentId: ID; alreadyImported: boolean } | null {
  try {
    return run((d, ctx) => {
      let input: ReceiveDocumentInput;
      if (kind === 'sin_pedido') {
        input = buildNoOrderInvoice(d, { now: ctx.now, locationId: opts.locationId ?? 'sf' });
      } else if (kind === 'duplicado') {
        input = buildDuplicateResend(d, { now: ctx.now, locationId: opts.locationId });
      } else {
        const order = opts.orderId ? d.orders.find((o) => o.id === opts.orderId) : orderAwaitingInvoice(d, opts.locationId);
        if (!order) throw new DomainError('No hay ningún pedido recibido a la espera de factura. Registra antes una recepción.');
        input = buildInvoiceDocumentForOrder(d, order.id, { now: ctx.now, variant: kind === 'precio' ? 'precio' : 'pedido' });
      }
      const res = receiveDocument(d, { now: ctx.now, userId: input.senderId }, input);
      return { documentId: res.document.id, alreadyImported: res.alreadyImported };
    });
  } catch (err) {
    if (err instanceof DomainError) {
      toast('error', err.message);
      return null;
    }
    throw err;
  }
}

async function thumbnail(file: File): Promise<string | undefined> {
  if (!file.type.startsWith('image/')) return undefined;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.6);
  } catch {
    return undefined;
  }
}

/** Carga manual de un archivo. La huella (nombre + tamaño + fecha) evita importarlo dos veces. */
export async function uploadDocument(file: File, locationId: LocationId): Promise<{ documentId: ID; alreadyImported: boolean } | null> {
  const previewDataUrl = await thumbnail(file);
  const user = currentUser();
  const res = act((d, ctx) =>
    receiveDocument(d, ctx, {
      channel: 'carga_manual', senderId: user.id, locationId, fileName: file.name,
      fingerprint: `archivo:${file.name}:${file.size}:${file.lastModified}`, kind: 'archivo', previewDataUrl,
    }),
  );
  if (!res.ok) return null;
  return { documentId: res.value.document.id, alreadyImported: res.value.alreadyImported };
}

// ───────────────────────────── Lecturas habituales ─────────────────────────────

export function currentUser(): User {
  const s = useDemo.getState();
  return s.data.users.find((u) => u.id === s.session.userId) ?? s.data.users[0];
}

export const useData = () => useDemo((s) => s.data);
export const useNow = () => useDemo((s) => s.now);
export const useToday = () => useDemo((s) => panamaDay(s.now));
export const useUser = (): User => useDemo((s) => s.data.users.find((u) => u.id === s.session.userId) ?? s.data.users[0]);

/** Filtro de local efectivo: un gerente siempre ve su local. */
export function useLocationFilter(): LocationFilter {
  return useDemo((s) => {
    const u = s.data.users.find((x) => x.id === s.session.userId);
    return u?.role === 'gerente' && u.locationId ? u.locationId : s.session.locationFilter;
  });
}

export const usePeriod = () => useDemo((s) => s.session.period);
