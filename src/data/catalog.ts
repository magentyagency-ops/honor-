import type {
  CategoryId, Location, LocationId, PosItem, Product, Recipe, Supplier, User,
} from '@/domain/types';

/**
 * Datos de referencia de la demostración.
 * Todo es ficticio: locales, personas, proveedores, precios y recetas son hipótesis
 * pensadas para ilustrar el funcionamiento, no datos reales de Saint-Honoré.
 */

export const SYSTEM_USER = 'sistema';

export const LOCATIONS: Location[] = [
  { id: 'cv', name: 'Casco Viejo', code: 'CV', address: 'Av. Central con Calle 8.ª Este, Casco Viejo', managerId: 'u-mariela' },
  { id: 'sf', name: 'San Francisco', code: 'SF', address: 'Calle 74 Este, San Francisco', managerId: 'u-luis' },
  { id: 'ce', name: 'Costa del Este', code: 'CE', address: 'Av. Centenario, Plaza del Este, local 4', managerId: 'u-daniela' },
];

export const USERS: User[] = [
  { id: 'u-antoine', name: 'Antoine', first: 'Antoine', role: 'direccion', roleLabel: 'Dirección general', initials: 'A', phone: '+507 6000-0100' },
  { id: 'u-luis', name: 'Luis Batista', first: 'Luis', role: 'gerente', roleLabel: 'Gerente · San Francisco', locationId: 'sf', initials: 'LB', phone: '+507 6000-0112' },
  { id: 'u-mariela', name: 'Mariela Quintero', first: 'Mariela', role: 'gerente', roleLabel: 'Gerente · Casco Viejo', locationId: 'cv', initials: 'MQ', phone: '+507 6000-0111' },
  { id: 'u-daniela', name: 'Daniela Him', first: 'Daniela', role: 'gerente', roleLabel: 'Gerente · Costa del Este', locationId: 'ce', initials: 'DH', phone: '+507 6000-0113' },
  { id: 'u-rosa', name: 'Rosa Pinzón', first: 'Rosa', role: 'contabilidad', roleLabel: 'Contabilidad', initials: 'RP', phone: '+507 6000-0120' },
];

/** Perfiles que se pueden elegir en el selector de rol de la demostración. */
export const DEMO_PROFILES = ['u-antoine', 'u-luis', 'u-rosa'];

export const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: 'cafe', label: 'Café y cacao' },
  { id: 'lacteos', label: 'Lácteos' },
  { id: 'panaderia', label: 'Panadería y secos' },
  { id: 'frescos', label: 'Frescos' },
  { id: 'empaques', label: 'Empaques' },
  { id: 'limpieza', label: 'Limpieza' },
];

