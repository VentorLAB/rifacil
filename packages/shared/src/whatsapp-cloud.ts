/**
 * Envío de recibos por WhatsApp Cloud API (Meta) o YCloud — INTEGRADO en rifacil.
 *
 * Por qué existe: el flujo v1 (wa.me) obliga al vendedor a tocar "enviar" y abrir
 * su WhatsApp. Con la API conectada, el recibo SALE SOLO al confirmar venta/abono:
 * utility template con IMAGEN de cabecera (la card 1080x790 del recibo). El rifero
 * sigue usando su app WhatsApp Business normal (coexistencia); esto es tubería.
 *
 * Proveedores soportados (User.whatsappProvider):
 * - "CLOUD_API": Meta directo. Necesita whatsappPhoneNumberId + whatsappApiToken
 *   (token permanente de System User recomendado).
 * - "YCLOUD": BSP YCloud (alta fácil por Embedded Signup). Necesita whatsappApiToken
 *   (X-API-Key) + whatsappPhoneNumber (número remitente, E.164).
 *
 * Número dedicado API vs coexistencia: el mismo código sirve para ambos; lo que
 * cambia es el alta de la WABA, no el envío.
 *
 * Costo: Meta cobra por plantilla ENTREGADA (utility ≈ centavos; GRATIS dentro de
 * una ventana de servicio abierta de 24h). Este módulo NUNCA bloquea la venta:
 * cualquier fallo se reporta en el retorno y el caller cae al fallback wa.me.
 */

export type WhatsappProvider = "CLOUD_API" | "YCLOUD";

export interface WhatsappCredentials {
  provider: WhatsappProvider;
  apiToken: string;
  /** CLOUD_API: Phone Number ID de Meta. YCloud: no se usa. */
  phoneNumberId?: string | null;
  /** YCloud: número remitente E.164 (con o sin +). CLOUD_API: informativo. */
  phoneNumber?: string | null;
}

export interface ReceiptTemplateData {
  /** Nombre de la plantilla utility APROBADA en la WABA. Default "recibo_compra". */
  templateName?: string;
  /** Código de idioma de la plantilla (debe coincidir con el registrado). */
  language?: string;
  /** URL pública de la imagen de cabecera (derivado 1080x790 del recibo). */
  imageUrl: string;
  /** Variables del cuerpo, en orden {{1}}..{{6}}: marca, rifa, números, total, abonado, deuda. */
  brandName: string;
  raffleTitle: string;
  numbers: string;
  total: string;
  paid: string;
  debt: string;
}

export interface SendResult {
  ok: boolean;
  provider: WhatsappProvider;
  /** id del mensaje (wamid) si la API lo devolvió. */
  messageId?: string;
  /** Detalle del fallo para logs (nunca se muestra al comprador). */
  error?: string;
}

const GRAPH_VERSION = "v21.0";

function templateComponents(d: ReceiptTemplateData) {
  return [
    {
      type: "header",
      parameters: [{ type: "image", image: { link: d.imageUrl } }],
    },
    {
      type: "body",
      parameters: [
        d.brandName,
        d.raffleTitle,
        d.numbers,
        d.total,
        d.paid,
        d.debt,
      ].map((text) => ({ type: "text", text: String(text).slice(0, 900) })),
    },
  ];
}

/** Meta Cloud API directo: POST /{phone-number-id}/messages */
async function sendViaCloudApi(
  creds: WhatsappCredentials,
  to: string,
  data: ReceiptTemplateData
): Promise<SendResult> {
  if (!creds.phoneNumberId) {
    return { ok: false, provider: "CLOUD_API", error: "Falta whatsappPhoneNumberId" };
  }
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${creds.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to.replace(/^\+/, ""),
        type: "template",
        template: {
          name: data.templateName || "recibo_compra",
          language: { code: data.language || "es" },
          components: templateComponents(data),
        },
      }),
    }
  );
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      provider: "CLOUD_API",
      error: `Meta ${res.status}: ${json?.error?.message || "sin detalle"}`,
    };
  }
  return { ok: true, provider: "CLOUD_API", messageId: json?.messages?.[0]?.id };
}

/** YCloud (BSP): POST /v2/whatsapp/messages con X-API-Key */
async function sendViaYCloud(
  creds: WhatsappCredentials,
  to: string,
  data: ReceiptTemplateData
): Promise<SendResult> {
  if (!creds.phoneNumber) {
    return { ok: false, provider: "YCLOUD", error: "Falta whatsappPhoneNumber" };
  }
  const res = await fetch("https://api.ycloud.com/v2/whatsapp/messages", {
    method: "POST",
    headers: {
      "X-API-Key": creds.apiToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: creds.phoneNumber.replace(/^\+/, ""),
      to: to.replace(/^\+/, ""),
      type: "template",
      template: {
        name: data.templateName || "recibo_compra",
        language: { code: data.language || "es" },
        components: templateComponents(data),
      },
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      provider: "YCLOUD",
      error: `YCloud ${res.status}: ${json?.message || "sin detalle"}`,
    };
  }
  return { ok: true, provider: "YCLOUD", messageId: json?.id || json?.wamid };
}

/**
 * Envía la plantilla de recibo por el proveedor configurado. NUNCA lanza:
 * devuelve SendResult y el caller decide el fallback (wa.me).
 */
export async function sendReceiptWhatsapp(
  creds: WhatsappCredentials,
  to: string,
  data: ReceiptTemplateData
): Promise<SendResult> {
  try {
    if (!to || !/^\+?\d{8,15}$/.test(to.replace(/[\s-]/g, ""))) {
      return { ok: false, provider: creds.provider, error: `Destino inválido: ${to}` };
    }
    if (creds.provider === "YCLOUD") return await sendViaYCloud(creds, to, data);
    return await sendViaCloudApi(creds, to, data);
  } catch (err: any) {
    return { ok: false, provider: creds.provider, error: err?.message || "error de red" };
  }
}

// ─── Texto libre (chatbot / utilidades) ─────────────────────────────────────
export async function sendTextWhatsapp(
  creds: WhatsappCredentials,
  to: string,
  body: string
): Promise<SendResult> {
  try {
    if (creds.provider === "YCLOUD") {
      const r = await fetch("https://api.ycloud.com/v2/whatsapp/messages", {
        method: "POST",
        headers: { "X-API-Key": creds.apiToken, "Content-Type": "application/json" },
        body: JSON.stringify({ from: creds.phoneNumber, to, type: "text", text: { body } }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, provider: "YCLOUD", error: `YCloud ${r.status}: ${j?.message || r.statusText}` };
      return { ok: true, provider: "YCLOUD", messageId: j?.id };
    }
    const r = await fetch(`https://graph.facebook.com/v21.0/${creds.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, provider: "CLOUD_API", error: `Cloud API ${r.status}: ${j?.error?.message || r.statusText}` };
    return { ok: true, provider: "CLOUD_API", messageId: j?.messages?.[0]?.id };
  } catch (e: any) {
    return { ok: false, provider: creds.provider, error: e?.message || "error de red" };
  }
}
