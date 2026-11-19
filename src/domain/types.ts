/**
 * Modelo de dominio de la plataforma.
 * Sin dependencias de React ni del navegador: todo lo que hay aquí se puede probar de forma aislada.
 */

export type ID = string;
/** Instante en UTC, formato ISO 8601. */
export type IsoDateTime = string;
/** Día de calendario en Panamá (America/Panama), formato YYYY-MM-DD. */
export type DayStr = string;
/** Importes en centavos de USD (enteros) para evitar errores de coma flotante. */
export type Cents = number;

// ───────────────────────────── Organización ─────────────────────────────

export type LocationId = 'cv' | 'sf' | 'ce';
export type LocationFilter = LocationId | 'all';

export interface Location {
  id: LocationId;
  name: string;
  code: string;
  address: string;
  managerId: ID;
}

export type Role = 'direccion' | 'gerente' | 'contabilidad';

export interface User {
  id: ID;
  name: string;
  first: string;
  role: Role;
  roleLabel: string;
  locationId?: LocationId;
  initials: string;
  phone: string;
}

// ───────────────────────────── Catálogo ─────────────────────────────

export type CategoryId = 'cafe' | 'lacteos' | 'panaderia' | 'frescos' | 'empaques' | 'limpieza';

export interface Supplier {
  id: ID;
  name: string;
  short: string;
  categoryLabel: string;
  contactName: string;
  whatsapp: string;
  ruc: string;
  address: string;
  /** Condiciones de pago: días a partir de la fecha de emisión. */
  paymentTermsDays: number;
  leadTimeDays: number;
  /** Cada cuántos días entrega habitualmente a un local. */
  cadenceDays: number;
  invoicePrefix: string;
}

/** Unidad de referencia en la que se lleva el inventario. */
export type BaseUnit = 'g' | 'ml' | 'un';

/** Presentación de compra y su conversión a la unidad de referencia. */
export interface Pack {
  /** «Caja 12 × 1 L» */
  label: string;
  /** «caja» */
  noun: string;
  nounPlural: string;
  /** Cantidad en unidad de referencia que aporta una presentación (12 000 ml). */
  baseQty: number;
}

/** Referencia y precio del proveedor para un producto. */
export interface SupplierOffer {
  supplierId: ID;
  sku: string;
  pack: Pack;
  /** Precio por presentación, sin impuestos. */
  priceCents: Cents;
  /** ITBMS aplicable (0 o 0.07). */
  taxRate: number;
}

export interface Product {
  id: ID;
  name: string;
  category: CategoryId;
  baseUnit: BaseUnit;
  offer: SupplierOffer;
  /** true si su consumo se calcula a partir de las recetas vendidas. */
  recipeTracked: boolean;
}

export interface StockSetting {
  /** Mínimo de seguridad, en unidad de referencia. */
  minBase: number;
  /** Nivel objetivo tras reabastecer, en unidad de referencia. */
  parBase: number;
}

// ───────────────────────────── Compras ─────────────────────────────

export type OrderStatus =
  | 'borrador'
  | 'pendiente_aprobacion'
  | 'aprobado'
  | 'enviado'
  | 'confirmado'
  | 'recibido_parcial'
  | 'recibido'
  | 'cancelado';

export interface OrderLine {
  productId: ID;
  /** Cantidad pedida, en presentaciones de compra. */
  packs: number;
  /** Copia de la conversión y el precio vigentes al crear el pedido. */
  packBaseQty: number;
  packLabel: string;
  unitPriceCents: Cents;
  taxRate: number;
}

export interface PurchaseOrder {
  id: ID;
  locationId: LocationId;
  supplierId: ID;
  status: OrderStatus;
  lines: OrderLine[];
  createdAt: IsoDateTime;
  createdBy: ID;
  requestedDelivery: DayStr;
  note?: string;
  origin: 'manual' | 'sugerencia' | 'historico';
  requiresApproval: boolean;
  approvedBy?: ID;
  approvedAt?: IsoDateTime;
  sentAt?: IsoDateTime;
  confirmedAt?: IsoDateTime;
  cancelledAt?: IsoDateTime;
  cancelledBy?: ID;
  cancelReason?: string;
  /** Cerrado sin esperar el faltante. */
  closedShort?: boolean;
}

export type ReceptionIssue = 'faltante' | 'danado' | 'rechazado';

export interface ReceptionLine {
  productId: ID;
  /** Pendiente de recibir antes de esta recepción, en presentaciones. */
  packsExpected: number;
  packsReceived: number;
  /** Cantidad que entra en inventario, en unidad de referencia. */
  baseQty: number;
  issue?: ReceptionIssue;
}

export interface Reception {
  id: ID;
  orderId: ID;
  locationId: LocationId;
  receivedAt: IsoDateTime;
  receivedBy: ID;
  lines: ReceptionLine[];
  note?: string;
}

export interface CartLine {
  productId: ID;
  packs: number;
}

// ───────────────────────────── Inventario ─────────────────────────────