export const SUPPLIERS: Supplier[] = [
  {
    id: 's-baru', name: 'Tostadores del Barú', short: 'Del Barú', categoryLabel: 'Café y cacao',
    contactName: 'Ernesto Caballero', whatsapp: '+507 6000-0201', ruc: '155600201-2-2019 DV 41',
    address: 'Vía Boquete, Chiriquí', paymentTermsDays: 30, leadTimeDays: 2, cadenceDays: 7, invoicePrefix: 'TB',
  },
  {
    id: 's-pradera', name: 'Lácteos La Pradera', short: 'La Pradera', categoryLabel: 'Lácteos',
    contactName: 'Yolanda Ríos', whatsapp: '+507 6000-0202', ruc: '155600202-2-2017 DV 08',
    address: 'Zona industrial de Juan Díaz, Panamá', paymentTermsDays: 15, leadTimeDays: 1, cadenceDays: 3, invoicePrefix: 'LP',
  },
  {
    id: 's-molinos', name: 'Molinos del Istmo', short: 'Molinos', categoryLabel: 'Panadería y secos',
    contactName: 'Rubén Castillo', whatsapp: '+507 6000-0203', ruc: '155600203-2-2015 DV 77',
    address: 'Vía Tocumen, Panamá', paymentTermsDays: 30, leadTimeDays: 2, cadenceDays: 7, invoicePrefix: 'MI',
  },
  {
    id: 's-azuero', name: 'Huerta Azuero', short: 'Azuero', categoryLabel: 'Frescos y charcutería',
    contactName: 'Dalys Vergara', whatsapp: '+507 6000-0204', ruc: '155600204-2-2020 DV 15',
    address: 'Merca Panamá, galera 12', paymentTermsDays: 7, leadTimeDays: 1, cadenceDays: 3, invoicePrefix: 'HA',
  },
  {
    id: 's-canal', name: 'Empaques Canal', short: 'Emp. Canal', categoryLabel: 'Empaques y desechables',
    contactName: 'Omar Sanjur', whatsapp: '+507 6000-0205', ruc: '155600205-2-2012 DV 63',
    address: 'Parque logístico Panamá Pacífico', paymentTermsDays: 30, leadTimeDays: 3, cadenceDays: 14, invoicePrefix: 'EC',
  },
  {
    id: 's-pacifico', name: 'Higiene Pacífico', short: 'Hig. Pacífico', categoryLabel: 'Limpieza e higiene',
    contactName: 'Marisol Guerra', whatsapp: '+507 6000-0206', ruc: '155600206-2-2018 DV 29',
    address: 'Río Abajo, Panamá', paymentTermsDays: 30, leadTimeDays: 3, cadenceDays: 28, invoicePrefix: 'HP',
  },
];

type PackDef = [label: string, noun: string, nounPlural: string, baseQty: number];
const caja = (label: string, baseQty: number): PackDef => [label, 'caja', 'cajas', baseQty];
const bolsa = (label: string, baseQty: number): PackDef => [label, 'bolsa', 'bolsas', baseQty];
const paquete = (label: string, baseQty: number): PackDef => [label, 'paquete', 'paquetes', baseQty];
const saco = (label: string, baseQty: number): PackDef => [label, 'saco', 'sacos', baseQty];

function product(
  id: string, name: string, category: CategoryId, baseUnit: Product['baseUnit'], supplierId: string, sku: string,
  pack: PackDef, price: number, opts: { tax?: number; tracked?: boolean } = {},
): Product {
  return {
    id, name, category, baseUnit,
    recipeTracked: opts.tracked ?? true,
    offer: {
      supplierId, sku,
      pack: { label: pack[0], noun: pack[1], nounPlural: pack[2], baseQty: pack[3] },
      priceCents: Math.round(price * 100),
      taxRate: opts.tax ?? 0,
    },
  };
}

const ITBMS = 0.07;

