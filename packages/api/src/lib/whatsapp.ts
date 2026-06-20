// Envío de WhatsApp vía Cloud API de Meta (graph.facebook.com). SOLO SERVIDOR.
//
// Estado del proyecto: la app usa enlaces wa.me (no envían solos). El envío
// AUTOMÁTICO real requiere WhatsApp Cloud API. Las credenciales viven por rifero
// en UserSettings (whatsappProvider/whatsappApiToken/whatsappPhoneNumberId), no
// en .env. Este módulo es JS puro (fetch + normalizePhone), sin binarios nativos,
// así que es seguro importarlo en el top-level de los routers.
//
// IMPORTANTE (ventana de 24h): los mensajes iniciados por el negocio fuera de la
// ventana de servicio de 24h SOLO se entregan con una PLANTILLA aprobada por Meta.
// Un texto libre (como este comprobante) se entrega si el cliente escribió al
// negocio en las últimas 24h; si no, Meta lo rechaza (p.ej. error #131047/#131026).
// Por eso el envío NO bloquea la venta: se loguea el motivo y se sigue.
import { normalizePhone } from "@riffas/shared";

const GRAPH_VERSION = "v21.0";

type WaSettings = {
  whatsappProvider: string | null;
  whatsappApiToken: string | null;
  whatsappPhoneNumberId: string | null;
};

export type WhatsAppSendResult =
  | { sent: true; messageId?: string }
  | { sent: false; reason: "not_configured" | "no_phone" | "error"; detail?: string };

// Manda un texto por Cloud API. NO lanza: devuelve el resultado para que el
// llamador decida (nunca debe tumbar la creación del boleto).
export async function sendWhatsAppText(opts: {
  settings: WaSettings;
  toPhone: string; // cualquier formato; se normaliza a E.164 y luego a dígitos
  body: string;
}): Promise<WhatsAppSendResult> {
  const { settings } = opts;

  if (
    settings.whatsappProvider !== "CLOUD_API" ||
    !settings.whatsappApiToken ||
    !settings.whatsappPhoneNumberId
  ) {
    return { sent: false, reason: "not_configured" };
  }

  const e164 = normalizePhone(opts.toPhone, "VE");
  if (!e164) return { sent: false, reason: "no_phone" };
  const to = e164.replace(/[^\d]/g, ""); // Meta espera solo dígitos, sin '+'

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${settings.whatsappPhoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${settings.whatsappApiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { preview_url: true, body: opts.body },
        }),
      }
    );
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        sent: false,
        reason: "error",
        detail: json?.error?.message || `HTTP ${res.status}`,
      };
    }
    return { sent: true, messageId: json?.messages?.[0]?.id };
  } catch (err) {
    return { sent: false, reason: "error", detail: (err as Error).message };
  }
}

// Arma el comprobante de la venta y lo envía al WhatsApp del cliente.
// Lee las credenciales del rifero y respeta el toggle autoSendWhatsApp.
// Marca Sale.whatsappSent solo si Meta aceptó el mensaje. NUNCA lanza.
export async function sendSaleReceiptWhatsApp(opts: {
  prisma: any;
  userId: string;
  sale: {
    id: string;
    numbers: string[];
    finalAmount: any;
    amountPaid: any;
    receiptUrl?: string | null;
    contact?: { name?: string | null; phone?: string | null } | null;
  };
  raffleTitle: string;
  brandName: string;
}): Promise<WhatsAppSendResult> {
  const { prisma, userId, sale } = opts;

  const phone = sale.contact?.phone;
  if (!phone) return { sent: false, reason: "no_phone" };

  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: {
      whatsappProvider: true,
      whatsappApiToken: true,
      whatsappPhoneNumberId: true,
      autoSendWhatsApp: true,
    },
  });

  // El rifero puede apagar el auto-envío sin desconectar el proveedor.
  if (!settings?.autoSendWhatsApp) return { sent: false, reason: "not_configured" };

  const total = Number(sale.finalAmount);
  const paid = Number(sale.amountPaid);
  const debt = Math.round((total - paid) * 100) / 100;

  const body = [
    `¡Hola ${sale.contact?.name ?? ""}! 🎟️ Tu participación en *${opts.raffleTitle}* quedó registrada.`,
    ``,
    `Número(s): ${sale.numbers.join(", ")}`,
    `Total: $${total.toFixed(2)}`,
    paid > 0 && debt > 0 ? `Abonado: $${paid.toFixed(2)} · Resta: $${debt.toFixed(2)}` : null,
    debt <= 0 ? `Estado: PAGADO ✅` : null,
    sale.receiptUrl ? `` : null,
    sale.receiptUrl ? `Comprobante: ${sale.receiptUrl}` : null,
    ``,
    `— ${opts.brandName}`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  const result = await sendWhatsAppText({ settings, toPhone: phone, body });

  if (result.sent) {
    await prisma.sale.update({
      where: { id: sale.id },
      data: { whatsappSent: true, whatsappSentAt: new Date() },
    });
  }
  return result;
}
