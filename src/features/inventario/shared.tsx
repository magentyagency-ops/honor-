import { ArrowLeftRight, ClipboardCheck, Flag, PackageCheck, Trash2, Utensils } from 'lucide-react';
import type { DemoData, MovementType, StockMovement } from '@/domain/types';

export const MOVEMENT_ICON: Record<MovementType, typeof Flag> = {
  inventario_inicial: Flag,
  recepcion: PackageCheck,
  venta: Utensils,
  merma: Trash2,
  transferencia_salida: ArrowLeftRight,
  transferencia_entrada: ArrowLeftRight,
  ajuste_conteo: ClipboardCheck,
};

/** Explica de dónde viene un movimiento y a qué documento enlaza. */
export function movementOrigin(d: DemoData, m: StockMovement): { text: string; to?: string } {
  switch (m.type) {
    case 'recepcion': {
      const rec = d.receptions.find((r) => r.id === m.refId);
      return { text: `Recepción ${m.refId}${m.note ? ` · ${m.note}` : ''}`, to: rec ? `/compras/pedidos/${rec.orderId}` : undefined };
    }
    case 'venta':
      if (m.refKind === 'regularizacion') return { text: m.reason ?? 'Regularización de ventas sin receta', to: '/ventas?vista=correspondencias' };
      if (m.refKind === 'sync') return { text: `Sincronización de caja ${m.refId}${m.note ? ` · ${m.note}` : ''}`, to: `/ventas?vista=sincronizaciones&sync=${m.refId}` };
      return { text: `Ventas del día según recetas${m.note ? ` · ${m.note}` : ''}` };
    case 'merma':
      return { text: `${m.reason ?? 'Merma'}${m.note ? ` · ${m.note}` : ''}` };
    case 'transferencia_salida':
    case 'transferencia_entrada':
      return { text: `${m.reason ?? 'Transferencia'} · ${m.refId}${m.note ? ` · ${m.note}` : ''}` };
    case 'ajuste_conteo':
      return { text: `Conteo físico ${m.refId} · ${m.reason ?? ''}`, to: '/inventario?vista=conteos' };
    case 'inventario_inicial':
      return { text: `Conteo ${m.refId} · inventario de partida`, to: '/inventario?vista=conteos' };
  }
}
