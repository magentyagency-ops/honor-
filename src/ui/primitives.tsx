import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { Tooltip } from 'radix-ui';
import { LoaderCircle, Minus, Plus } from 'lucide-react';
import type { LocationId } from '@/domain/types';

export const cn = clsx;

// ───────────────────────────── Tooltip ─────────────────────────────

export function Tip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  if (!content) return <>{children}</>;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={10}
          className="z-[120] max-w-[280px] rounded-lg bg-forest-950 px-2.5 py-1.5 text-[12.5px] leading-snug text-paper shadow-pop animate-fade-in"
        >
          {content}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

// ───────────────────────────── Botones ─────────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'brass' | 'danger' | 'inverse';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-forest-700 text-paper hover:bg-forest-800 active:bg-forest-900 shadow-[inset_0_1px_0_rgb(255_255_255/0.1)]',
  secondary: 'bg-paper text-ink border border-line-strong hover:bg-linen active:bg-sand',
  ghost: 'text-ink-2 hover:bg-linen hover:text-ink active:bg-sand',
  brass: 'bg-brass-500 text-forest-950 hover:bg-brass-400 active:bg-brass-600 shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]',
  danger: 'bg-paper text-danger-700 border border-danger-100 hover:bg-danger-50',
  inverse: 'bg-white/10 text-paper hover:bg-white/15 active:bg-white/20 border border-white/15',
};
const SIZE: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-[13px] gap-1.5',
  md: 'h-9 px-3.5 text-[13.5px] gap-2',
  lg: 'h-11 px-5 text-[15px] gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  /** Si se indica, el botón queda inactivo y explica por qué al pasar el cursor o enfocarlo. */
  disabledReason?: string | false;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, iconRight, disabledReason, block, className, children, onClick, disabled, type, ...rest },
  ref,
) {
  const blocked = Boolean(disabledReason);
  const btn = (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-disabled={blocked || undefined}
      onClick={blocked ? (e) => e.preventDefault() : onClick}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        SIZE[size],
        VARIANT[variant],
        blocked && 'cursor-not-allowed opacity-50',
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
      {iconRight}
    </button>
  );
  return blocked ? <Tip content={disabledReason}>{btn}</Tip> : btn;
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tone?: 'default' | 'inverse'; size?: 'sm' | 'md' }>(
  function IconButton({ label, tone = 'default', size = 'md', className, children, ...rest }, ref) {
    return (
      <Tip content={label}>
        <button
          ref={ref}
          type="button"
          aria-label={label}
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-lg transition-colors',
            size === 'md' ? 'size-9' : 'size-7',
            tone === 'default' ? 'text-ink-2 hover:bg-linen hover:text-ink' : 'text-paper/80 hover:bg-white/10 hover:text-paper',
            className,
          )}
          {...rest}
        >
          {children}
        </button>
      </Tip>
    );
  },
);

// ───────────────────────────── Etiquetas ─────────────────────────────

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'brass' | 'forest';

const TONE: Record<Tone, string> = {
  neutral: 'bg-linen text-ink-2 ring-line-strong/60',
  ok: 'bg-ok-50 text-ok-700 ring-ok-100',
  warn: 'bg-warn-50 text-warn-800 ring-warn-100',
  danger: 'bg-danger-50 text-danger-800 ring-danger-100',
  info: 'bg-info-50 text-info-700 ring-info-100',
  brass: 'bg-brass-50 text-brass-800 ring-brass-200',
  forest: 'bg-forest-50 text-forest-700 ring-forest-200',
};

export function Badge({ tone = 'neutral', icon, children, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full px-2 font-sans text-[12px] font-medium leading-none tracking-normal ring-1 ring-inset [font-variation-settings:normal]', TONE[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

// ───────────────────────────── Estructura ─────────────────────────────

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1.5 text-brass-700">{eyebrow}</div>}
        <h1 className="serif text-[28px] font-[520] leading-[1.15] text-forest-900 sm:text-[30px]">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-[68ch] text-[14px] text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn('rounded-xl border border-line bg-paper shadow-panel', className)} {...rest}>
      {children}
    </section>
  );
}

