import { FileText, ImageOff } from 'lucide-react';
import type { InvoiceFieldKey, SourceDocument } from '@/domain/types';
import { lineSubtotal } from '@/domain/core';
import { money } from '@/domain/format';
import { fmtDate } from '@/domain/time';
import { useDemo } from '@/store';
import { cn } from '@/ui/primitives';

/** Color de membrete de cada proveedor ficticio (solo para dar variedad a los documentos de ejemplo). */
const ACCENT: Record<string, string> = {
  's-baru': '#6b4226',
  's-pradera': '#2d5d8f',
  's-molinos': '#8a6428',
  's-azuero': '#2f6b3f',
  's-canal': '#3f4a57',
  's-pacifico': '#1f6f72',
};

function Mark({ field, active, children, className, as: Tag = 'span' }: {
  field: InvoiceFieldKey; active?: InvoiceFieldKey | null; children: React.ReactNode; className?: string; as?: 'span' | 'div';
}) {
  return (
    <Tag
      data-field={field}
      className={cn('rounded-[3px] transition-[background-color,box-shadow] duration-150', active === field && 'bg-[#f6d98a]/70 shadow-[0_0_0_3px_rgb(246_217_138/0.7)]', className)}
    >
      {children}
    </Tag>
  );
}

/**
 * Documento de ejemplo: representa lo que hay impreso en la factura del proveedor,
 * como si fuera la foto que el gerente envía por WhatsApp.
 * `active` resalta en el papel el campo que se está revisando a la derecha.
 */
