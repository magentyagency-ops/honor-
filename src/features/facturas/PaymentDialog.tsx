import { useEffect, useState } from 'react';
import { Banknote, Info } from 'lucide-react';
import type { Invoice, PaymentMethod } from '@/domain/types';
import { PAYMENT_METHODS } from '@/data/catalog';
import { paymentReference } from '@/data/seed';
import { money, parseMoney } from '@/domain/format';
import { fmtDate, fmtDue, panamaDay } from '@/domain/time';
import { analyzeInvoice, balanceCents, paidCents, recordPayment } from '@/domain/invoices';
import { act, useDemo, useNow } from '@/store';
import { Button, Field, Input, Note, Select, cn } from '@/ui/primitives';
import { Modal } from '@/ui/overlays';

export function PaymentDialog({ invoice, onClose, presetCents }: { invoice: Invoice | null; onClose: () => void; presetCents?: number }) {
  const data = useDemo((s) => s.data);
  const today = panamaDay(useNow());
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('ach');
  const [reference, setReference] = useState('');

  const inv = invoice;
  const balance = inv ? balanceCents(data, inv) : 0;
  const paid = inv ? paidCents(data, inv.id) : 0;
  const analysis = inv ? analyzeInvoice(data, inv) : null;
  const receivedRest = analysis && analysis.order ? Math.max(0, analysis.receivedValueCents - paid) : balance;
  const showReceived = Boolean(analysis?.order) && receivedRest > 0 && receivedRest < balance;

  useEffect(() => {
    if (!inv) return;
    setDate(today);
    setAmount(((presetCents && presetCents <= balance ? presetCents : balance) / 100).toFixed(2));
    setMethod('ach');
    setReference(paymentReference('ach', `${inv.id}:${paid}`));
  }, [inv?.id, presetCents]); // eslint-disable-line react-hooks/exhaustive-deps

  const cents = parseMoney(amount);
  const tooMuch = cents !== null && cents > balance;
  const rest = cents !== null ? balance - cents : balance;
  const supplier = inv ? data.suppliers.find((s) => s.id === inv.supplierId) : undefined;

  const submit = () => {
    if (!inv || cents === null) return;
    const res = act(
      (d, ctx) => recordPayment(d, ctx, { invoiceId: inv.id, date, amountCents: cents, method, reference }),
      (p) => (p.amountCents === balance ? `Pago de ${money(p.amountCents)} registrado · factura saldada` : `Pago parcial de ${money(p.amountCents)} registrado · saldo ${money(balance - p.amountCents)}`),
    );
    if (res.ok) onClose();
  };

  return (
    <Modal
      open={Boolean(inv)}
      onOpenChange={(o) => !o && onClose()}
      tourId="pago-dialogo"
      title="Registrar pago"
      description={inv ? `Factura ${inv.number} de ${supplier?.name ?? ''} · total ${money(inv.totalCents)} · ${fmtDue(inv.dueDate, today).toLowerCase()} (${fmtDate(inv.dueDate)})` : undefined}
      footer={
        <>
          <span className="mr-auto text-[13px] text-ink-2" data-tour="pago-saldo">
            Saldo tras el pago <strong className={cn('ml-1 text-[15px] font-semibold tabular-nums', rest === 0 ? 'text-ok-700' : 'text-forest-900')}>{money(Math.max(0, rest))}</strong>
          </span>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" icon={<Banknote className="size-4" />} disabled={cents === null || cents <= 0 || tooMuch} onClick={submit} data-tour="pago-confirmar">
            Registrar pago
          </Button>
        </>
      }
    >
      <div className="grid gap-4 pb-1 sm:grid-cols-2">
        <Field
          label="Importe (USD)"
          htmlFor="pago-importe"
          className="sm:col-span-2"
          error={tooMuch ? `Supera el saldo pendiente (${money(balance)}).` : undefined}
          hint={paid > 0 ? `Ya pagado: ${money(paid)} · saldo pendiente: ${money(balance)}` : `Saldo pendiente: ${money(balance)}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[150px] flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">$</span>
              <Input id="pago-importe" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-11 pl-6 text-[17px] font-semibold tabular-nums" data-tour="pago-importe" />
            </div>
            <Button size="sm" onClick={() => setAmount((balance / 100).toFixed(2))}>Saldo completo</Button>
            {showReceived && (
              <Button size="sm" variant="secondary" onClick={() => setAmount((receivedRest / 100).toFixed(2))} data-tour="pago-recibido">
                Solo lo recibido · {money(receivedRest)}
              </Button>
            )}
          </div>
        </Field>
        <Field label="Fecha del pago" htmlFor="pago-fecha">
          <Input id="pago-fecha" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value || today)} className="tabular-nums" />
        </Field>
        <Field label="Medio de pago" htmlFor="pago-metodo">
          <Select
            id="pago-metodo"
            value={method}
            onChange={(e) => {
              const m = e.target.value as PaymentMethod;
              setMethod(m);
              if (inv) setReference(paymentReference(m, `${inv.id}:${paid}`));
            }}
          >
            {PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </Select>
        </Field>
        <Field label="Referencia" htmlFor="pago-ref" className="sm:col-span-2" hint="Número de transferencia, de cheque o de comprobante.">
          <Input id="pago-ref" value={reference} onChange={(e) => setReference(e.target.value)} className="tabular-nums" />
        </Field>
        <Note tone="neutral" icon={<Info className="size-4" />} className="sm:col-span-2">
          Esto <strong>anota</strong> un pago hecho por fuera de la plataforma. No se realiza ninguna transferencia ni se contacta con ningún banco.
        </Note>
      </div>
    </Modal>
  );
}