export function PanelHeader({ title, hint, actions, className }: { title: ReactNode; hint?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5', className)}>
      <div className="min-w-0">
        <h2 className="serif text-[18px] font-[520] leading-tight text-forest-900">{title}</h2>
        {hint && <p className="mt-0.5 text-[12.5px] text-ink-3">{hint}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, hint, actions, className }: { children: ReactNode; hint?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-end justify-between gap-3', className)}>
      <div>
        <h2 className="serif text-[19px] font-[520] leading-tight text-forest-900">{children}</h2>
        {hint && <p className="mt-0.5 text-[13px] text-ink-3">{hint}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      {icon && <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-brass-50 text-brass-700 ring-1 ring-inset ring-brass-200">{icon}</div>}
      <p className="serif text-[17px] font-[520] text-forest-900">{title}</p>
      {children && <p className="mt-1 max-w-[46ch] text-[13.5px] text-ink-3">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Note({ tone = 'neutral', icon, children, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-[13px] leading-snug ring-1 ring-inset', TONE[tone], className)}>
      {icon && <span className="mt-px shrink-0">{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn('size-4 animate-spin', className)} aria-hidden />;
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn('border-0 border-t border-line', className)} />;
}

// ───────────────────────────── Tablas ─────────────────────────────

export function Table({ children, className, minWidth }: { children: ReactNode; className?: string; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full border-separate border-spacing-0 text-[13.5px]', className)} style={minWidth ? { minWidth } : undefined}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, align = 'left', className, ...rest }: { children?: ReactNode; align?: 'left' | 'right' | 'center'; className?: string } & React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap border-b border-line bg-paper px-3 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-3 first:pl-5 last:pr-5',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({ children, align = 'left', className, num, ...rest }: { children?: ReactNode; align?: 'left' | 'right' | 'center'; className?: string; num?: boolean } & React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn(
        'border-b border-line/70 px-3 py-2.5 align-middle first:pl-5 last:pr-5',
        (align === 'right' || num) && 'text-right',
        align === 'center' && 'text-center',
        num && 'tabular-nums',
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  );
}

/** Fila que se puede abrir. La primera celda debe contener un enlace o botón para el teclado. */
export function Tr({ children, onClick, className, selected, ...rest }: { children: ReactNode; onClick?: () => void; className?: string; selected?: boolean } & React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      onClick={onClick}
      className={cn('group transition-colors', onClick && 'cursor-pointer hover:bg-linen/60', selected && 'bg-brass-50/70', className)}
      {...rest}
    >
      {children}
    </tr>
  );
}

// ───────────────────────────── Formularios ─────────────────────────────

export function Field({ label, hint, error, children, className, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-[12.5px] font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error ? <p className="text-[12.5px] text-danger-700">{error}</p> : hint ? <p className="text-[12.5px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn('field', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={cn('field select-chevron', className)}
      {...rest}
    >
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn('field h-auto min-h-[72px] py-2 leading-snug', className)} {...rest} />;
});

/** Selector de cantidad con botones grandes (cómodo en móvil). */
export function Stepper({
  value, onChange, min = 0, max = 9999, size = 'md', label, className, step = 1, ...rest
}: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; size?: 'sm' | 'md' | 'lg'; label: string; className?: string; step?: number;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'>) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const h = size === 'sm' ? 'h-8' : size === 'lg' ? 'h-11' : 'h-9';
  const w = size === 'sm' ? 'w-8' : size === 'lg' ? 'w-11' : 'w-9';
  return (
    <div className={cn('inline-flex items-stretch rounded-lg border border-line-strong bg-white', h, className)} role="group" aria-label={label} {...rest}>
      <button
        type="button"
        aria-label={`Reducir ${label}`}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - step))}
        className={cn('flex items-center justify-center rounded-l-lg text-ink-2 hover:bg-linen disabled:opacity-35', w)}
      >
        <Minus className="size-3.5" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        onChange={(e) => onChange(clamp(Math.round(Number(e.target.value) || 0)))}
        onFocus={(e) => e.target.select()}
        className={cn('w-11 border-x border-line bg-transparent text-center text-[14px] font-medium tabular-nums focus:outline-none', size === 'lg' && 'w-14 text-[16px]')}
      />
      <button
        type="button"
        aria-label={`Aumentar ${label}`}
        disabled={value >= max}
        onClick={() => onChange(clamp(value + step))}
        className={cn('flex items-center justify-center rounded-r-lg text-ink-2 hover:bg-linen disabled:opacity-35', w)}
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label, size = 'md', className }: {
  value: T; onChange: (v: T) => void; options: { id: T; label: ReactNode; count?: number }[]; label: string; size?: 'sm' | 'md'; className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-linen p-0.5 ring-1 ring-inset ring-line', className)}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 font-medium transition-colors',
            size === 'sm' ? 'h-7 text-[12.5px]' : 'h-8 text-[13px]',
            value === o.id ? 'bg-paper text-forest-900 shadow-panel ring-1 ring-line-strong/70' : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.label}
          {o.count !== undefined && <span className={cn('tabular-nums', value === o.id ? 'text-brass-700' : 'text-ink-3')}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function TabBar<T extends string>({ value, onChange, tabs, label }: {
  value: T; onChange: (v: T) => void; tabs: { id: T; label: ReactNode; count?: number; attention?: boolean }[]; label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-line px-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          data-tour={`tab-${t.id}`}
          onClick={() => onChange(t.id)}
          className={cn(
            'relative -mb-px inline-flex h-10 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-[14px] font-medium transition-colors',
            value === t.id ? 'border-forest-700 text-forest-900' : 'border-transparent text-ink-3 hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={cn('rounded-full px-1.5 py-px text-[11.5px] tabular-nums', t.attention ? 'bg-brass-100 text-brass-800' : 'bg-linen text-ink-3')}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Checkbox({ checked, onChange, children, className }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn('flex cursor-pointer items-start gap-2.5 text-[13.5px] text-ink', className)}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 rounded border-line-strong accent-forest-700" />
      <span>{children}</span>
    </label>
  );
}

// ───────────────────────────── Identidad de locales y personas ─────────────────────────────

export const LOCATION_COLOR: Record<LocationId, string> = {
  cv: 'var(--color-loc-cv)',
  sf: 'var(--color-loc-sf)',
  ce: 'var(--color-loc-ce)',
};

export function LocationDot({ id, className }: { id: LocationId; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', className)} style={{ background: LOCATION_COLOR[id] }} />;
}

export function LocationTag({ id, name, className }: { id: LocationId; name: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', className)}>
      <LocationDot id={id} />
      {name}
    </span>
  );
}

export function Avatar({ initials, tone = 'forest', size = 28 }: { initials: string; tone?: 'forest' | 'brass' | 'paper'; size?: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        tone === 'forest' && 'bg-forest-100 text-forest-800',
        tone === 'brass' && 'bg-brass-200 text-brass-800',
        tone === 'paper' && 'bg-paper/15 text-paper',
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initials}
    </span>
  );
}

/** Barra de nivel: existencia frente a mínimo y objetivo. El estado se indica además con texto. */
export function LevelBar({ value, min, max, tone }: { value: number; min: number; max: number; tone: 'ok' | 'warn' | 'danger' }) {
  const top = Math.max(max, value, min * 1.2, 1);
  const pct = Math.max(0, Math.min(100, (value / top) * 100));
  const minPct = Math.max(0, Math.min(100, (min / top) * 100));
  const fill = tone === 'ok' ? 'bg-forest-500' : tone === 'warn' ? 'bg-warn-500' : 'bg-danger-600';
  const track = tone === 'ok' ? 'bg-forest-100' : tone === 'warn' ? 'bg-warn-100' : 'bg-danger-100';
  return (
    <div className={cn('relative h-1.5 w-full rounded-full', track)} aria-hidden>
      <div className={cn('absolute inset-y-0 left-0 rounded-full', fill)} style={{ width: `${pct}%` }} />
      <div className="absolute -inset-y-0.5 w-px bg-ink/60" style={{ left: `${minPct}%` }} />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-px font-sans text-[11px] font-medium text-paper/80">{children}</kbd>;
}
