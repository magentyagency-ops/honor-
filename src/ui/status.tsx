import {
  ArrowDown, BadgeCheck, Ban, Check, CheckCheck, CircleCheck, CircleDashed, CircleSlash, Hourglass, Inbox, PackageCheck,
  PackageOpen, PencilLine, ScanSearch, Send, TriangleAlert, Wifi, WifiOff,
} from 'lucide-react';
import type { InvoiceStatus, OrderStatus, PosConnection, PurchaseOrder } from '@/domain/types';
import { ORDER_STATUS_LABEL } from '@/domain/purchasing';
import { INVOICE_STATUS_LABEL } from '@/domain/invoices';
import { STOCK_LEVEL_LABEL, type StockLevel } from '@/domain/selectors';
import { Badge, type Tone } from './primitives';

const ico = 'size-3';

const ORDER: Record<OrderStatus, { tone: Tone; icon: React.ReactNode }> = {
  borrador: { tone: 'neutral', icon: <PencilLine className={ico} /> },
  pendiente_aprobacion: { tone: 'warn', icon: <Hourglass className={ico} /> },
  aprobado: { tone: 'brass', icon: <BadgeCheck className={ico} /> },
  enviado: { tone: 'info', icon: <Send className={ico} /> },
  confirmado: { tone: 'forest', icon: <CheckCheck className={ico} /> },
  recibido_parcial: { tone: 'warn', icon: <PackageOpen className={ico} /> },
  recibido: { tone: 'ok', icon: <PackageCheck className={ico} /> },
  cancelado: { tone: 'neutral', icon: <Ban className={ico} /> },
};

export function OrderStatusBadge({ order, status }: { order?: PurchaseOrder; status?: OrderStatus }) {
  const st = status ?? order!.status;
  const cfg = ORDER[st];
  const label = order?.closedShort && st === 'recibido' ? 'Recibido · con faltante' : ORDER_STATUS_LABEL[st];
  return (
    <Badge tone={cfg.tone} icon={cfg.icon}>
      {label}
    </Badge>
  );
}

const INVOICE: Record<InvoiceStatus, { tone: Tone; icon: React.ReactNode }> = {
  recibida: { tone: 'neutral', icon: <Inbox className={ico} /> },
  por_revisar: { tone: 'warn', icon: <ScanSearch className={ico} /> },
  validada: { tone: 'forest', icon: <CircleCheck className={ico} /> },
  parcialmente_pagada: { tone: 'brass', icon: <CircleDashed className={ico} /> },
  pagada: { tone: 'ok', icon: <Check className={ico} strokeWidth={3} /> },
  en_disputa: { tone: 'danger', icon: <TriangleAlert className={ico} /> },
  descartada: { tone: 'neutral', icon: <Ban className={ico} /> },
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const cfg = INVOICE[status];
  return (
    <Badge tone={cfg.tone} icon={cfg.icon}>
      {INVOICE_STATUS_LABEL[status]}
    </Badge>
  );
}

const LEVEL: Record<StockLevel, { tone: Tone; icon: React.ReactNode }> = {
  agotado: { tone: 'danger', icon: <CircleSlash className={ico} /> },
  critico: { tone: 'danger', icon: <TriangleAlert className={ico} /> },
  bajo: { tone: 'warn', icon: <ArrowDown className={ico} strokeWidth={2.5} /> },
  ok: { tone: 'ok', icon: <Check className={ico} strokeWidth={3} /> },
};

export function StockLevelBadge({ level }: { level: StockLevel }) {
  const cfg = LEVEL[level];
  return (
    <Badge tone={cfg.tone} icon={cfg.icon}>
      {STOCK_LEVEL_LABEL[level]}
    </Badge>
  );
}

export const levelTone = (level: StockLevel): 'ok' | 'warn' | 'danger' => (level === 'ok' ? 'ok' : level === 'bajo' ? 'warn' : 'danger');

export function PosStatusBadge({ conn, stale, compact }: { conn: PosConnection; stale: boolean; compact?: boolean }) {
  if (conn.status === 'requiere_sync') {
    return (
      <Badge tone="danger" icon={<WifiOff className={ico} />}>
        {compact ? 'Sin sincronizar' : 'Requiere sincronización'}
      </Badge>
    );
  }
  if (stale) {
    return (
      <Badge tone="warn" icon={<Hourglass className={ico} />}>
        Desactualizada
      </Badge>
    );
  }
  return (
    <Badge tone="ok" icon={<Wifi className={ico} />}>
      Conectada
    </Badge>
  );
}
