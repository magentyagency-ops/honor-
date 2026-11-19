import { useEffect, useState } from 'react';
import { ChefHat, Info, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ID, Recipe } from '@/domain/types';
import { userName } from '@/domain/core';
import { costPerBase, money, percent, qtyBase } from '@/domain/format';
import { fmtDate } from '@/domain/time';
import { saveRecipe } from '@/domain/inventory';
import { act, useDemo, useUser } from '@/store';
import { Badge, Button, Field, Input, Note, Panel, Select, cn } from '@/ui/primitives';
import { Modal } from '@/ui/overlays';

export function recipeCostCents(products: { id: ID; offer: { priceCents: number; pack: { baseQty: number } } }[], recipe: Recipe): number {
  return recipe.ingredients.reduce((t, ing) => {
    const p = products.find((x) => x.id === ing.productId);
    return t + (p ? ing.qty * costPerBase(p as never) : 0);
  }, 0);
}

interface Draft {
  id?: ID;
  name: string;
  ingredients: { productId: ID; qty: string }[];
}

export function RecipeEditor({ open, onClose, recipe, presetName, onSaved }: {
  open: boolean; onClose: () => void; recipe?: Recipe; presetName?: string; onSaved?: (id: ID) => void;
}) {
  const data = useDemo((s) => s.data);
  const [draft, setDraft] = useState<Draft>({ name: '', ingredients: [] });
  useEffect(() => {
    if (!open) return;
    setDraft(
      recipe
        ? { id: recipe.id, name: recipe.name, ingredients: recipe.ingredients.map((i) => ({ productId: i.productId, qty: String(i.qty) })) }
        : { name: presetName ?? '', ingredients: [{ productId: data.products[0].id, qty: '' }] },
    );
  }, [open, recipe?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const used = new Set(draft.ingredients.map((i) => i.productId));
  const setIng = (idx: number, patch: Partial<Draft['ingredients'][number]>) =>
    setDraft((d) => ({ ...d, ingredients: d.ingredients.map((x, i) => (i === idx ? { ...x, ...patch } : x)) }));
  const cost = draft.ingredients.reduce((t, i) => {
    const p = data.products.find((x) => x.id === i.productId);
    const q = Number(i.qty.replace(',', '.'));
    return t + (p && q > 0 ? q * costPerBase(p) : 0);
  }, 0);

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={recipe ? `Editar receta · ${recipe.name}` : 'Nueva receta'}
      description="Cantidad de cada ingrediente por unidad vendida, en la unidad de inventario del producto (g, ml o unidades)."
      footer={
        <>
          <span className="mr-auto text-[13px] text-ink-2">
            Costo teórico <strong className="ml-1 tabular-nums text-forest-900">{money(Math.round(cost))}</strong>
          </span>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            onClick={() => {
              const res = act(
                (d, ctx) =>
                  saveRecipe(d, ctx, {
                    id: draft.id,
                    name: draft.name,
                    ingredients: draft.ingredients.filter((i) => i.qty.trim() !== '').map((i) => ({ productId: i.productId, qty: Number(i.qty.replace(',', '.')) })),
                  }),
                'Receta guardada',
              );
              if (res.ok) {
                onSaved?.(res.value.id);
                onClose();
              }
            }}
          >
            Guardar receta
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-1">
        <Field label="Nombre de la receta" htmlFor="receta-nombre">
          <Input id="receta-nombre" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Por ejemplo: Limonada de hierbabuena" />
        </Field>
        <div>
          <p className="mb-1.5 text-[12.5px] font-medium text-ink-2">Ingredientes</p>
          <ul className="space-y-2">
            {draft.ingredients.map((ing, idx) => {
              const p = data.products.find((x) => x.id === ing.productId)!;
              return (
                <li key={idx} className="grid grid-cols-[minmax(0,1fr)_112px_36px] items-center gap-2">
                  <Select value={ing.productId} onChange={(e) => setIng(idx, { productId: e.target.value })} aria-label={`Ingrediente ${idx + 1}`}>
                    {data.products.map((x) => (
                      <option key={x.id} value={x.id} disabled={used.has(x.id) && x.id !== ing.productId}>{x.name}</option>
                    ))}
                  </Select>
                  <div className="relative">
                    <Input inputMode="decimal" value={ing.qty} onChange={(e) => setIng(idx, { qty: e.target.value })} placeholder="0" aria-label={`Cantidad de ${p.name}`} className="pr-9 tabular-nums" />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">{p.baseUnit}</span>
                  </div>
                  <button
                    type="button"
                    aria-label={`Quitar ${p.name}`}
                    onClick={() => setDraft((d) => ({ ...d, ingredients: d.ingredients.filter((_, i) => i !== idx) }))}
                    className="flex size-9 items-center justify-center rounded-lg text-ink-3 hover:bg-linen hover:text-danger-700"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            icon={<Plus className="size-3.5" />}
            onClick={() => {
              const free = data.products.find((x) => !used.has(x.id));
              if (free) setDraft((d) => ({ ...d, ingredients: [...d.ingredients, { productId: free.id, qty: '' }] }));
            }}
          >
            Añadir ingrediente
          </Button>
        </div>
        <Note tone="neutral" icon={<Info className="size-4" />}>
          El cambio se aplica a las ventas que se sincronicen a partir de ahora. Lo ya descontado no se recalcula: así el historial sigue siendo explicable.
        </Note>
      </div>
    </Modal>
  );
}

export function RecipesTab() {
  const data = useDemo((s) => s.data);
  const user = useUser();
  const [editing, setEditing] = useState<Recipe | 'new' | null>(null);
  const canEdit = user.role !== 'contabilidad';
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[72ch] text-[13.5px] text-ink-2">
          Cada artículo vendido en caja descuenta del inventario los ingredientes de su receta, en el local donde se vendió. Las cantidades son hipótesis de demostración y se pueden ajustar.
        </p>
        <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')} disabledReason={!canEdit && 'Contabilidad no modifica recetas.'}>
          Nueva receta
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {data.recipes.map((r) => {
          const cost = recipeCostCents(data.products, r);
          const items = data.posItems.filter((i) => i.mapping === 'receta' && i.recipeId === r.id);
          const price = items[0]?.priceCents;
          return (
            <Panel key={r.id} className="flex flex-col" data-tour={`receta-${r.id}`}>
              <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
                <div className="min-w-0">
                  <h3 className="serif flex items-center gap-2 text-[17px] font-[520] leading-tight text-forest-900">
                    <ChefHat className="size-4 shrink-0 text-brass-600" strokeWidth={1.8} />
                    <span className="truncate">{r.name}</span>
                  </h3>
                  <p className="mt-1 text-[12px] text-ink-3">
                    Actualizada el {fmtDate(r.updatedAt)} por {userName(data, r.updatedBy)}
                  </p>
                </div>
                <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(r)} disabledReason={!canEdit && 'Contabilidad no modifica recetas.'}>
                  Editar
                </Button>
              </div>
              <ul className="flex-1 divide-y divide-line/70 px-5">
                {r.ingredients.map((ing) => {
                  const p = data.products.find((x) => x.id === ing.productId)!;
                  return (
                    <li key={ing.productId} className="flex items-center justify-between gap-3 py-2 text-[13.5px]">
                      <span className="truncate text-ink-2">{p.name}</span>
                      <span className="flex items-baseline gap-3">
                        <span className="font-medium tabular-nums text-ink">{qtyBase(ing.qty, p.baseUnit)}</span>
                        <span className="w-12 text-right text-[12px] tabular-nums text-ink-3">{money(Math.round(ing.qty * costPerBase(p)))}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3 text-[12.5px]">
                <span className="flex flex-wrap gap-1.5">
                  {items.length === 0 ? <Badge>Sin artículo de caja asociado</Badge> : items.map((i) => <Badge key={i.id} tone="forest">{i.name}</Badge>)}
                </span>
                <span className={cn('tabular-nums text-ink-2')}>
                  Costo <strong className="font-semibold text-ink">{money(Math.round(cost))}</strong>
                  {price ? <span className="text-ink-3"> · {percent(cost / price, 0)} del precio</span> : null}
                </span>
              </div>
            </Panel>
          );
        })}
      </div>
      <RecipeEditor open={editing !== null} onClose={() => setEditing(null)} recipe={editing && editing !== 'new' ? editing : undefined} />
    </div>
  );
}