export const PRODUCTS: Product[] = [
  // Café y cacao — Tostadores del Barú
  product('p-cafe', 'Café en grano · mezcla espresso', 'cafe', 'g', 's-baru', 'TB-ESP-6', caja('Caja 6 × 1 kg', 6000), 117.0),
  product('p-descaf', 'Café en grano descafeinado', 'cafe', 'g', 's-baru', 'TB-DEC-1', bolsa('Bolsa 1 kg', 1000), 21.0, { tracked: false }),
  product('p-cacao', 'Cacao en polvo', 'cafe', 'g', 's-baru', 'TB-CAC-1', bolsa('Bolsa 1 kg', 1000), 11.8),
  // Lácteos — Lácteos La Pradera
  product('p-leche', 'Leche entera', 'lacteos', 'ml', 's-pradera', 'LP-1001', caja('Caja 12 × 1 L', 12000), 17.4),
  product('p-deslac', 'Leche deslactosada', 'lacteos', 'ml', 's-pradera', 'LP-1004', caja('Caja 12 × 1 L', 12000), 20.4, { tracked: false }),
  product('p-avena', 'Bebida de avena', 'lacteos', 'ml', 's-pradera', 'LP-1310', caja('Caja 6 × 1 L', 6000), 17.1, { tracked: false }),
  product('p-crema', 'Crema de leche', 'lacteos', 'ml', 's-pradera', 'LP-2002', caja('Caja 6 × 1 L', 6000), 28.2),
  product('p-mantequilla', 'Mantequilla sin sal', 'lacteos', 'g', 's-pradera', 'LP-3005', caja('Caja 5 × 1 kg', 5000), 49.0),
  product('p-queso', 'Queso suizo en lonjas', 'lacteos', 'g', 's-pradera', 'LP-4011', paquete('Paquete 1 kg', 1000), 13.9),
  // Panadería y secos — Molinos del Istmo
  product('p-harina', 'Harina de trigo', 'panaderia', 'g', 's-molinos', 'MI-H25', saco('Saco 25 kg', 25000), 22.5),
  product('p-azucar', 'Azúcar blanca', 'panaderia', 'g', 's-molinos', 'MI-A25', saco('Saco 25 kg', 25000), 24.0),
  product('p-levadura', 'Levadura fresca', 'panaderia', 'g', 's-molinos', 'MI-L05', paquete('Paquete 500 g', 500), 3.4),
  product('p-baguette', 'Baguette precocida', 'panaderia', 'un', 's-molinos', 'MI-BG40', caja('Caja 40 un', 40), 32.0),
  product('p-chocolate', 'Chocolate de cobertura', 'panaderia', 'g', 's-molinos', 'MI-CH25', bolsa('Bolsa 2.5 kg', 2500), 34.5, { tracked: false }),
  // Frescos — Huerta Azuero
  product('p-huevos', 'Huevos frescos', 'frescos', 'un', 's-azuero', 'HA-HV30', ['Cartón 30 un', 'cartón', 'cartones', 30], 5.7),
  product('p-naranjas', 'Naranjas para jugo', 'frescos', 'g', 's-azuero', 'HA-NJ20', ['Malla 20 kg', 'malla', 'mallas', 20000], 18.0),
  product('p-limones', 'Limones', 'frescos', 'g', 's-azuero', 'HA-LM10', ['Malla 10 kg', 'malla', 'mallas', 10000], 12.5, { tracked: false }),
  product('p-jamon', 'Jamón cocido', 'frescos', 'g', 's-azuero', 'HA-JC01', paquete('Paquete 1 kg', 1000), 12.4),
  // Empaques — Empaques Canal
  product('p-vaso12', 'Vaso de cartón 12 oz', 'empaques', 'un', 's-canal', 'EC-V12', caja('Caja 1,000 un', 1000), 64.0, { tax: ITBMS, tracked: false }),
  product('p-tapa12', 'Tapa para vaso 12 oz', 'empaques', 'un', 's-canal', 'EC-T12', caja('Caja 1,000 un', 1000), 29.0, { tax: ITBMS, tracked: false }),
  product('p-bolsa', 'Bolsa de papel kraft', 'empaques', 'un', 's-canal', 'EC-BK5', paquete('Paquete 500 un', 500), 24.5, { tax: ITBMS, tracked: false }),
  product('p-servilletas', 'Servilletas', 'empaques', 'un', 's-canal', 'EC-SV3', caja('Caja 3,000 un', 3000), 21.0, { tax: ITBMS, tracked: false }),
  // Limpieza — Higiene Pacífico
  product('p-detergente', 'Detergente lavavajillas', 'limpieza', 'ml', 's-pacifico', 'HP-DL5', ['Garrafa 5 L', 'garrafa', 'garrafas', 5000], 14.8, { tax: ITBMS, tracked: false }),
  product('p-desinfectante', 'Desinfectante de superficies', 'limpieza', 'ml', 's-pacifico', 'HP-DS5', ['Garrafa 5 L', 'garrafa', 'garrafas', 5000], 12.2, { tax: ITBMS, tracked: false }),
  product('p-guantes', 'Guantes de nitrilo', 'limpieza', 'un', 's-pacifico', 'HP-GN100', caja('Caja 100 un', 100), 8.4, { tax: ITBMS, tracked: false }),
];