export function InvoiceDocument({ doc, active, scanning }: { doc: SourceDocument; active?: InvoiceFieldKey | null; scanning?: boolean }) {
  const data = useDemo((s) => s.data);
  const p = doc.printed;
  const loc = data.locations.find((l) => l.id === doc.locationId)!;

  if (!p) {
    // Archivo cargado por el usuario: se muestra tal cual, sin inventar su contenido.
    return (
      <div className="relative flex min-h-[420px] items-center justify-center overflow-hidden rounded-xl bg-[#2f3431] p-5">
        {doc.previewDataUrl ? (
          <img src={doc.previewDataUrl} alt={`Vista previa de ${doc.fileName}`} className="max-h-[640px] max-w-full rounded-sm shadow-paper" />
        ) : (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center text-paper/80">
            {doc.fileName.toLowerCase().endsWith('.pdf') ? <FileText className="size-10" strokeWidth={1.4} /> : <ImageOff className="size-10" strokeWidth={1.4} />}
            <p className="text-[14px] font-medium text-paper">{doc.fileName}</p>
            <p className="max-w-[36ch] text-[12.5px] leading-snug text-paper/65">La demostración no genera vista previa para este tipo de archivo. El documento queda registrado igualmente.</p>
          </div>
        )}
      </div>
    );
  }

  const supplier = data.suppliers.find((s) => s.id === p.supplierId)!;
  const accent = ACCENT[supplier.id] ?? '#3f4a57';
  const blurry = doc.hints?.lowConfidence?.includes('number');
  const tilt = (doc.id.charCodeAt(doc.id.length - 1) % 5) * 0.35 - 0.7;

  return (
    <div className="relative overflow-hidden rounded-xl bg-[#2f3431] px-4 py-6 sm:px-7 sm:py-8">
      {/* Mesa sobre la que se fotografió el papel */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-60" style={{ backgroundImage: 'radial-gradient(ellipse at 30% 0%, rgb(255 255 255 / 0.10), transparent 60%)' }} />
      <div
        data-no-i18n
        className="paper-grain relative mx-auto max-w-[520px] bg-[#fdfdfb] px-6 py-7 text-[#22262a] shadow-paper sm:px-8"
        style={{ transform: `rotate(${tilt}deg)`, fontFamily: 'ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif' }}
        role="img"
        aria-label={`Factura ${p.number} de ${supplier.name} por ${money(p.totalCents)}`}
      >
        {/* Membrete */}
        <div className="flex items-start justify-between gap-4 border-b-2 pb-4" style={{ borderColor: accent }}>
          <Mark field="supplierId" active={active} as="div" className="min-w-0 px-1">
            <p className="text-[19px] font-extrabold leading-tight tracking-tight" style={{ color: accent }}>{supplier.name}</p>
            <p className="mt-1 text-[10.5px] leading-snug text-[#5b6068]">
              RUC {supplier.ruc}
              <br />
              {supplier.address} · Tel. {supplier.whatsapp}
            </p>
          </Mark>
          <div className="shrink-0 text-right">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#5b6068]">Factura</p>
            <Mark field="number" active={active} className={cn('mt-0.5 inline-block px-1 text-[15px] font-bold tabular-nums', blurry && 'blur-[0.7px]')}>
              N.º {p.number}
            </Mark>
            {blurry && <span aria-hidden className="absolute -right-2 top-9 size-14 rounded-full bg-[#b98a4a]/15 blur-[6px]" />}
          </div>
        </div>

        {/* Datos */}
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[11.5px]">
          <div>
            <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-[#8a8f96]">Cliente</p>
            <Mark field="locationId" active={active} as="div" className="px-1">
              <p className="font-semibold">Saint-Honoré · {loc.name}</p>
              <p className="text-[#5b6068]">{loc.address}</p>
            </Mark>
          </div>
          <div className="text-right">
            <p>
              <span className="text-[#8a8f96]">Fecha de emisión: </span>
              <Mark field="issueDate" active={active} className="px-1 font-semibold tabular-nums">{fmtDate(p.issueDate)}</Mark>
            </p>
            <p className="mt-0.5">
              <span className="text-[#8a8f96]">{p.dueDate ? 'Vence: ' : 'Condiciones: '}</span>
              <Mark field="dueDate" active={active} className="px-1 font-semibold tabular-nums">
                {p.dueDate ? fmtDate(p.dueDate) : `crédito a ${supplier.paymentTermsDays} días`}
              </Mark>
            </p>
            {p.orderRef && (
              <p className="mt-0.5">
                <span className="text-[#8a8f96]">Su pedido: </span>
                <span className="font-semibold tabular-nums">{p.orderRef}</span>
              </p>
            )}
          </div>
        </div>

        {/* Líneas */}
        <table className="mt-5 w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="text-[9.5px] uppercase tracking-[0.12em] text-white" style={{ background: accent }}>
              <th className="px-2 py-1.5 text-left font-bold">Cant.</th>
              <th className="px-2 py-1.5 text-left font-bold">Descripción</th>
              <th className="whitespace-nowrap px-2 py-1.5 text-right font-bold">P. unit.</th>
              <th className="px-2 py-1.5 text-right font-bold">Importe</th>
            </tr>
          </thead>
          <tbody>
            {p.lines.map((l, i) => (
              <tr key={i} className="border-b border-[#e3e5e8]">
                <td className="px-2 py-1.5 font-semibold tabular-nums">{l.packs}</td>
                <td className="px-2 py-1.5">{l.description}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(l.unitPriceCents)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(lineSubtotal(l))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totales */}
        <div className="mt-4 flex items-end justify-between gap-6">
          <div className="text-[10px] leading-snug text-[#8a8f96]">
            <span aria-hidden className="mb-2 ml-3 inline-block -rotate-[7deg] rounded border-2 border-[#3b5ea8]/55 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.2em] text-[#3b5ea8]/60">
              Recibido
            </span>
            <p className="w-36 border-t border-[#b9bdc3] pt-1">Firma y sello del cliente</p>
          </div>
          <dl className="w-[200px] text-[11.5px]">
            <div className="flex justify-between py-0.5">
              <dt className="text-[#5b6068]">Subtotal</dt>
              <dd><Mark field="subtotalCents" active={active} className="px-1 tabular-nums">{money(p.subtotalCents)}</Mark></dd>
            </div>
            <div className="flex justify-between py-0.5">
              <dt className="text-[#5b6068]">ITBMS 7 %</dt>
              <dd><Mark field="taxCents" active={active} className="px-1 tabular-nums">{p.taxCents > 0 ? money(p.taxCents) : 'Exento'}</Mark></dd>
            </div>
            <div className="mt-1 flex justify-between border-t-2 pt-1.5 text-[14px] font-extrabold" style={{ borderColor: accent }}>
              <dt>TOTAL USD</dt>
              <dd><Mark field="totalCents" active={active} className="px-1 tabular-nums">{money(p.totalCents)}</Mark></dd>
            </div>
          </dl>
        </div>
        <p className="mt-5 text-center text-[9px] uppercase tracking-[0.16em] text-[#b0b4ba]">Documento ficticio · datos de demostración</p>
      </div>

      {scanning && (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-forest-950/20" />
          <div className="absolute inset-x-6 h-[3px] rounded-full bg-brass-400 shadow-[0_0_18px_4px_rgb(207_170_117/0.75)] animate-scan" />
        </div>
      )}
    </div>
  );
}

/** Miniatura para la bandeja: sugiere el documento sin renderizarlo entero. */
export function DocThumb({ doc }: { doc: SourceDocument }) {
  const accent = doc.printed ? ACCENT[doc.printed.supplierId] ?? '#3f4a57' : '#6d726d';
  if (doc.previewDataUrl) {
    return <img src={doc.previewDataUrl} alt="" className="h-[52px] w-10 shrink-0 rounded-[3px] object-cover shadow-[0_1px_3px_rgb(0_0_0/0.25)]" />;
  }
  return (
    <span aria-hidden className="flex h-[52px] w-10 shrink-0 -rotate-2 flex-col gap-[3px] rounded-[3px] bg-white p-1.5 shadow-[0_1px_3px_rgb(0_0_0/0.25)]">
      <span className="h-[5px] w-4 rounded-[1px]" style={{ background: accent }} />
      <span className="h-px w-full" style={{ background: accent }} />
      <span className="mt-0.5 h-[2px] w-full rounded bg-[#d5d8dc]" />
      <span className="h-[2px] w-full rounded bg-[#d5d8dc]" />
      <span className="h-[2px] w-4/5 rounded bg-[#d5d8dc]" />
      <span className="h-[2px] w-full rounded bg-[#d5d8dc]" />
      <span className="mt-auto h-[3px] w-3 self-end rounded-[1px] bg-[#8a8f96]" />
    </span>
  );
}
