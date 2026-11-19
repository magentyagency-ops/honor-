import { useRef, useState } from 'react';
import {
  ArrowRight, Check, CircleHelp, Download, FileSpreadsheet, FlaskConical, Globe, MessageCircle, Plug, ScanLine, ShieldCheck, Store, TriangleAlert, Upload,
} from 'lucide-react';
import type { LocationId, SyncRun } from '@/domain/types';
import { importTickets } from '@/domain/sales';
import { plural } from '@/domain/format';
import { parsePosCsv, samplePosCsv } from '@/adapters/posFile';
import { simulatedPos } from '@/adapters/pos';
import { simulatedWhatsApp } from '@/adapters/whatsapp';
import { simulatedExtractor } from '@/adapters/extraction';
import { act, toast, useDemo, useLocationFilter, useUser } from '@/store';
import { Badge, Button, Note, PageHeader, Panel, Select, cn } from '@/ui/primitives';

function Simulated() {
  return <Badge tone="brass" icon={<FlaskConical className="size-3" />}>Simulado en esta demostración</Badge>;
}

function Bullets({ items, tone = 'ok' }: { items: React.ReactNode[]; tone?: 'ok' | 'todo' }) {
  return (
    <ul className="space-y-2 text-[13.5px] leading-snug text-ink-2">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2.5">
          {tone === 'ok' ? <Check className="mt-0.5 size-3.5 shrink-0 text-ok-700" strokeWidth={3} /> : <CircleHelp className="mt-0.5 size-3.5 shrink-0 text-brass-700" />}
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

function Integration({ icon, title, adapter, children }: { icon: React.ReactNode; title: string; adapter: string; children: React.ReactNode }) {
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-forest-50 text-forest-700 ring-1 ring-inset ring-forest-100">{icon}</span>
          <div>
            <h2 className="serif text-[20px] font-[520] leading-tight text-forest-900">{title}</h2>
            <p className="text-[12.5px] text-ink-3">Adaptador activo: {adapter}</p>
          </div>
        </div>
        <Simulated />
      </div>
      {children}
    </Panel>
  );
}

function Columns({ now, real }: { now: React.ReactNode[]; real: React.ReactNode[] }) {
  return (
    <div className="grid gap-px bg-line md:grid-cols-2">
      <div className="bg-paper px-5 py-4">
        <p className="eyebrow mb-2.5 text-ink-3">En esta demostración</p>
        <Bullets items={now} />
      </div>
      <div className="bg-paper px-5 py-4">
        <p className="eyebrow mb-2.5 text-brass-700">Para conectarlo de verdad</p>
        <Bullets items={real} tone="todo" />
      </div>
    </div>
  );
}

export function IntegracionesPage() {
  const data = useDemo((s) => s.data);
  const user = useUser();
  const filter = useLocationFilter();
  const [loc, setLoc] = useState<LocationId>(filter !== 'all' ? filter : 'cv');
  const [result, setResult] = useState<{ run: SyncRun; errors: string[]; source: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const location = data.locations.find((l) => l.id === loc)!;

  const importCsv = (text: string, source: string) => {
    const { tickets, errors } = parsePosCsv(text, loc, data.posItems);
    if (tickets.length === 0) {
      toast('error', 'No se encontró ningún ticket en el archivo', errors[0]);
      return;
    }
    const res = act((d, ctx) => importTickets(d, ctx, loc, tickets, 'manual'));
    if (res.ok) {
      setResult({ run: res.value, errors, source });
      toast('ok', `${plural(res.value.imported, 'ticket importado', 'tickets importados')} desde archivo`, res.value.duplicates > 0 ? `${plural(res.value.duplicates, 'ticket ya estaba', 'tickets ya estaban')} en la plataforma y se omitieron.` : undefined);
    }
  };
  const download = () => {
    const blob = new Blob([samplePosCsv(location.code, new Date().toISOString())], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ventas-${location.code.toLowerCase()}-ejemplo.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integraciones"
        subtitle="Qué está simulado en esta demostración y qué haría falta confirmar para conectarlo de verdad. Ninguna simulación se presenta como una conexión real."
      />

      {/* Arquitectura: adaptadores reemplazables */}
      <Panel className="px-5 py-5">
        <h2 className="serif text-[18px] font-[520] text-forest-900">Cómo está construido: adaptadores reemplazables</h2>
        <p className="mt-1 max-w-[80ch] text-[13.5px] text-ink-2">
          La lógica de negocio (pedidos, recepciones, inventario, facturas, pagos) no sabe cómo se envía un WhatsApp ni cómo habla una caja. Solo conoce tres interfaces.
          Hoy cada una tiene una versión simulada; mañana se sustituye por la real sin tocar el resto.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-stretch">
          <div className="rounded-xl bg-forest-900 px-4 py-3.5 text-paper">
            <p className="eyebrow text-brass-300">Plataforma</p>
            <p className="mt-1 text-[13.5px] leading-snug">Reglas de negocio: solo la recepción suma stock, un ticket se importa una vez, el saldo se recalcula con cada pago.</p>
          </div>
          <ArrowRight className="hidden self-center text-ink-3 md:block" />
          <div className="rounded-xl border border-line bg-white/60 px-4 py-3.5">
            <p className="eyebrow text-ink-3">Tres interfaces</p>
            <ul className="mt-1 space-y-0.5 text-[13.5px] text-ink">
              <li>Mensajería · <code className="text-[12.5px] text-ink-2">WhatsAppGateway</code></li>
              <li>Cajas · <code className="text-[12.5px] text-ink-2">PosConnector</code></li>
              <li>Facturas · <code className="text-[12.5px] text-ink-2">DocumentExtractor</code></li>
            </ul>
          </div>
          <ArrowRight className="hidden self-center text-ink-3 md:block" />
          <div className="rounded-xl border border-dashed border-brass-500 bg-brass-50 px-4 py-3.5">
            <p className="eyebrow text-brass-800">Hoy: simulados · mañana: reales</p>
            <p className="mt-1 text-[13.5px] leading-snug text-ink">WhatsApp, cajas y lectura de facturas funcionan con versiones simuladas. Ningún servicio externo interviene.</p>
          </div>
        </div>
      </Panel>

      {/* WhatsApp */}
      <Integration icon={<MessageCircle className="size-5" strokeWidth={1.8} />} title="WhatsApp con proveedores y gerentes" adapter={simulatedWhatsApp.label}>
        <Columns
          now={[
            'Cada pedido genera su mensaje (local, referencia, artículos, cantidades y fecha de entrega) y se muestra en un chat de vista previa.',
            '«Simular envío» registra el mensaje en la plataforma y genera una respuesta ficticia del proveedor. No sale ningún mensaje.',
            'Las facturas «llegan» como documentos de ejemplo, igual que las fotos que hoy envían los gerentes.',
          ]}
          real={[
            <>Una cuenta de <strong className="font-medium text-ink">WhatsApp Business Platform</strong> con un número de la empresa, directa o a través de un proveedor de servicios.</>,
            'Plantillas de mensaje aprobadas para iniciar conversaciones con proveedores, y su consentimiento para recibir pedidos por ese canal.',
            <>Los gerentes enviarían las fotos a <strong className="font-medium text-ink">ese número</strong> (o las subirían desde la aplicación). La conexión solo ve los mensajes de ese número de empresa.</>,
            <><strong className="font-medium text-ink">No da acceso a las conversaciones personales</strong> de Antoine ni de nadie del equipo, ni a sus grupos actuales.</>,
          ]}
        />
      </Integration>

      {/* Cajas */}
      <Integration icon={<Store className="size-5" strokeWidth={1.8} />} title="Cajas de los locales" adapter={simulatedPos.label}>
        <div className="px-5 py-4">
          <Note tone="warn" icon={<TriangleAlert className="size-4" />}>
            Aún no se ha identificado qué sistema de caja usa cada local. Esta demostración <strong>no afirma ninguna compatibilidad</strong>: los tickets son ficticios. Según lo que ofrezca la caja, hay tres caminos, del mejor al último recurso.
          </Note>
        </div>
        <ol className="grid gap-px border-t border-line bg-line lg:grid-cols-3">
          <li className="bg-paper px-5 py-4">
            <p className="flex items-center gap-2 text-[14.5px] font-semibold text-ink">
              <span className="flex size-6 items-center justify-center rounded-full bg-forest-700 text-[12px] text-paper">1</span>
              <Plug className="size-4 text-forest-600" /> API o conector oficial
            </p>
            <Badge tone="ok" className="mt-2">Recomendado</Badge>
            <p className="mt-2 text-[13.5px] leading-snug text-ink-2">La caja expone sus ventas. Sincronización automática y frecuente, con el identificador de cada ticket como clave para no duplicar.</p>
            <p className="mt-2 text-[12.5px] text-ink-3">Por confirmar: proveedor de caja, existencia de API y credenciales por local.</p>
          </li>
          <li className="bg-paper px-5 py-4">
            <p className="flex items-center gap-2 text-[14.5px] font-semibold text-ink">
              <span className="flex size-6 items-center justify-center rounded-full bg-forest-700 text-[12px] text-paper">2</span>
              <FileSpreadsheet className="size-4 text-forest-600" /> Importación de archivos
            </p>
            <Badge tone="brass" className="mt-2">Si no hay API</Badge>
            <p className="mt-2 text-[13.5px] leading-snug text-ink-2">El gerente exporta las ventas del día desde la caja y sube el archivo. Menos inmediato, pero fiable. Puedes probarlo aquí abajo.</p>
            <p className="mt-2 text-[12.5px] text-ink-3">Por confirmar: formato de exportación de la caja y quién sube el archivo.</p>
          </li>
          <li className="bg-paper px-5 py-4">
            <p className="flex items-center gap-2 text-[14.5px] font-semibold text-ink">
              <span className="flex size-6 items-center justify-center rounded-full bg-ink-3 text-[12px] text-paper">3</span>
              <Globe className="size-4 text-ink-3" /> Conector de navegador
            </p>
            <Badge tone="warn" icon={<TriangleAlert className="size-3" />} className="mt-2">Último recurso · frágil</Badge>
            <p className="mt-2 text-[13.5px] leading-snug text-ink-2">Un programa lee las ventas del panel web de la caja como lo haría una persona. Se rompe cuando la caja cambia su pantalla y exige mantenimiento continuo.</p>
            <p className="mt-2 text-[12.5px] text-ink-3">Solo si la caja no ofrece ni API ni exportación, y si sus condiciones de uso lo permiten.</p>
          </li>
        </ol>

        {/* Prueba real de la opción 2 */}
        <div className="border-t border-line px-5 py-4" data-tour="importar-archivo">
          <p className="text-[14px] font-semibold text-ink">Probar la importación de archivos</p>
          <p className="mt-0.5 max-w-[78ch] text-[13px] text-ink-2">
            Importa un CSV de ventas y comprueba que entra en ventas e inventario. Impórtalo por segunda vez: no se duplica nada.
            Formato: <code className="rounded bg-linen px-1 py-0.5 text-[12px]">ticket_id, fecha_hora, articulo, cantidad, precio_unitario</code>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Select value={loc} onChange={(e) => { setLoc(e.target.value as LocationId); setResult(null); }} aria-label="Local de destino" className="w-auto min-w-[170px]">
              {data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
            <Button variant="primary" icon={<FileSpreadsheet className="size-4" />} onClick={() => importCsv(samplePosCsv(location.code, new Date().toISOString()), 'archivo de ejemplo')} disabledReason={user.role === 'contabilidad' && 'Contabilidad no importa ventas.'}>
              Importar el archivo de ejemplo
            </Button>
            <Button icon={<Download className="size-4" />} onClick={download}>Descargar el ejemplo</Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void f.text().then((t) => importCsv(t, f.name));
                e.target.value = '';
              }}
            />
            <Button icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()} disabled={user.role === 'contabilidad'}>Importar otro CSV</Button>
          </div>
          {result && (
            <div className={cn('mt-3 rounded-xl px-4 py-3 text-[13.5px] ring-1 ring-inset', result.run.imported > 0 ? 'bg-ok-50 text-ok-700 ring-ok-100' : 'bg-forest-50 text-forest-700 ring-forest-100')}>
              <p className="font-semibold">
                {result.source}: {plural(result.run.imported, 'ticket importado', 'tickets importados')} · {plural(result.run.duplicates, 'omitido por estar ya importado', 'omitidos por estar ya importados')}
              </p>
              <p className="mt-0.5 text-ink-2">
                {result.run.imported > 0
                  ? `Las ventas y el inventario de ${location.name} ya los reflejan (sincronización ${result.run.id}). Vuelve a importar el mismo archivo para comprobar que no se duplica.`
                  : 'Todos los tickets del archivo ya estaban en la plataforma: ventas e inventario no han cambiado.'}
              </p>
              {result.errors.map((e) => <p key={e} className="mt-1 text-warn-800">{e}</p>)}
            </div>
          )}
        </div>
      </Integration>

      {/* Lectura de facturas */}
      <Integration icon={<ScanLine className="size-5" strokeWidth={1.8} />} title="Lectura de facturas" adapter={simulatedExtractor.label}>
        <Columns
          now={[
            'Los documentos de ejemplo llevan asociado lo que hay impreso en el papel; la «extracción» lo devuelve con dudas y errores verosímiles.',
            'Cada campo muestra su nivel de confianza; lo dudoso hay que confirmarlo o corregirlo, y cada corrección queda registrada.',
            'Si subes un archivo propio, no se inventan datos: se abre la ficha para capturarlos a mano.',
          ]}
          real={[
            'Un servicio de lectura de documentos (OCR + modelo) que devuelva cada campo con su confianza.',
            'Volumen mensual de facturas, formatos habituales (foto, PDF) y qué proveedores entregan factura electrónica.',
            'Dónde se guardan los documentos, durante cuánto tiempo y quién puede verlos.',
          ]}
        />
      </Integration>

      {/* Lista de arranque */}
      <Panel className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <span className="flex size-10 items-center justify-center rounded-xl bg-brass-50 text-brass-700 ring-1 ring-inset ring-brass-200"><ShieldCheck className="size-5" strokeWidth={1.8} /></span>
          <div>
            <h2 className="serif text-[20px] font-[520] leading-tight text-forest-900">Puntos por confirmar antes de una versión real</h2>
            <p className="text-[12.5px] text-ink-3">Nada de esto se da por supuesto en la demostración</p>
          </div>
        </div>
        <ol className="grid gap-px bg-line md:grid-cols-2">
          {[
            ['Proveedor de caja y acceso', 'Qué sistema usa cada local y si ofrece API, exportación de archivos o solo panel web.'],
            ['WhatsApp Business', 'Número de empresa, modalidad de integración y plantillas de mensaje para los proveedores.'],
            ['Acceso autorizado a mensajes y documentos', 'Qué conversaciones pasan por el número de empresa y quién autoriza su uso. Las conversaciones personales quedan fuera.'],
            ['Catálogo inicial', 'Productos, presentaciones de compra, proveedor y precio de cada referencia.'],
            ['Recetas y unidades', 'Gramajes reales por artículo vendido y unidad de referencia de cada producto.'],
            ['Stock de partida', 'Un inventario inicial por local: el historial de compras no basta para conocerlo.'],
          ].map(([title, text], i) => (
            <li key={title} className="flex items-start gap-3 bg-paper px-5 py-3.5">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-linen text-[12px] font-semibold text-ink-2 ring-1 ring-inset ring-line-strong">{i + 1}</span>
              <div>
                <p className="text-[14px] font-medium text-ink">{title}</p>
                <p className="text-[13px] leading-snug text-ink-2">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
