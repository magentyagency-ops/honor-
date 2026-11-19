import { Fragment, useEffect, useRef } from 'react';
import { CheckCheck, Clock3, FlaskConical, Send } from 'lucide-react';
import type { PurchaseOrder, WaMessage } from '@/domain/types';
import { composeOrderMessage, composeSupplierReply } from '@/domain/purchasing';
import { fmtTime, fmtWhen } from '@/domain/time';
import { sendOrderViaWhatsApp, useDemo, useNow, useUser } from '@/store';
import { Button, cn } from '@/ui/primitives';

/** Negritas al estilo de WhatsApp: *texto*. */
function rich(text: string) {
  return text.split('\n').map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {line.split(/(\*[^*]+\*)/g).map((part, j) =>
        part.startsWith('*') && part.endsWith('*') && part.length > 2 ? <strong key={j} className="font-semibold">{part.slice(1, -1)}</strong> : <Fragment key={j}>{part}</Fragment>,
      )}
    </Fragment>
  ));
}

function Bubble({ out, children, meta, draft }: { out: boolean; children: React.ReactNode; meta: React.ReactNode; draft?: boolean }) {
  return (
    <div className={cn('flex', out ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[88%] rounded-xl px-3 py-2 text-[13px] leading-[1.45] shadow-[0_1px_0.5px_rgb(0_0_0/0.13)]',
          out ? 'rounded-tr-sm bg-[#dcf2d0] text-[#16261d]' : 'rounded-tl-sm bg-white text-ink',
          draft && 'border border-dashed border-forest-500/60 bg-[#eef6e8] shadow-none',
        )}
      >
        <div className="break-words" data-no-i18n>{children}</div>
        <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-ink-3">{meta}</div>
      </div>
    </div>
  );
}

/**
 * Conversación con el proveedor. Es una simulación fiel del mensaje que se enviaría:
 * ningún mensaje sale de la aplicación.
 */
export function WhatsAppThread({ order }: { order: PurchaseOrder }) {
  const data = useDemo((s) => s.data);
  const sending = useDemo((s) => s.ui.sending[order.id]);
  const awaiting = useDemo((s) => s.ui.awaitingReply[order.id]);
  const now = useNow();
  const user = useUser();
  const supplier = data.suppliers.find((s) => s.id === order.supplierId)!;

  let messages: WaMessage[] = data.waMessages.filter((m) => m.orderId === order.id);
  if (messages.length === 0 && order.sentAt) {
    // Pedidos del historial: se reconstruye la conversación a partir del propio pedido.
    messages = [{ id: `${order.id}-out`, threadId: supplier.id, direction: 'out', at: order.sentAt, body: composeOrderMessage(data, order), orderId: order.id, status: 'leido', simulated: true }];
    if (order.confirmedAt) {
      messages.push({ id: `${order.id}-in`, threadId: supplier.id, direction: 'in', at: order.confirmedAt, body: composeSupplierReply(data, order), orderId: order.id, status: 'leido', simulated: true });
    }
  }
  const isDraft = order.status === 'aprobado' || order.status === 'pendiente_aprobacion' || order.status === 'borrador';
  const scroller = useRef<HTMLDivElement>(null);
  const count = messages.length;
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: count > 1 ? 'smooth' : 'auto' });
  }, [count, sending, awaiting]);
  const canSend = order.status === 'aprobado' && user.role !== 'contabilidad';

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-paper shadow-panel" data-tour="wa-panel">
      <div className="flex items-center gap-3 bg-forest-800 px-4 py-3 text-paper">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-paper/15 text-[13px] font-semibold">
          {supplier.name.split(' ').filter((w) => w.length > 2).slice(0, 2).map((w) => w[0]).join('')}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium leading-tight">{supplier.name}</p>
          <p className="truncate text-[12px] leading-tight text-paper/70">
            {supplier.contactName} · {supplier.whatsapp}
          </p>
        </div>
        <span className="inline-flex h-6 items-center gap-1 rounded-full bg-brass-400/20 px-2 text-[11.5px] font-medium text-brass-300">
          <FlaskConical className="size-3" /> WhatsApp simulado
        </span>
      </div>

      <div ref={scroller} className="wa-bg max-h-[400px] space-y-2 overflow-y-auto px-3.5 py-4" aria-live="polite">
        {messages.map((m) => (
          <Bubble
            key={m.id}
            out={m.direction === 'out'}
            meta={
              <>
                {fmtWhen(m.at, now)}
                {m.direction === 'out' && <CheckCheck className="size-3.5 text-info-700" aria-label="Entregado" />}
              </>
            }
          >
            {rich(m.body)}
          </Bubble>
        ))}

        {isDraft && !sending && (
          <Bubble out draft meta={<span>{order.status === 'aprobado' ? 'Listo para enviar' : order.status === 'borrador' ? 'Borrador' : 'Se enviará tras la aprobación'}</span>}>
            {rich(composeOrderMessage(data, order))}
          </Bubble>
        )}
        {sending && (
          <Bubble out meta={<><span>Enviando…</span><Clock3 className="size-3" /></>}>
            {rich(composeOrderMessage(data, order))}
          </Bubble>
        )}
        {awaiting && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1 rounded-xl rounded-tl-sm bg-white px-3.5 py-3 shadow-[0_1px_0.5px_rgb(0_0_0/0.13)]" aria-label={`${supplier.contactName} está escribiendo`}>
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1.5 animate-bounce rounded-full bg-ink-4" style={{ animationDelay: `${i * 140}ms` }} />
              ))}
            </div>
          </div>
        )}
        {messages.length === 0 && !isDraft && !sending && <p className="py-6 text-center text-[12.5px] text-ink-3">Este pedido no llegó a enviarse.</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
        <p className="min-w-0 flex-1 basis-[200px] text-[12px] leading-snug text-ink-3">
          {order.status === 'aprobado'
            ? 'Vista previa del mensaje. Al enviar se registra en la plataforma; no sale ningún WhatsApp real.'
            : order.status === 'pendiente_aprobacion'
              ? 'El mensaje queda preparado y se podrá enviar cuando Dirección apruebe el pedido.'
              : order.status === 'enviado' && !awaiting
                ? `Enviado a las ${fmtTime(order.sentAt!)}. A la espera de la confirmación del proveedor.`
                : 'Mensajes simulados para la demostración. Las respuestas del proveedor también lo son.'}
        </p>
        {canSend && (
          <Button variant="primary" icon={<Send className="size-4" />} loading={sending} onClick={() => void sendOrderViaWhatsApp(order.id)} data-tour="wa-send">
            Simular envío
          </Button>
        )}
      </div>
    </div>
  );
}