/**
 * Fichas de receta. Las cantidades son hipótesis de demostración y se pueden editar en la aplicación.
 * Cada ingrediente se expresa en la unidad de referencia de su producto (g, ml o un).
 */
export function seedRecipes(at: string): Recipe[] {
  const r = (id: string, name: string, ingredients: [string, number][]): Recipe => ({
    id, name, updatedAt: at, updatedBy: 'u-antoine',
    ingredients: ingredients.map(([productId, qty]) => ({ productId, qty })),
  });
  return [
    r('r-espresso', 'Espresso', [['p-cafe', 18]]),
    r('r-cappuccino', 'Cappuccino', [['p-cafe', 18], ['p-leche', 150]]),
    r('r-latte', 'Latte', [['p-cafe', 18], ['p-leche', 240]]),
    r('r-chocolate', 'Chocolate caliente', [['p-leche', 220], ['p-cacao', 25], ['p-azucar', 10]]),
    r('r-croissant', 'Croissant de mantequilla', [['p-harina', 55], ['p-mantequilla', 30], ['p-azucar', 6], ['p-levadura', 2], ['p-huevos', 0.1]]),
    r('r-quiche', 'Quiche lorraine (porción)', [['p-huevos', 1], ['p-crema', 60], ['p-jamon', 35], ['p-queso', 25], ['p-harina', 45], ['p-mantequilla', 22]]),
    r('r-sandwich', 'Sándwich de jamón y queso', [['p-baguette', 1], ['p-jamon', 60], ['p-queso', 40], ['p-mantequilla', 10]]),
    r('r-jugo', 'Jugo de naranja natural', [['p-naranjas', 450]]),
  ];
}

/** Artículos tal y como existen en la caja, con su correspondencia de receta. */
export const POS_ITEMS: PosItem[] = [
  { id: 'ESP', posName: 'ESPRESSO', name: 'Espresso', priceCents: 225, mapping: 'receta', recipeId: 'r-espresso' },
  { id: 'AME', posName: 'AMERICANO', name: 'Americano', priceCents: 275, mapping: 'receta', recipeId: 'r-espresso' },
  { id: 'CAP', posName: 'CAPPUCCINO', name: 'Cappuccino', priceCents: 375, mapping: 'receta', recipeId: 'r-cappuccino' },
  { id: 'LAT', posName: 'LATTE', name: 'Latte', priceCents: 425, mapping: 'receta', recipeId: 'r-latte' },
  { id: 'CHO', posName: 'CHOCOLATE CALIENTE', name: 'Chocolate caliente', priceCents: 395, mapping: 'receta', recipeId: 'r-chocolate' },
  { id: 'CRO', posName: 'CROISSANT MANTEQUILLA', name: 'Croissant', priceCents: 295, mapping: 'receta', recipeId: 'r-croissant' },
  { id: 'QUI', posName: 'QUICHE LORRAINE', name: 'Quiche lorraine', priceCents: 550, mapping: 'receta', recipeId: 'r-quiche' },
  { id: 'SAN', posName: 'SANDWICH JAMON QUESO', name: 'Sándwich de jamón y queso', priceCents: 675, mapping: 'receta', recipeId: 'r-sandwich' },
  { id: 'JUG', posName: 'JUGO NARANJA NAT', name: 'Jugo de naranja natural', priceCents: 450, mapping: 'receta', recipeId: 'r-jugo' },
  // Artículo nuevo en la carta: todavía sin receta asociada (anomalía intencional de la demostración).
  { id: 'LIM', posName: 'LIMONADA HIERBABUENA', name: 'Limonada de hierbabuena', priceCents: 350, mapping: 'pendiente' },
];

// ───────────────────────────── Parámetros de la simulación ─────────────────────────────

/** Tickets en un día normal, por local. */
export const BASE_TICKETS: Record<LocationId, number> = { cv: 248, sf: 212, ce: 186 };

