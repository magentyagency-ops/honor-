/**
 * Traducción de la interfaz (español → francés / inglés).
 *
 * La aplicación se escribe en español. Para no duplicar cada componente, la traducción se aplica
 * sobre el texto ya renderizado: cada texto se normaliza en una «plantilla» (números, referencias,
 * horas y nombres propios sustituidos por marcadores), se busca en el diccionario del idioma y se
 * vuelven a insertar los valores. Lo que no tiene traducción se queda en español.
 *
 * Se excluyen a propósito los documentos del proveedor (la factura en papel) y los mensajes de
 * WhatsApp a los proveedores: en la realidad están en español, en Panamá.
 */
export type Lang = 'es' | 'fr' | 'en';

type Entity = [es: string, fr: string, en: string];

/** Nombres propios y vocabulario que aparece dentro de frases compuestas. */
const ENTITIES: Entity[] = [
  // Productos
  ['Café en grano · mezcla espresso', 'Café en grains · mélange espresso', 'Coffee beans · espresso blend'],
  ['Café en grano descafeinado', 'Café en grains décaféiné', 'Decaf coffee beans'],
  ['Cacao en polvo', 'Cacao en poudre', 'Cocoa powder'],
  ['Leche entera', 'Lait entier', 'Whole milk'],
  ['Leche deslactosada', 'Lait sans lactose', 'Lactose-free milk'],
  ['Bebida de avena', 'Boisson à l’avoine', 'Oat drink'],
  ['Crema de leche', 'Crème liquide', 'Cream'],
  ['Mantequilla sin sal', 'Beurre doux', 'Unsalted butter'],
  ['Queso suizo en lonjas', 'Emmental en tranches', 'Sliced Swiss cheese'],
  ['Harina de trigo', 'Farine de blé', 'Wheat flour'],
  ['Azúcar blanca', 'Sucre blanc', 'White sugar'],
  ['Levadura fresca', 'Levure fraîche', 'Fresh yeast'],
  ['Baguette precocida', 'Baguette précuite', 'Par-baked baguette'],
  ['Chocolate de cobertura', 'Chocolat de couverture', 'Couverture chocolate'],
  ['Huevos frescos', 'Œufs frais', 'Fresh eggs'],
  ['Naranjas para jugo', 'Oranges à jus', 'Juicing oranges'],
  ['Limones', 'Citrons verts', 'Limes'],
  ['Jamón cocido', 'Jambon cuit', 'Cooked ham'],
  ['Vaso de cartón 12 oz', 'Gobelet carton 12 oz', 'Paper cup 12 oz'],
  ['Tapa para vaso 12 oz', 'Couvercle gobelet 12 oz', 'Cup lid 12 oz'],
  ['Bolsa de papel kraft', 'Sac en papier kraft', 'Kraft paper bag'],
  ['Servilletas', 'Serviettes', 'Napkins'],
  ['Detergente lavavajillas', 'Liquide vaisselle', 'Dishwashing detergent'],
  ['Desinfectante de superficies', 'Désinfectant surfaces', 'Surface disinfectant'],
  ['Guantes de nitrilo', 'Gants en nitrile', 'Nitrile gloves'],
  // Artículos de caja y recetas
  ['Chocolate caliente', 'Chocolat chaud', 'Hot chocolate'],
  ['Croissant de mantequilla', 'Croissant au beurre', 'Butter croissant'],
  ['Quiche lorraine (porción)', 'Quiche lorraine (part)', 'Quiche lorraine (slice)'],
  ['Sándwich de jamón y queso', 'Sandwich jambon-fromage', 'Ham and cheese sandwich'],
  ['Jugo de naranja natural', 'Jus d’orange pressé', 'Fresh orange juice'],
  ['Limonada de hierbabuena', 'Citronnade à la menthe', 'Mint lemonade'],
  ['Americano', 'Americano', 'Americano'],
  ['Cappuccino', 'Cappuccino', 'Cappuccino'],
  ['Espresso', 'Espresso', 'Espresso'],
  ['Latte', 'Latte', 'Latte'],
  ['Croissant', 'Croissant', 'Croissant'],
  ['Quiche lorraine', 'Quiche lorraine', 'Quiche lorraine'],
  // Categorías
  ['Café y cacao', 'Café et cacao', 'Coffee & cocoa'],
  ['Lácteos', 'Produits laitiers', 'Dairy'],
  ['Panadería y secos', 'Boulangerie et épicerie', 'Bakery & dry goods'],
  ['Frescos y charcutería', 'Frais et charcuterie', 'Fresh & deli'],
  ['Empaques y desechables', 'Emballages et jetables', 'Packaging & disposables'],
  ['Limpieza e higiene', 'Nettoyage et hygiène', 'Cleaning & hygiene'],
  ['Frescos', 'Frais', 'Fresh'],
  ['Empaques', 'Emballages', 'Packaging'],
  ['Limpieza', 'Nettoyage', 'Cleaning'],
  // Motivos de merma
  ['Producto vencido', 'Produit périmé', 'Expired product'],
  ['Rotura o derrame', 'Casse ou renversement', 'Breakage or spill'],
  ['Mal estado al recibir', 'Abîmé à la réception', 'Damaged on arrival'],
  ['Error de preparación', 'Erreur de préparation', 'Preparation error'],
  ['Degustación o cortesía', 'Dégustation ou geste commercial', 'Tasting or complimentary'],
  // Presentaciones
  ['Caja 12 × 1 L', 'Carton 12 × 1 L', 'Case 12 × 1 L'],
  ['Caja 6 × 1 L', 'Carton 6 × 1 L', 'Case 6 × 1 L'],
  ['Caja 6 × 1 kg', 'Carton 6 × 1 kg', 'Case 6 × 1 kg'],
  ['Caja 5 × 1 kg', 'Carton 5 × 1 kg', 'Case 5 × 1 kg'],
  ['Caja 40 un', 'Carton 40 u', 'Case 40 pcs'],
  ['Caja 1,000 un', 'Carton 1 000 u', 'Case 1,000 pcs'],
  ['Caja 3,000 un', 'Carton 3 000 u', 'Case 3,000 pcs'],
  ['Caja 100 un', 'Boîte 100 u', 'Box 100 pcs'],
  ['Bolsa 1 kg', 'Sac 1 kg', 'Bag 1 kg'],
  ['Bolsa 2.5 kg', 'Sac 2,5 kg', 'Bag 2.5 kg'],
  ['Paquete 1 kg', 'Paquet 1 kg', 'Pack 1 kg'],
  ['Paquete 500 g', 'Paquet 500 g', 'Pack 500 g'],
  ['Paquete 500 un', 'Paquet 500 u', 'Pack 500 pcs'],
  ['Saco 25 kg', 'Sac 25 kg', 'Sack 25 kg'],
  ['Cartón 30 un', 'Plateau 30 u', 'Tray 30 pcs'],
  ['Malla 20 kg', 'Filet 20 kg', 'Net bag 20 kg'],
  ['Malla 10 kg', 'Filet 10 kg', 'Net bag 10 kg'],
  ['Garrafa 5 L', 'Bidon 5 L', 'Jug 5 L'],
  // Medios de pago y roles
  ['Transferencia ACH', 'Virement ACH', 'ACH transfer'],
  ['Tarjeta corporativa', 'Carte d’entreprise', 'Company card'],
  ['Dirección general', 'Direction générale', 'Managing director'],
  ['Contabilidad', 'Comptabilité', 'Accounting'],
  ['Gerente · San Francisco', 'Gérant · San Francisco', 'Manager · San Francisco'],
  ['Gerente · Casco Viejo', 'Gérante · Casco Viejo', 'Manager · Casco Viejo'],
  ['Gerente · Costa del Este', 'Gérante · Costa del Este', 'Manager · Costa del Este'],
  // Nombres propios (no se traducen, pero se reconocen)
  ...[
    'Tostadores del Barú', 'Lácteos La Pradera', 'Molinos del Istmo', 'Huerta Azuero', 'Empaques Canal', 'Higiene Pacífico',
    'Del Barú', 'La Pradera', 'Molinos', 'Azuero', 'Emp. Canal', 'Hig. Pacífico',
    'Casco Viejo', 'San Francisco', 'Costa del Este',
    'Antoine', 'Luis Batista', 'Mariela Quintero', 'Daniela Him', 'Rosa Pinzón', 'Luis', 'Mariela', 'Daniela', 'Rosa',
    'Ernesto Caballero', 'Yolanda Ríos', 'Rubén Castillo', 'Dalys Vergara', 'Omar Sanjur', 'Marisol Guerra',
  ].map((n): Entity => [n, n, n]),
  // Primeras palabras de ingredientes (fichas de receta abreviadas)
  ['harina', 'farine', 'flour'], ['mantequilla', 'beurre', 'butter'], ['azúcar', 'sucre', 'sugar'], ['levadura', 'levure', 'yeast'],
  ['huevos', 'œufs', 'eggs'], ['crema', 'crème', 'cream'], ['jamón', 'jambon', 'ham'], ['queso', 'fromage', 'cheese'],
  ['baguette', 'baguette', 'baguette'], ['naranjas', 'oranges', 'oranges'], ['cacao', 'cacao', 'cocoa'],
  // Fechas
  ['lunes', 'lundi', 'Monday'], ['martes', 'mardi', 'Tuesday'], ['miércoles', 'mercredi', 'Wednesday'], ['jueves', 'jeudi', 'Thursday'],
  ['viernes', 'vendredi', 'Friday'], ['sábado', 'samedi', 'Saturday'], ['domingo', 'dimanche', 'Sunday'],
  ['enero', 'janvier', 'January'], ['febrero', 'février', 'February'], ['marzo', 'mars', 'March'], ['abril', 'avril', 'April'],
  ['mayo', 'mai', 'May'], ['junio', 'juin', 'June'], ['julio', 'juillet', 'July'], ['agosto', 'août', 'August'],
  ['septiembre', 'septembre', 'September'], ['octubre', 'octobre', 'October'], ['noviembre', 'novembre', 'November'], ['diciembre', 'décembre', 'December'],
  ['lun', 'lun.', 'Mon'], ['mar', 'mar.', 'Tue'], ['mié', 'mer.', 'Wed'], ['jue', 'jeu.', 'Thu'], ['vie', 'ven.', 'Fri'], ['sáb', 'sam.', 'Sat'], ['dom', 'dim.', 'Sun'],
  ['ene', 'janv.', 'Jan'], ['feb', 'févr.', 'Feb'], ['abr', 'avr.', 'Apr'], ['jun', 'juin', 'Jun'], ['jul', 'juil.', 'Jul'],
  ['ago', 'août', 'Aug'], ['sep', 'sept.', 'Sep'], ['oct', 'oct.', 'Oct'], ['nov', 'nov.', 'Nov'], ['dic', 'déc.', 'Dec'],
];

