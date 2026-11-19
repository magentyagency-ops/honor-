/**
 * Pasarela de mensajería.
 *
 * La plataforma compone el texto del pedido (dominio) y delega el envío en esta interfaz.
 * En producción, la implementación usaría la API de WhatsApp Business con un número de empresa y
 * plantillas aprobadas. Importante: esa conexión NO da acceso a las conversaciones personales de nadie;
 * solo a los mensajes enviados y recibidos por el número de empresa conectado.
 *
 * En la demostración, `simulatedWhatsApp` no envía nada: devuelve un acuse ficticio tras una breve espera.
 */
export interface WhatsAppGateway {
  readonly mode: 'simulado' | 'whatsapp_business_api';
  readonly label: string;
  sendText(req: { to: string; body: string }): Promise<{ providerMessageId: string; status: 'entregado' }>;
  /** Solo en simulación: tiempo que tarda el «proveedor» en contestar. */
  readonly simulatedReplyDelayMs?: number;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let counter = 0;

export const simulatedWhatsApp: WhatsAppGateway = {
  mode: 'simulado',
  label: 'WhatsApp simulado (modo demostración)',
  simulatedReplyDelayMs: 2600,
  async sendText() {
    await wait(700);
    counter += 1;
    return { providerMessageId: `sim-${Date.now()}-${counter}`, status: 'entregado' };
  },
};
