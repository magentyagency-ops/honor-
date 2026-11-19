import type {
  Ctx, DemoData, ID, LocationId, MovementType, Recipe, RecipeIngredient, StockCount, StockSetting,
} from './types';
import { DomainError } from './types';
import { audit, locationOf, nextId, productOf, requireUser, stockKey, stockOf } from './core';
import { qty as fmtQty } from './format';

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  inventario_inicial: 'Inventario inicial',
  recepcion: 'Recepción de proveedor',
  venta: 'Consumo por ventas',
  merma: 'Merma o rotura',
  transferencia_salida: 'Transferencia · salida',
  transferencia_entrada: 'Transferencia · entrada',
  ajuste_conteo: 'Ajuste por conteo físico',
};

function assertCanOperate(d: DemoData, ctx: Ctx, locationId: LocationId) {
  const user = requireUser(d, ctx);
  if (user.role === 'contabilidad') throw new DomainError('Contabilidad no registra movimientos de inventario.');
  if (user.role === 'gerente' && user.locationId !== locationId) {
    throw new DomainError('Un gerente solo opera el inventario de su local.');
  }
  return user;
}

// ───────────────────────────── Mermas ─────────────────────────────

export function recordWaste(
  d: DemoData,
  ctx: Ctx,
  input: { locationId: LocationId; productId: ID; qty: number; reason: string; note?: string },
): void {
  assertCanOperate(d, ctx, input.locationId);
  const p = productOf(d, input.productId);
  if (!(input.qty > 0)) throw new DomainError('Indica una cantidad mayor que cero.');
  if (!input.reason.trim()) throw new DomainError('Indica el motivo de la merma.');
  const available = stockOf(d, input.locationId, input.productId);
  if (input.qty > available + 1e-6) {
    throw new DomainError(`La merma (${fmtQty(input.qty, p.baseUnit)}) supera la existencia teórica (${fmtQty(available, p.baseUnit)}). Haz antes un conteo físico.`);
  }
  d.movements.push({
    id: nextId(d, 'movimiento'), at: ctx.now, locationId: input.locationId, productId: p.id,
    type: 'merma', qty: -input.qty, reason: input.reason.trim(), note: input.note?.trim() || undefined, by: ctx.userId,
  });
  audit(d, ctx, 'inventario', 'inventario.merma', `Merma de ${fmtQty(input.qty, p.baseUnit)} de ${p.name} en ${locationOf(d, input.locationId).name} · ${input.reason.trim()}`, {
    entityId: p.id, locationId: input.locationId,
  });
}

// ───────────────────────────── Transferencias ─────────────────────────────

export function transferStock(
  d: DemoData,
  ctx: Ctx,
  input: { from: LocationId; to: LocationId; productId: ID; qty: number; note?: string },
): ID {
  const user = requireUser(d, ctx);
  if (user.role === 'contabilidad') throw new DomainError('Contabilidad no registra transferencias.');
  if (user.role === 'gerente' && user.locationId !== input.from && user.locationId !== input.to) {
    throw new DomainError('Un gerente solo transfiere desde o hacia su local.');
  }
  if (input.from === input.to) throw new DomainError('El origen y el destino deben ser locales distintos.');
  if (!(input.qty > 0)) throw new DomainError('Indica una cantidad mayor que cero.');
  const p = productOf(d, input.productId);
  const available = stockOf(d, input.from, input.productId);
  if (input.qty > available + 1e-6) {
    throw new DomainError(`${locationOf(d, input.from).name} solo tiene ${fmtQty(available, p.baseUnit)} de ${p.name}.`);
  }
  const id = nextId(d, 'transferencia');
  const from = locationOf(d, input.from).name;
  const to = locationOf(d, input.to).name;
  const base = { at: ctx.now, productId: p.id, refKind: 'transferencia' as const, refId: id, note: input.note?.trim() || undefined, by: ctx.userId };
  d.movements.push({ ...base, id: nextId(d, 'movimiento'), locationId: input.from, type: 'transferencia_salida', qty: -input.qty, reason: `Hacia ${to}` });
  d.movements.push({ ...base, id: nextId(d, 'movimiento'), locationId: input.to, type: 'transferencia_entrada', qty: input.qty, reason: `Desde ${from}` });
  audit(d, ctx, 'inventario', 'inventario.transferencia', `Transferencia ${id}: ${fmtQty(input.qty, p.baseUnit)} de ${p.name} de ${from} a ${to}`, {
    entityId: id, locationId: input.from,
  });
  return id;
}

// ───────────────────────────── Conteos físicos ─────────────────────────────

/**
 * Conteo físico: compara lo contado con la existencia teórica y registra la diferencia como ajuste.
 * El primer conteo de un producto en un local es su inventario inicial: sin él, el historial de
 * compras no basta para conocer el stock de partida.
 */
