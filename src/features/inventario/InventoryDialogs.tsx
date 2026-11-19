import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Info } from 'lucide-react';
import type { ID, LocationId } from '@/domain/types';
import { CATEGORIES, WASTE_REASONS } from '@/data/catalog';
import { displayUnit, fromDisplay, qty as fmtQty } from '@/domain/format';
import { recordCount, recordWaste, transferStock } from '@/domain/inventory';
import { stockQty } from '@/domain/selectors';
import { act, useDemo, useUser } from '@/store';
import { Button, Field, Input, Note, Select, Textarea, cn } from '@/ui/primitives';
import { Drawer, Modal } from '@/ui/overlays';

function useDefaultLocation(preset?: LocationId): LocationId {
  const user = useUser();
  return preset ?? user.locationId ?? 'cv';
}

function QtyInput({ id, value, onChange, unit }: { id: string; value: string; onChange: (v: string) => void; unit: string }) {
  return (
    <div className="relative">
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0" className="pr-10 tabular-nums" />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">{unit}</span>
    </div>
  );
}

const parse = (v: string) => {
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

// ───────────────────────────── Merma ─────────────────────────────

export function WasteDialog({ open, onClose, locationId, productId }: { open: boolean; onClose: () => void; locationId?: LocationId; productId?: ID }) {
  const data = useDemo((s) => s.data);
  const user = useUser();
  const def = useDefaultLocation(locationId);
  const [loc, setLoc] = useState<LocationId>(def);
  const [pid, setPid] = useState<ID>(productId ?? data.products[0].id);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState(WASTE_REASONS[0]);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) {
      setLoc(def);
      setPid(productId ?? data.products[0].id);
      setAmount('');
      setReason(WASTE_REASONS[0]);
      setNote('');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const p = data.products.find((x) => x.id === pid)!;
  const available = stockQty(data, loc, pid);
  const q = parse(amount);
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Registrar merma o rotura"
      description="Descuenta del inventario lo que se perdió y deja constancia del motivo."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            disabled={!(q > 0)}
            onClick={() => {
              const res = act((d, ctx) => recordWaste(d, ctx, { locationId: loc, productId: pid, qty: fromDisplay(q, p.baseUnit), reason, note }), 'Merma registrada');
              if (res.ok) onClose();
            }}
          >
            Registrar merma
          </Button>
        </>
      }
    >
      <div className="grid gap-4 pb-1 sm:grid-cols-2">
        <Field label="Local" htmlFor="merma-local">
          <Select id="merma-local" value={loc} onChange={(e) => setLoc(e.target.value as LocationId)} disabled={user.role === 'gerente'}>
            {data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <Field label="Producto" htmlFor="merma-producto">
          <Select id="merma-producto" value={pid} onChange={(e) => setPid(e.target.value)}>
            {data.products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </Field>
        <Field label="Cantidad perdida" htmlFor="merma-cantidad" hint={`Existencia teórica: ${fmtQty(available, p.baseUnit)}`}>
          <QtyInput id="merma-cantidad" value={amount} onChange={setAmount} unit={displayUnit(p.baseUnit)} />
        </Field>
        <Field label="Motivo" htmlFor="merma-motivo">
          <Select id="merma-motivo" value={reason} onChange={(e) => setReason(e.target.value)}>
            {WASTE_REASONS.map((r) => <option key={r}>{r}</option>)}
          </Select>
        </Field>
        <Field label="Comentario (opcional)" htmlFor="merma-nota" className="sm:col-span-2">
          <Textarea id="merma-nota" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="min-h-[52px]" />
        </Field>
      </div>
    </Modal>
  );
}

// ───────────────────────────── Transferencia ─────────────────────────────

export function TransferDialog({ open, onClose, locationId, productId }: { open: boolean; onClose: () => void; locationId?: LocationId; productId?: ID }) {
  const data = useDemo((s) => s.data);
  const def = useDefaultLocation(locationId);
  const [from, setFrom] = useState<LocationId>(def);
  const [to, setTo] = useState<LocationId>(def === 'cv' ? 'sf' : 'cv');
  const [pid, setPid] = useState<ID>(productId ?? data.products[0].id);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) {
      setFrom(def);
      setTo(def === 'cv' ? 'sf' : 'cv');
      setPid(productId ?? data.products[0].id);
      setAmount('');
      setNote('');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const p = data.products.find((x) => x.id === pid)!;
  const q = parse(amount);
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Transferir entre locales"
      description="Sale de un local y entra en otro en el mismo momento: el total de la empresa no cambia."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            disabled={!(q > 0) || from === to}
            onClick={() => {
              const res = act((d, ctx) => transferStock(d, ctx, { from, to, productId: pid, qty: fromDisplay(q, p.baseUnit), note }), 'Transferencia registrada');
              if (res.ok) onClose();
            }}
          >
            Registrar transferencia
          </Button>
        </>
      }
    >
      <div className="grid gap-4 pb-1">
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <Field label="Desde" htmlFor="tr-desde" hint={`Tiene ${fmtQty(stockQty(data, from, pid), p.baseUnit)}`}>
            <Select id="tr-desde" value={from} onChange={(e) => setFrom(e.target.value as LocationId)}>
              {data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <ArrowRight className="mb-8 size-4 text-ink-3" />
          <Field label="Hacia" htmlFor="tr-hacia" hint={`Tiene ${fmtQty(stockQty(data, to, pid), p.baseUnit)}`} error={from === to ? 'Elige un local distinto' : undefined}>
            <Select id="tr-hacia" value={to} onChange={(e) => setTo(e.target.value as LocationId)}>
              {data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Producto" htmlFor="tr-producto">
            <Select id="tr-producto" value={pid} onChange={(e) => setPid(e.target.value)}>
              {data.products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
          <Field label="Cantidad" htmlFor="tr-cantidad">
            <QtyInput id="tr-cantidad" value={amount} onChange={setAmount} unit={displayUnit(p.baseUnit)} />
          </Field>
        </div>
        <Field label="Comentario (opcional)" htmlFor="tr-nota">
          <Input id="tr-nota" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Por ejemplo: préstamo hasta la próxima entrega" />
        </Field>
      </div>
    </Modal>
  );
}

// ───────────────────────────── Conteo físico ─────────────────────────────

export function CountDrawer({ open, onClose, locationId }: { open: boolean; onClose: () => void; locationId?: LocationId }) {
  const data = useDemo((s) => s.data);
  const user = useUser();
  const def = useDefaultLocation(locationId);
  const [loc, setLoc] = useState<LocationId>(def);
  const [cat, setCat] = useState<string>('todas');
  const [counted, setCounted] = useState<Record<ID, string>>({});
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) {
      setLoc(def);
      setCounted({});
      setNote('');
      setCat('todas');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const lines = useMemo(
    () =>
      Object.entries(counted)
        .filter(([, v]) => v.trim() !== '' && parse(v) >= 0)
        .map(([productId, v]) => {
          const p = data.products.find((x) => x.id === productId)!;
          return { productId, counted: fromDisplay(parse(v), p.baseUnit) };
        }),
    [counted, data.products],
  );
  const products = data.products.filter((p) => cat === 'todas' || p.category === cat);

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => !o && onClose()}
      width="lg"
      eyebrow="Conteo físico"
      title="Contar lo que hay de verdad"
      description="Introduce solo los productos que hayas contado. La diferencia con la existencia teórica se registra como ajuste, con su explicación."
      footer={
        <>
          <span className="mr-auto text-[13px] text-ink-3">{lines.length === 0 ? 'Ningún producto contado todavía' : `${lines.length} productos contados`}</span>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            disabled={lines.length === 0}
            onClick={() => {
              const res = act((d, ctx) => recordCount(d, ctx, { locationId: loc, lines, note }), (c) => `Conteo ${c.id} registrado`);
              if (res.ok) onClose();
            }}
          >
            Registrar conteo
          </Button>
        </>
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Field label="Local" htmlFor="conteo-local">
          <Select id="conteo-local" value={loc} onChange={(e) => { setLoc(e.target.value as LocationId); setCounted({}); }} disabled={user.role === 'gerente'}>
            {data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <Field label="Categoría" htmlFor="conteo-categoria">
          <Select id="conteo-categoria" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="todas">Todas</option>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
        </Field>
      </div>
      <Note tone="forest" icon={<Info className="size-4" />} className="mb-4">
        El primer conteo de un producto es su <strong>inventario inicial</strong>. Sin él, el historial de compras no basta para saber cuánto había al empezar.
      </Note>
      <ul className="divide-y divide-line/80 rounded-xl border border-line bg-white/60">
        {products.map((p) => {
          const theoretical = stockQty(data, loc, p.id);
          const raw = counted[p.id] ?? '';
          const n = parse(raw);
          const diff = raw.trim() !== '' && n >= 0 ? fromDisplay(n, p.baseUnit) - theoretical : null;
          return (
            <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_112px] items-center gap-3 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_110px_112px_96px]">
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-medium text-ink">{p.name}</p>
                <p className="text-[12px] text-ink-3 sm:hidden">Teórico {fmtQty(theoretical, p.baseUnit)}</p>
              </div>
              <p className="hidden text-right text-[13px] tabular-nums text-ink-2 sm:block">
                {fmtQty(theoretical, p.baseUnit)}
                <span className="block text-[11.5px] text-ink-3">teórico</span>
              </p>
              <QtyInput id={`conteo-${p.id}`} value={raw} onChange={(v) => setCounted((c) => ({ ...c, [p.id]: v }))} unit={displayUnit(p.baseUnit)} />
              <p className={cn('hidden text-right text-[13px] font-medium tabular-nums sm:block', diff === null ? 'text-ink-4' : Math.abs(diff) < 1e-6 ? 'text-ok-700' : 'text-warn-800')}>
                {diff === null ? '—' : Math.abs(diff) < 1e-6 ? 'Sin diferencia' : fmtQty(diff, p.baseUnit, { sign: true })}
              </p>
            </li>
          );
        })}
      </ul>
      <Field label="Comentario del conteo (opcional)" htmlFor="conteo-nota" className="mt-4">
        <Textarea id="conteo-nota" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="min-h-[52px]" />
      </Field>
    </Drawer>
  );
}

