import type { InvoiceFieldKey, SourceDocument } from '@/domain/types';
import type { ExtractionResult } from '@/domain/invoices';

/**
 * Extracción de datos de facturas.
 *
 * En producción, esta interfaz la implementaría un servicio de lectura de documentos (OCR + modelo),
 * que devuelve cada campo con su nivel de confianza. La plataforma nunca da un campo por bueno sin
 * mostrar esa confianza: lo dudoso se marca y se corrige a mano.
 *
 * En la demostración, `simulatedExtractor` no lee imágenes: los documentos de ejemplo llevan asociado
 * lo que hay impreso en el papel, y la «extracción» lo devuelve con errores y dudas plausibles.
 * Para un archivo cargado por el usuario devuelve `null` (captura manual), en lugar de inventar datos.
 */
export interface DocumentExtractor {
  readonly mode: 'simulado' | 'servicio';
  readonly label: string;
  extract(doc: SourceDocument): Promise<ExtractionResult | null>;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const FIELDS: InvoiceFieldKey[] = ['supplierId', 'number', 'issueDate', 'dueDate', 'locationId', 'subtotalCents', 'taxCents', 'totalCents'];

/** Parte síncrona de la simulación (también la usan los datos iniciales y las pruebas). */
export function simulateExtraction(doc: SourceDocument): ExtractionResult | null {
  const p = doc.printed;
  if (!p) return null;
  const confidence: Partial<Record<InvoiceFieldKey, number>> = {};
  FIELDS.forEach((f, i) => {
    confidence[f] = 0.99 - ((doc.id.length + i * 7) % 5) * 0.008; // 0.96 – 0.99
  });
  for (const f of doc.hints?.lowConfidence ?? []) confidence[f] = 0.58 + ((doc.id.length + f.length) % 4) * 0.04;
  if (!p.dueDate) confidence.dueDate = 0.5;

  const misread = doc.hints?.misread ?? {};
  return {
    engine: 'extracción simulada',
    fields: {
      supplierId: p.supplierId,
      number: misread.number ?? p.number,
      issueDate: misread.issueDate ?? p.issueDate,
      dueDate: p.dueDate,
      locationId: doc.locationId,
      subtotalCents: p.subtotalCents,
      taxCents: p.taxCents,
      totalCents: p.totalCents,
      orderRef: p.orderRef,
    },
    confidence,
    lines: p.lines.map((l) => ({ ...l })),
  };
}

export const simulatedExtractor: DocumentExtractor = {
  mode: 'simulado',
  label: 'Extracción simulada (modo demostración)',
  async extract(doc) {
    await wait(1900);
    return simulateExtraction(doc);
  },
};