const ENTITY_MAP = new Map<string, Entity>();
for (const e of ENTITIES) ENTITY_MAP.set(e[0].toLowerCase(), e);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ENTITY_RE = new RegExp(
  `(?<![\\p{L}\\d])(${[...ENTITY_MAP.keys()].sort((a, b) => b.length - a.length).map(esc).join('|')})(?![\\p{L}\\d])`,
  'giu',
);
const TIME_RE = /(\d{1,2}):(\d{2}) ([ap])\. m\./g;
const REF_RE = /\b(?:[A-Z]{2,4}-[A-Z0-9][\w-]*\d[\w.-]*|r-\d+|\d{6,}-\d-\d{4} DV \d+|\+507 \d{4}-\d{4})/g;
const NUM_RE = /[−+-]?\$?\d(?:[\d,.]*\d)?/g;

type Slot = { kind: '#' | '@' | '§'; value: string };

export interface Keyed {
  key: string;
  slots: Slot[];
}

/** Convierte un texto en su plantilla. */
export function toKey(text: string): Keyed {
  type Hit = { start: number; end: number; slot: Slot };
  const hits: Hit[] = [];
  const taken = (s: number, e: number) => hits.some((h) => s < h.end && e > h.start);
  const scan = (re: RegExp, kind: Slot['kind']) => {
    re.lastIndex = 0;
    for (let m; (m = re.exec(text)); ) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      if (!taken(m.index, m.index + m[0].length)) hits.push({ start: m.index, end: m.index + m[0].length, slot: { kind, value: m[0] } });
    }
  };
  scan(TIME_RE, '§');
  scan(REF_RE, '#');
  scan(ENTITY_RE, '@');
  scan(NUM_RE, '#');
  hits.sort((a, b) => a.start - b.start);
  let key = '';
  let pos = 0;
  for (const h of hits) {
    key += text.slice(pos, h.start) + h.slot.kind;
    pos = h.end;
  }
  key += text.slice(pos);
  return { key, slots: hits.map((h) => h.slot) };
}