export type MovementType =
  | 'inventario_inicial'
  | 'recepcion'
  | 'venta'
  | 'merma'
  | 'transferencia_salida'
  | 'transferencia_entrada'
  | 'ajuste_conteo';

export type MovementRef = 'recepcion' | 'sync' | 'ventas_dia' | 'conteo' | 'transferencia' | 'regularizacion';

export interface StockMovement {
  id: ID;
  at: IsoDateTime;
  locationId: LocationId;
  productId: ID;
  type: MovementType;
  /** Variación con signo, en unidad de referencia. */
  qty: number;
  refKind?: MovementRef;
  refId?: ID;
  /** Motivo (mermas) o explicación corta. */
  reason?: string;
  note?: string;
  by: ID;
}

export interface StockCountLine {
  productId: ID;
  theoreticalBase: number;
  countedBase: number;
}

export interface StockCount {
  id: ID;
  locationId: LocationId;
  at: IsoDateTime;
  by: ID;
  kind: 'inicial' | 'ciclico';
  lines: StockCountLine[];
  note?: string;
}

export interface RecipeIngredient {
  productId: ID;
  /** Cantidad por unidad vendida, en unidad de referencia del producto. */
  qty: number;
}

export interface Recipe {
  id: ID;
  name: string;
  ingredients: RecipeIngredient[];
  updatedAt: IsoDateTime;
  updatedBy: ID;
}

// ───────────────────────────── Ventas y cajas ─────────────────────────────

export type PosMapping = 'receta' | 'sin_impacto' | 'pendiente';

export interface PosItem {
  /** Código del artículo en la caja. */
  id: ID;
  /** Nombre tal y como llega desde la caja. */
  posName: string;
  name: string;
  priceCents: Cents;
  mapping: PosMapping;
  recipeId?: ID;
  /** Día a partir del cual existe en la carta (para artículos nuevos). */
  since?: DayStr;
}

export type PosStatus = 'conectado' | 'requiere_sync';

export interface PosConnection {
  id: ID;
  locationId: LocationId;
  label: string;
  status: PosStatus;
  lastSyncAt: IsoDateTime;
  /** Último número de ticket generado por la caja simulada. */
  lastSeq: number;
  autoSync: boolean;
  issue?: string;
}

export interface TicketLine {
  itemId: ID;
  qty: number;
  unitPriceCents: Cents;
}

export interface SaleTicket {
  /** Identificador único de la caja: la clave que impide importar dos veces el mismo ticket. */
  id: ID;
  locationId: LocationId;
  at: IsoDateTime;
  lines: TicketLine[];
  totalCents: Cents;
  syncId?: ID;
}

export interface SalesDay {
  day: DayStr;
  locationId: LocationId;
  tickets: number;
  revenueCents: Cents;
  /** itemId → [unidades, ingresos en centavos] */
  items: Record<ID, [number, Cents]>;
}

export interface SyncConsumption {
  productId: ID;
  qty: number;
}

export interface SyncRun {
  id: ID;
  locationId: LocationId;
  at: IsoDateTime;
  trigger: 'manual' | 'auto';
  fetched: number;
  imported: number;
  duplicates: number;
  revenueCents: Cents;
  itemsSold: Record<ID, number>;
  consumption: SyncConsumption[];
  unmapped: Record<ID, number>;
  by: ID;
}

/** Ventas de artículos sin receta: registradas como ingreso, pendientes de descontar del inventario. */
export interface UndeductedSales {
  locationId: LocationId;
  itemId: ID;
  qty: number;
  revenueCents: Cents;
  firstDay: DayStr;
  lastDay: DayStr;
}

// ───────────────────────────── Facturas y pagos ─────────────────────────────

export type InvoiceStatus =
  | 'recibida'
  | 'por_revisar'
  | 'validada'
  | 'parcialmente_pagada'
  | 'pagada'
  | 'en_disputa'
  | 'descartada';

export interface InvoiceLine {
  productId?: ID;
  description: string;
  packs: number;
  unitPriceCents: Cents;
  taxRate: number;
}

/** Lo que figura impreso en el documento del proveedor (la «verdad» del papel). */
export interface PrintedInvoice {
  supplierId: ID;
  number: string;
  issueDate: DayStr;
  /** Algunos proveedores no imprimen vencimiento: se propone a partir de sus condiciones. */
  dueDate?: DayStr;
  orderRef?: ID;
  lines: InvoiceLine[];
  subtotalCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
  handNote?: string;
}

export type DocChannel = 'whatsapp' | 'carga_manual';
export type DocStatus = 'recibido' | 'procesado' | 'duplicado';

/** Pistas para la extracción simulada (qué campos lee mal o con poca confianza). */
export interface ExtractionHints {
  lowConfidence?: InvoiceFieldKey[];
  misread?: Partial<Record<InvoiceFieldKey, string>>;
}

