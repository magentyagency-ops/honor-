import type { ReactNode } from 'react';
import { Dialog, DropdownMenu, Popover } from 'radix-ui';
import { Check, CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { Button, IconButton, cn } from './primitives';
import { dismissToast, useDemo } from '@/store';

/**
 * El panel del recorrido guiado y los avisos viven fuera de los diálogos.
 * Interactuar con ellos no debe cerrar el diálogo que esté abierto.
 */
function keepOpen(e: Event) {
  const detail = (e as CustomEvent<{ originalEvent?: Event }>).detail;
  const target = (detail?.originalEvent?.target ?? e.target) as HTMLElement | null;
  if (target?.closest?.('[data-keep-open]')) e.preventDefault();
}

function focusPanel(e: Event) {
  e.preventDefault();
  (e.currentTarget as HTMLElement | null)?.focus?.({ preventScroll: true });
}

// ───────────────────────────── Panel lateral ─────────────────────────────

export function Drawer({
  open, onOpenChange, title, description, eyebrow, children, footer, width = 'md', tourId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'md' | 'lg' | 'xl';
  tourId?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-forest-950/35 animate-fade-in" />
        <Dialog.Content
          data-tour={tourId}
          onPointerDownOutside={keepOpen}
          onInteractOutside={keepOpen}
          onFocusOutside={keepOpen}
          onOpenAutoFocus={focusPanel}
          tabIndex={-1}
          aria-describedby={undefined}
          style={{ bottom: 'var(--dock-space)' }}
          className={cn(
            'fixed right-0 top-0 z-50 flex w-full flex-col bg-paper shadow-drawer animate-slide-in focus:outline-none',
            width === 'md' && 'sm:w-[520px]',
            width === 'lg' && 'sm:w-[640px]',
            width === 'xl' && 'sm:w-[820px]',
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-line px-6 pb-4 pt-5">
            <div className="min-w-0">
              {eyebrow && <div className="eyebrow mb-1 text-brass-700">{eyebrow}</div>}
              <Dialog.Title className="serif text-[21px] font-[520] leading-tight text-forest-900">{title}</Dialog.Title>
              {description && <Dialog.Description className="mt-1 text-[13.5px] text-ink-2">{description}</Dialog.Description>}
            </div>
            <Dialog.Close asChild>
              <IconButton label="Cerrar" className="-mr-2 -mt-1">
                <X className="size-[18px]" />
              </IconButton>
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-paper px-6 py-3.5">{footer}</footer>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ───────────────────────────── Diálogo centrado ─────────────────────────────

export function Modal({
  open, onOpenChange, title, description, children, footer, size = 'md', tourId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  tourId?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-forest-950/40 animate-fade-in" />
        <Dialog.Content
          onPointerDownOutside={keepOpen}
          onInteractOutside={keepOpen}
          onFocusOutside={keepOpen}
          onOpenAutoFocus={focusPanel}
          tabIndex={-1}
          aria-describedby={undefined}
          onClick={(e) => e.target === e.currentTarget && onOpenChange(false)}
          style={{ paddingBottom: 'calc(var(--dock-space) + 16px)' }}
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 focus:outline-none"
        >
          <div
            data-tour={tourId}
            className={cn(
              'flex max-h-full w-full flex-col rounded-2xl border border-line bg-paper shadow-pop animate-pop',
              size === 'sm' && 'max-w-[420px]',
              size === 'md' && 'max-w-[520px]',
              size === 'lg' && 'max-w-[680px]',
            )}
          >
            <header className="flex items-start justify-between gap-4 px-6 pb-3 pt-5">
              <div className="min-w-0">
                <Dialog.Title className="serif text-[20px] font-[520] leading-tight text-forest-900">{title}</Dialog.Title>
                {description && <Dialog.Description className="mt-1.5 text-[13.5px] leading-snug text-ink-2">{description}</Dialog.Description>}
              </div>
              <Dialog.Close asChild>
                <IconButton label="Cerrar" className="-mr-2 -mt-1.5">
                  <X className="size-[18px]" />
                </IconButton>
              </Dialog.Close>
            </header>
            {children && <div className="min-h-0 overflow-y-auto px-6 pb-2 pt-1">{children}</div>}
            {footer && <footer className="flex flex-wrap items-center justify-end gap-2 px-6 pb-5 pt-4">{footer}</footer>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ConfirmDialog({
  open, onOpenChange, title, children, confirmLabel, cancelLabel = 'Cancelar', onConfirm, tone = 'primary',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  tone?: 'primary' | 'danger';
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{cancelLabel}</Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children && <div className="text-[13.5px] leading-relaxed text-ink-2">{children}</div>}
    </Modal>
  );
}

// ───────────────────────────── Menús ─────────────────────────────

export function Menu({ trigger, children, align = 'end', width = 240 }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' | 'center'; width?: number }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          collisionPadding={10}
          style={{ minWidth: width }}
          className="z-[60] rounded-xl border border-line bg-paper p-1.5 shadow-pop animate-pop focus:outline-none"
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuItem({ children, onSelect, icon, checked, hint, danger, disabled }: {
  children: ReactNode; onSelect?: () => void; icon?: ReactNode; checked?: boolean; hint?: ReactNode; danger?: boolean; disabled?: boolean;
}) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] outline-none data-[highlighted]:bg-linen data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        danger ? 'text-danger-700' : 'text-ink',
      )}
    >
      {icon && <span className="shrink-0 text-ink-3">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{children}</span>
        {hint && <span className="block truncate text-[12px] text-ink-3">{hint}</span>}
      </span>
      {checked && <Check className="size-4 shrink-0 text-forest-700" strokeWidth={2.5} />}
    </DropdownMenu.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="eyebrow px-2.5 pb-1 pt-2 text-ink-3">{children}</DropdownMenu.Label>;
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1.5 h-px bg-line" />;
}

export function Pop({ trigger, children, align = 'end', className, open, onOpenChange }: {
  trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' | 'center'; className?: string; open?: boolean; onOpenChange?: (o: boolean) => void;
}) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={8}
          collisionPadding={10}
          className={cn('z-[60] rounded-xl border border-line bg-paper shadow-pop animate-pop focus:outline-none', className)}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ───────────────────────────── Avisos ─────────────────────────────

export function Toaster() {
  const toasts = useDemo((s) => s.ui.toasts);
  return (
    <div
      data-keep-open
      aria-live="polite"
      className="pointer-events-none fixed left-4 z-[110] flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2 lg:left-[252px]"
      style={{ bottom: 'calc(var(--dock-space) + 16px)' }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          style={{ pointerEvents: 'auto' }}
          className="flex items-start gap-3 rounded-xl border border-forest-800 bg-forest-900 px-4 py-3 text-paper shadow-pop animate-rise"
        >
          <span className="mt-0.5 shrink-0">
            {t.kind === 'ok' && <CircleCheck className="size-[18px] text-brass-400" />}
            {t.kind === 'error' && <CircleAlert className="size-[18px] text-[#f0a391]" />}
            {t.kind === 'info' && <Info className="size-[18px] text-forest-300" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium leading-snug">{t.title}</p>
            {t.detail && <p className="mt-0.5 text-[12.5px] leading-snug text-paper/70">{t.detail}</p>}
          </div>
          <button type="button" aria-label="Cerrar aviso" onClick={() => dismissToast(t.id)} className="-mr-1 rounded p-1 text-paper/60 hover:bg-white/10 hover:text-paper">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