export function recordCount(
  d: DemoData,
  ctx: Ctx,
  input: { locationId: LocationId; lines: { productId: ID; counted: number }[]; note?: string },
): StockCount {
  assertCanOperate(d, ctx, input.locationId);
  if (input.lines.length === 0) throw new DomainError('Introduce al menos un producto contado.');
  const count: StockCount = {
    id: nextId(d, 'conteo'), locationId: input.locationId, at: ctx.now, by: ctx.userId, kind: 'ciclico', lines: [], note: input.note?.trim() || undefined,
  };
  let adjusted = 0;
  let allInitial = true;
  for (const l of input.lines) {
    const p = productOf(d, l.productId);
    if (!(l.counted >= 0)) throw new DomainError(`La cantidad contada de ${p.name} no es válida.`);
    const theoretical = stockOf(d, input.locationId, p.id);
    const hasHistory = d.movements.some((m) => m.locationId === input.locationId && m.productId === p.id);
    if (hasHistory) allInitial = false;
    count.lines.push({ productId: p.id, theoreticalBase: theoretical, countedBase: l.counted });
    const diff = Math.round((l.counted - theoretical) * 1000) / 1000;
    if (Math.abs(diff) < 1e-6) continue;
    adjusted++;
    d.movements.push({
      id: nextId(d, 'movimiento'), at: ctx.now, locationId: input.locationId, productId: p.id,
      type: hasHistory ? 'ajuste_conteo' : 'inventario_inicial', qty: diff,
      refKind: 'conteo', refId: count.id,
      reason: hasHistory ? `Teórico ${fmtQty(theoretical, p.baseUnit)} → contado ${fmtQty(l.counted, p.baseUnit)}` : 'Primer conteo del producto',
      by: ctx.userId,
    });
  }
  if (allInitial) count.kind = 'inicial';
  d.counts.push(count);
  audit(
    d, ctx, 'inventario', 'inventario.conteo',
    `Conteo físico ${count.id} en ${locationOf(d, input.locationId).name}: ${input.lines.length} productos contados, ${adjusted} con ajuste`,
    { entityId: count.id, locationId: input.locationId },
  );
  return count;
}

// ───────────────────────────── Mínimos ─────────────────────────────

export function updateStockSetting(d: DemoData, ctx: Ctx, locationId: LocationId, productId: ID, setting: StockSetting): void {
  assertCanOperate(d, ctx, locationId);
  const p = productOf(d, productId);
  if (!(setting.minBase >= 0) || !(setting.parBase >= setting.minBase)) {
    throw new DomainError('El nivel objetivo debe ser igual o superior al mínimo.');
  }
  d.stockSettings[stockKey(locationId, productId)] = { minBase: setting.minBase, parBase: setting.parBase };
  audit(d, ctx, 'inventario', 'inventario.minimo', `Mínimo de ${p.name} en ${locationOf(d, locationId).name}: ${fmtQty(setting.minBase, p.baseUnit)} (objetivo ${fmtQty(setting.parBase, p.baseUnit)})`, {
    entityId: p.id, locationId,
  });
}

// ───────────────────────────── Recetas ─────────────────────────────

function cleanIngredients(d: DemoData, ingredients: RecipeIngredient[]): RecipeIngredient[] {
  const seen = new Set<ID>();
  const out: RecipeIngredient[] = [];
  for (const ing of ingredients) {
    productOf(d, ing.productId);
    if (!(ing.qty > 0)) throw new DomainError('Cada ingrediente necesita una cantidad mayor que cero.');
    if (seen.has(ing.productId)) throw new DomainError('Un ingrediente está repetido en la receta.');
    seen.add(ing.productId);
    out.push({ productId: ing.productId, qty: ing.qty });
  }
  return out;
}

export function saveRecipe(
  d: DemoData,
  ctx: Ctx,
  input: { id?: ID; name: string; ingredients: RecipeIngredient[] },
): Recipe {
  const user = requireUser(d, ctx);
  if (user.role === 'contabilidad') throw new DomainError('Contabilidad no modifica recetas.');
  const name = input.name.trim();
  if (!name) throw new DomainError('La receta necesita un nombre.');
  const ingredients = cleanIngredients(d, input.ingredients);
  if (ingredients.length === 0) throw new DomainError('Añade al menos un ingrediente.');
  const existing = input.id ? d.recipes.find((r) => r.id === input.id) : undefined;
  if (existing) {
    existing.name = name;
    existing.ingredients = ingredients;
    existing.updatedAt = ctx.now;
    existing.updatedBy = ctx.userId;
    audit(d, ctx, 'receta', 'receta.modificada', `Receta «${name}» modificada (${ingredients.length} ingredientes). Se aplica a las ventas futuras.`, { entityId: existing.id });
    return existing;
  }
  const recipe: Recipe = { id: nextId(d, 'receta'), name, ingredients, updatedAt: ctx.now, updatedBy: ctx.userId };
  d.recipes.push(recipe);
  audit(d, ctx, 'receta', 'receta.creada', `Receta «${name}» creada (${ingredients.length} ingredientes)`, { entityId: recipe.id });
  return recipe;
}
