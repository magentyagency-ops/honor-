import { useEffect } from 'react';
import { Dialog } from 'radix-ui';
import { Smartphone, X } from 'lucide-react';

/**
 * Vista móvil: la misma aplicación, cargada en un marco de teléfono con el perfil del gerente.
 * No es una maqueta: comparte los datos con la ventana principal, así que lo que se haga dentro
 * (pedir, recibir, enviar una factura) se refleja al instante fuera.
 */
export function PhonePreview({ path, onClose }: { path: string | null; onClose: () => void }) {
  useEffect(() => {
    if (!path) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && (e.data as { type?: string })?.type === 'sh-demo:cerrar-movil') onClose();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [path, onClose]);
  if (!path) return null;
  const allowed = ['/compras', '/inventario', '/ventas', '/facturas', '/resumen'].some((p) => path.startsWith(p)) && !path.startsWith('/facturas/pagos');
  const base = allowed ? path : '/compras';
  const src = `${base}${base.includes('?') ? '&' : '?'}frame=phone&as=u-luis`;
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[130] bg-forest-950/75 backdrop-blur-[2px] animate-fade-in" />
        <Dialog.Content aria-describedby={undefined} className="fixed inset-0 z-[131] flex items-center justify-center gap-12 p-6 focus:outline-none" onClick={(e) => e.target === e.currentTarget && onClose()}>
          <div className="hidden max-w-[320px] text-paper xl:block">
            <p className="eyebrow flex items-center gap-2 text-brass-300"><Smartphone className="size-4" /> Vista móvil</p>
            <Dialog.Title className="serif mt-2 text-[28px] font-[500] leading-tight">Lo que ve Luis en su teléfono</Dialog.Title>
            <p className="mt-3 text-[14px] leading-relaxed text-paper/75">
              Luis Batista es el gerente de San Francisco. Desde el móvil pide, registra lo que llega y envía la foto de la factura, sin pasar por un grupo de WhatsApp.
            </p>
            <p className="mt-3 text-[14px] leading-relaxed text-paper/75">
              Es la misma aplicación y los mismos datos: lo que haga aquí aparece al momento en la pantalla de Antoine.
            </p>
            <p className="mt-5 text-[12.5px] text-paper/50">Solo ve su local. Los permisos por perfil son una simulación para la demostración.</p>
          </div>
          <div className="relative h-[min(820px,calc(100dvh-48px))] w-[400px] max-w-full shrink-0 rounded-[50px] bg-[#0b1a13] p-[11px] shadow-pop ring-1 ring-white/15 animate-pop">
            <div className="flex h-full flex-col overflow-hidden rounded-[40px] bg-ivory">
              {/* Barra de estado del teléfono (decorativa) */}
              <div aria-hidden className="relative flex h-9 shrink-0 items-center justify-between px-7 text-[12px] font-semibold text-ink">
                <span>9:41</span>
                <span className="absolute left-1/2 top-[7px] h-[22px] w-[92px] -translate-x-1/2 rounded-full bg-[#0b1a13]" />
                <span className="flex items-center gap-1.5">
                  <span className="flex items-end gap-[2px]">
                    {[4, 6, 8, 10].map((h) => <span key={h} className="w-[3px] rounded-sm bg-ink" style={{ height: h }} />)}
                  </span>
                  <span className="h-[10px] w-[20px] rounded-[3px] border border-ink/70 p-px"><span className="block h-full w-[70%] rounded-[1px] bg-ink" /></span>
                </span>
              </div>
              <iframe title="Vista móvil del gerente" src={src} className="min-h-0 w-full flex-1 bg-ivory" />
            </div>
          </div>
          <Dialog.Close asChild>
            <button type="button" aria-label="Cerrar la vista móvil" className="absolute right-5 top-5 flex size-10 items-center justify-center rounded-full bg-white/10 text-paper hover:bg-white/20">
              <X className="size-5" />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