/** Estacionalidad semanal (domingo → sábado). */
export const WEEKDAY_FACTOR: Record<LocationId, number[]> = {
  cv: [1.22, 0.86, 0.88, 0.9, 0.96, 1.1, 1.28], // zona turística: fines de semana fuertes
  sf: [0.92, 0.98, 1.0, 1.02, 1.04, 1.1, 1.02], // barrio residencial y de oficinas
  ce: [0.72, 1.06, 1.08, 1.08, 1.1, 1.1, 0.82], // distrito de negocios: entre semana
};

/** Unidades vendidas por ticket, por artículo. */
export const ITEM_MIX: Record<string, number> = {
  ESP: 0.16, AME: 0.2, CAP: 0.3, LAT: 0.22, CHO: 0.06, CRO: 0.34, QUI: 0.09, SAN: 0.17, JUG: 0.13, LIM: 0.07,
};

/** Ajuste del mix por local (multiplicador). */
export const MIX_TWEAK: Record<LocationId, Record<string, number>> = {
  cv: { JUG: 1.25, CRO: 1.1, LIM: 1.3 },
  sf: { CAP: 1.08, LAT: 1.05 },
  ce: { ESP: 1.25, AME: 1.2, SAN: 1.2, QUI: 1.15 },
};

/** Días (hacia atrás desde hoy) desde que la limonada está en carta. */
export const LIMONADA_SINCE_DAYS = 6;

/** Horario de atención (hora de Panamá). */
export const OPEN_HOUR = 6.5;
export const CLOSE_HOUR = 20;

/** Reparto de tickets por hora, de 06:00 a 19:59 (suma 1). La primera franja empieza a las 06:30. */
export const HOUR_SHARE: Record<number, number> = {
  6: 0.04, 7: 0.11, 8: 0.13, 9: 0.1, 10: 0.07, 11: 0.07, 12: 0.09, 13: 0.08, 14: 0.06, 15: 0.07, 16: 0.07, 17: 0.05, 18: 0.04, 19: 0.02,
};

/**
 * Consumo real por ticket de los productos que no pasan por recetas (unidad de referencia).
 * Solo se refleja en inventario cuando se hace un conteo físico.
 */
export const OFF_RECIPE_USAGE: Record<string, number> = {
  'p-descaf': 0.8, 'p-deslac': 9, 'p-avena': 6, 'p-chocolate': 3, 'p-limones': 0,
  'p-vaso12': 0.4, 'p-tapa12': 0.38, 'p-bolsa': 0.25, 'p-servilletas': 1.6,
  'p-detergente': 0.8, 'p-desinfectante': 0.65, 'p-guantes': 0.06,
};

/**
 * Hace cuántos días fue la última entrega de cada proveedor en cada local.
 * Las entregas anteriores se repiten con la cadencia del proveedor. Define el guion de la demostración.
 */
export const LAST_DELIVERY_AGO: Record<string, Record<LocationId, number>> = {
  's-baru': { cv: 2, sf: 4, ce: 5 },
  's-pradera': { cv: 2, sf: 3, ce: 1 },
  's-molinos': { cv: 5, sf: 3, ce: 1 },
  's-azuero': { cv: 2, sf: 1, ce: 1 },
  's-canal': { cv: 11, sf: 5, ce: 8 },
  's-pacifico': { cv: 9, sf: 16, ce: 23 },
};

export const WASTE_REASONS = [
  'Producto vencido',
  'Rotura o derrame',
  'Mal estado al recibir',
  'Error de preparación',
  'Degustación o cortesía',
  'Otro',
];

export const PAYMENT_METHODS: { id: 'ach' | 'cheque' | 'efectivo' | 'yappy' | 'tarjeta'; label: string }[] = [
  { id: 'ach', label: 'Transferencia ACH' },
  { id: 'cheque', label: 'Cheque' },
  { id: 'yappy', label: 'Yappy' },
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'tarjeta', label: 'Tarjeta corporativa' },
];