export interface SourceDocument {
  id: ID;
  channel: DocChannel;
  senderId: ID;
  locationId: LocationId;
  receivedAt: IsoDateTime;
  fileName: string;
  /** Huella del archivo: impide importar dos veces el mismo documento. */
  fingerprint: string;
  kind: 'ejemplo' | 'archivo';
  status: DocStatus;
  invoiceId?: ID;
  printed?: PrintedInvoice;
  hints?: ExtractionHints;
  /** Miniatura (solo para archivos cargados por el usuario). */
  previewDataUrl?: string;
  caption?: string;
}

export type InvoiceFieldKey =
  | 'supplierId'
  | 'number'
  | 'issueDate'
  | 'dueDate'
  | 'locationId'
  | 'subtotalCents'
  | 'taxCents'
  | 'totalCents';

export interface FieldCorrection {
  field: InvoiceFieldKey;
  from: string;
  to: string;
  by: ID;
  at: IsoDateTime;
}

export type DueDateSource = 'documento' | 'propuesta' | 'manual';

export interface InvoiceDispute {
  reason: string;
  amountCents: Cents;
  openedBy: ID;
  openedAt: IsoDateTime;
}

export interface Invoice {
  id: ID;
  documentId: ID;
  status: InvoiceStatus;
  receivedAt: IsoDateTime;
  locationId: LocationId;
  supplierId?: ID;
  number: string;
  issueDate: DayStr;
  dueDate: DayStr;
  dueDateSource: DueDateSource;
  dueDateConfirmed: boolean;
  subtotalCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
  lines: InvoiceLine[];
  /** Confianza de la extracción por campo (0–1). Un campo corregido a mano queda en 1. */
  confidence: Partial<Record<InvoiceFieldKey, number>>;
  corrections: FieldCorrection[];
  orderId?: ID;
  /** Cómo se vinculó el pedido. */
  orderMatch?: 'referencia' | 'sugerido' | 'manual';
  validatedBy?: ID;
  validatedAt?: IsoDateTime;
  validationNote?: string;
  dispute?: InvoiceDispute;
  /** El usuario indicó que la alerta de duplicado no aplica. */
  duplicateDismissed?: boolean;
  discardedReason?: string;
}

export type PaymentMethod = 'ach' | 'cheque' | 'efectivo' | 'yappy' | 'tarjeta';

export interface Payment {
  id: ID;
  invoiceId: ID;
  /** Fecha del pago (día en Panamá). */
  date: DayStr;
  amountCents: Cents;
  method: PaymentMethod;
  reference: string;
  by: ID;
  createdAt: IsoDateTime;
  voidedAt?: IsoDateTime;
  voidedBy?: ID;
}

// ───────────────────────────── Mensajería y auditoría ─────────────────────────────

export interface WaMessage {
  id: ID;
  /** Hilo: identificador del proveedor o del gerente. */
  threadId: ID;
  direction: 'out' | 'in';
  at: IsoDateTime;
  body: string;
  orderId?: ID;
  documentId?: ID;
  status: 'enviado' | 'entregado' | 'leido';
  /** Siempre true en esta demostración: ningún mensaje sale de la aplicación. */
  simulated: true;
}

export type AuditEntity =
  | 'pedido'
  | 'recepcion'
  | 'factura'
  | 'pago'
  | 'inventario'
  | 'caja'
  | 'receta'
  | 'documento'
  | 'configuracion';

export interface AuditEvent {
  id: ID;
  at: IsoDateTime;
  /** Usuario, «sistema» o identificador de proveedor. */
  by: ID;
  action: string;
  summary: string;
  entity: AuditEntity;
  entityId?: ID;
  locationId?: LocationId;
}

// ───────────────────────────── Estado ─────────────────────────────

export type PeriodId = 'hoy' | '7d' | '30d' | 'mes';

export interface Settings {
  approvalEnabled: boolean;
  approvalThresholdCents: Cents;
}

export interface DemoData {
  meta: { schema: number; seedDay: DayStr; seededAt: IsoDateTime; touched: boolean };
  settings: Settings;
  locations: Location[];
  users: User[];
  suppliers: Supplier[];
  products: Product[];
  /** Clave `${locationId}:${productId}` */
  stockSettings: Record<string, StockSetting>;
  recipes: Recipe[];
  posItems: PosItem[];
  posConnections: PosConnection[];
  orders: PurchaseOrder[];
  receptions: Reception[];
  movements: StockMovement[];
  counts: StockCount[];
  /** Clave `${day}|${locationId}` */
  salesDays: Record<string, SalesDay>;
  tickets: SaleTicket[];
  ticketIndex: Record<ID, 1>;
  syncRuns: SyncRun[];
  /** Clave `${locationId}:${itemId}` */
  undeducted: Record<string, UndeductedSales>;
  /** Ventas tecleadas en la caja simulada que aún no se han sincronizado (herramienta de demostración). */
  posDemoQueue: SaleTicket[];
  documents: SourceDocument[];
  invoices: Invoice[];
  payments: Payment[];
  waMessages: WaMessage[];
  audit: AuditEvent[];
  carts: Record<LocationId, CartLine[]>;
  seq: Record<string, number>;
}

/** Contexto de una acción: quién la hace y cuándo. */
export interface Ctx {
  now: IsoDateTime;
  userId: ID;
}

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}