function translateEntity(value: string, lang: Lang): string {
  const e = ENTITY_MAP.get(value.toLowerCase());
  if (!e) return value;
  const out = lang === 'fr' ? e[1] : e[2];
  // Conserva la minúscula inicial del original («de leche entera»), salvo nombres en inglés.
  if (value[0] === value[0].toLowerCase() && value[0] !== value[0].toUpperCase() && !(lang === 'en' && /day$|ary$|ber$|^(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec|March|April|May|June|July|August)$/.test(out))) {
    return out[0].toLowerCase() + out.slice(1);
  }
  return out;
}

function translateTime(value: string, lang: Lang): string {
  const m = /(\d{1,2}):(\d{2}) ([ap])/.exec(value)!;
  let h = Number(m[1]);
  if (lang === 'en') return `${h}:${m[2]} ${m[3] === 'a' ? 'AM' : 'PM'}`;
  if (m[3] === 'p' && h !== 12) h += 12;
  if (m[3] === 'a' && h === 12) h = 0;
  return `${h}:${m[2]}`;
}

function fill(template: string, slots: Slot[], lang: Lang): string {
  let i = 0;
  return template.replace(/[#@§]/g, (ch) => {
    const s = slots[i++];
    if (!s) return ch;
    if (s.kind === '@') return translateEntity(s.value, lang);
    if (s.kind === '§') return translateTime(s.value, lang);
    return lang === 'fr' && /^\d[\d,]*\.\d+$/.test(s.value) && !s.value.startsWith('$') ? s.value : s.value;
  });
}

export type Dict = Record<string, string>;

/** Traduce un texto; devuelve null si no hay traducción. */
export function translate(text: string, lang: Lang, dict: Dict): string | null {
  if (lang === 'es') return null;
  const lead = text.match(/^\s*/)![0];
  const trail = text.match(/\s*$/)![0];
  const core = text.trim();
  if (!core || !/\p{L}/u.test(core)) return null;
  const k = toKey(core);
  const t = dict[k.key];
  if (t !== undefined) return lead + fill(t, k.slots, lang) + trail;
  // Solo un nombre propio o una cifra: se traduce el nombre.
  if (/^[@#§\s·×/:,.()+\-−%$]*$/.test(k.key)) return lead + fill(k.key, k.slots, lang) + trail;
  // Frases compuestas con «·»: cada parte por separado.
  if (core.includes(' · ')) {
    const parts = core.split(' · ');
    const out = parts.map((p) => translate(p, lang, dict));
    if (out.some((x) => x !== null)) return lead + out.map((x, i) => x ?? parts[i]).join(' · ') + trail;
  }
  return null;
}
