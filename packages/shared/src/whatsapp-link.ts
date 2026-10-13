// Enlaces wa.me para enviar el comprobante por WhatsApp SIN Cloud API de Meta.
//
// Por qué wa.me y no Cloud API: el envío iniciado por el negocio vía Cloud API
// exige tokens de Meta y SOLO entrega texto libre dentro de la ventana de 24h
// (si el cliente no escribió antes, Meta lo rechaza). Un apartado en mesa casi
// siempre cae fuera de esa ventana. La app v1 resolvía esto con un enlace wa.me
// + el link de la imagen del recibo (hosteada): abre WhatsApp ya con el mensaje
// escrito, sin tokens y sin ventana de 24h. Esto replica ese comportamiento.
//
// CLIENT-SAFE: JS puro (normalizePhone + encodeURIComponent). Se puede importar
// desde Client Components.
import { normalizePhone } from "./phone";
import {
  DEFAULT_WA_TEMPLATES,
  renderWaTemplate,
  type WaMessageTemplates,
} from "./whatsapp-message-templates";

// Mismo formato que el recibo (imagen): sin decimales si es entero, hasta 2 si hay
// centavos. Antes usaba 2 fijos ($9.00) y no cuadraba con la imagen ($9).
const money = (v: unknown) =>
  `$${Number(v ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;

// Fecha en hora de Venezuela, formato riffas.info: "3 oct 2026, 22:10".
// Meses a mano (no Intl es-VE) para que "sept" salga sin punto en todo runtime.
const VE_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
export function formatVeDate(d: Date | string | number | null | undefined): string | null {
  if (d == null) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Caracas",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${Number(get("day"))} ${VE_MONTHS[Number(get("month")) - 1]} ${get("year")}, ${get("hour")}:${get("minute")}`;
}

export interface ReceiptWaInput {
  /** Teléfono del DESTINATARIO (cualquier formato; se normaliza a E.164). */
  phone: string;
  contactName?: string | null;
  brandName?: string | null;
  raffleTitle: string;
  numbers: string[];
  /** Total a cobrar. */
  total: unknown;
  /** Abonado real. */
  paid?: unknown;
  /**
   * Estado de la venta (Sale.status). Si viene, "PAGADO" SOLO se afirma con
   * "PAID": nunca deducirlo de la resta de montos (pueden ser auto-reportados
   * o estar desincronizados del estado que confirmó el rifero).
   */
  status?: string | null;
  /** Precio por número de la rifa (respaldo de "Valor de la rifa"; se prefiere el precio efectivo total÷números). */
  pricePerNumber?: unknown;
  /** Fecha del sorteo; se muestra en hora de Venezuela. Si falta, no sale. */
  drawDate?: Date | string | number | null;
  /** Fecha del apartado/venta; en hora de Venezuela. Si falta, no sale. */
  reservedAt?: Date | string | number | null;
  /** URL de la imagen del recibo (Cloudinary). Si falta, el mensaje va sin link. */
  receiptUrl?: string | null;
  /**
   * Link del VISOR de ImgBB (https://ibb.co/XXXX) del recibo. Si viene, es el
   * enlace de PREVIEW preferido del mensaje: WhatsApp scrapea la página de ImgBB
   * y muestra la card GRANDE y legible dentro del chat (la imagen se lee sin abrir
   * el enlace), como la app de referencia. Si falta, se cae a /rc o a la imagen.
   */
  receiptShareUrl?: string | null;
  /**
   * URL de la página pública del comprobante (/c/[saleId]). Se usa como CTA de
   * FALLBACK (enlace tocable) SOLO si el rifero no tiene dominio propio.
   */
  receiptPageUrl?: string | null;
  /**
   * Dominio propio del rifero (p.ej. "rifashermanospernia.com", con o sin
   * esquema). Si viene, es el CTA "mira todas nuestras rifas" del mensaje.
   * Multi-tenant: cada rifero enlaza al SUYO; nunca se comparte entre riferos.
   */
  brandUrl?: string | null;
  /**
   * Cuando el recibo se ADJUNTA como archivo (Web Share API: la imagen viaja
   * como foto real en el chat), el texto NO debe repetir el enlace a la imagen.
   * true → omite el bloque "Vista previa del recibo" + url; deja el resto
   * (datos de la venta + CTA de marca). Usado como caption del navigator.share.
   */
  omitImageLink?: boolean;
}

// El enlace PREVIEW del mensaje debe terminar en una IMAGEN directa: WhatsApp la
// muestra inline en el chat (foto grande), de forma fiable en móvil Y en
// WhatsApp Web. Derivamos una versión comprimida del PNG del recibo
// (Cloudinary): recibo COMPLETO, jpg, ancho 1080 → bien por debajo del límite de
// preview de WhatsApp. Solo transformamos URLs de Cloudinary /upload/; cualquier
// otra URL se usa tal cual (sigue siendo una imagen válida).
function receiptImageForWa(receiptUrl: string): string {
  try {
    const u = new URL(receiptUrl);
    if (u.hostname === "res.cloudinary.com" && u.pathname.includes("/upload/")) {
      return receiptUrl.replace("/upload/", "/upload/f_jpg,q_auto:good,w_1080/");
    }
  } catch {
    // URL no parseable → se devuelve sin tocar abajo.
  }
  return receiptUrl;
}

// Enlace de PREVIEW en NUESTRO dominio: /rc/<receiptNumber>. Es una página HTML con
// og:image, que WhatsApp SÍ convierte en miniatura (una URL de imagen "pelada" no,
// sobre todo en WhatsApp Web). El receiptNumber es el public_id dentro de la URL de
// Cloudinary; el origin sale de la URL de la página /c. Sin ambos → null (cae a la
// imagen directa). Ruta /rc/ (no /r/, que es el storefront público de la rifa).
function receiptPreviewPage(
  receiptUrl?: string | null,
  receiptPageUrl?: string | null
): string | null {
  if (!receiptUrl || !receiptPageUrl) return null;
  const m = receiptUrl.match(/\/riffas\/receipts\/([^/.]+)/);
  if (!m) return null;
  try {
    return `${new URL(receiptPageUrl).origin}/rc/${encodeURIComponent(m[1])}`;
  } catch {
    return null;
  }
}

// El dominio propio se guarda "pelado" (sin esquema). Para un enlace tocable en
// WhatsApp necesita https://. Devuelve null si no hay dominio.
function normalizeBrandUrl(raw?: string | null): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  return /^https?:\/\//i.test(t) ? t : `https://${t.replace(/^\/+/, "")}`;
}

/**
 * Arma el cuerpo del mensaje del comprobante, con el formato de riffas.info
 * (referencia del negocio): resumen de abonos, datos con 💎 (valor de la rifa,
 * deuda/estado, fecha del sorteo, fecha del apartado) y la vista previa del
 * recibo. Texto DISTINTO para apartado y para compra pagada.
 *
 * `templates` (opcional): plantillas editables del rifero (Ajustes → Mensajes
 * de WhatsApp). Sin plantilla, se usa el texto DEFAULT (este formato de
 * siempre, que es exactamente el que se ve en DEFAULT_WA_TEMPLATES).
 * Exportado aparte por si se quiere mostrar/copiar el texto sin el enlace.
 */
export function buildReceiptMessage(input: ReceiptWaInput, templates?: WaMessageTemplates): string {
  const total = Number(input.total ?? 0);
  const paid = Number(input.paid ?? total);
  const debt = Math.max(0, Math.round((total - paid) * 100) / 100);
  const isPaid = input.status ? input.status === "PAID" : debt <= 0;

  const hola = input.contactName ? `¡Hola ${input.contactName}! ` : "";
  // Preview del chat = la card del recibo vía ImgBB (prioridad 1, como en
  // riffas.info): WhatsApp la pinta GRANDE dentro del chat.
  //   1) ImgBB (ibb.co): card grande y legible sin abrir el enlace.
  //   2) nuestra página /rc (HTML con og:image) como respaldo.
  //   3) la URL directa de la imagen de Cloudinary.
  const previewLink =
    (input.receiptShareUrl && input.receiptShareUrl.trim() ? input.receiptShareUrl.trim() : null) ||
    (input.receiptUrl
      ? receiptPreviewPage(input.receiptUrl, input.receiptPageUrl) ||
        receiptImageForWa(input.receiptUrl)
      : null);
  // Si la imagen se adjunta como archivo (share nativo), no repetir su enlace.
  const showImage = !!previewLink && !input.omitImageLink;
  // CTA tocable secundario: dominio propio del rifero; si no tiene, la página /c.
  const ctaUrl = normalizeBrandUrl(input.brandUrl) || input.receiptPageUrl || null;

  const resumen = isPaid
    ? `Has completado el pago de ${money(total)}\npara la rifa "${input.raffleTitle}" 💎`
    : paid > 0
      ? `Has realizado abonos por un total de ${money(paid)}\npara la rifa "${input.raffleTitle}" 💎`
      : `Apartaste ${input.numbers.length === 1 ? "tu número" : "tus números"} por ${money(total)}\npara la rifa "${input.raffleTitle}" 💎`;
  const estado = isPaid
    ? `💎 Estado: *PAGADO* ✅`
    : debt > 0
      ? `💎 Deuda actual: ${money(debt)}`
      : `💎 Abonado: ${money(paid)}`;
  // "Valor de la rifa" = precio EFECTIVO de ESTA venta (total ÷ números), no el
  // precio actual de la rifa: si la rifa cambió de precio después del apartado (o
  // hubo pack de descuento), el precio de hoy haría que los montos no cuadraran
  // (2 números por $24 con "valor $13" → 2×$13≠$24). Con el efectivo, cuadran.
  // Respaldo: el pricePerNumber pasado por el llamador (ventas sin números/total).
  const given = input.pricePerNumber != null && input.pricePerNumber !== "" ? Number(input.pricePerNumber) : null;
  const nNums = input.numbers.length;
  const effective = total > 0 && nNums > 0 ? Math.round((total / nNums) * 100) / 100 : null;
  const price = effective ?? (given != null && Number.isFinite(given) ? given : null);
  const drawDate = formatVeDate(input.drawDate);
  const reservedAt = formatVeDate(input.reservedAt);

  // Variables disponibles para la plantilla (las de línea/bloque quedan vacías
  // cuando no aplican y el render omite la línea completa).
  const vars: Record<string, string> = {
    saludo: hola,
    resumen,
    numeros: input.numbers.join(", "),
    lineaValorRifa: price != null && Number.isFinite(price) ? `💎 Valor de la rifa: ${money(price)}` : "",
    lineaEstado: estado,
    lineaFechaSorteo: drawDate ? `💎 Fecha del sorteo: ${drawDate}` : "",
    lineaReservado: reservedAt ? `💎 Reservado: ${reservedAt}` : "",
    lineaCuandoCompletes: !isPaid && debt > 0 ? `Cuando completes el pago confirmamos tu apartado. 🤝` : "",
    bloqueVistaPrevia: showImage && previewLink ? `\n💎 Vista previa del recibo:\n${previewLink}` : "",
    bloqueCtaRifas: ctaUrl ? `\n🎉 Mira todas nuestras rifas:\n${ctaUrl}` : "",
    marca: input.brandName ?? "Riffas",
    nombre: input.contactName ?? "",
    rifa: input.raffleTitle,
    total: money(total),
    abonado: money(paid),
    deuda: money(debt),
    valorRifa: price != null && Number.isFinite(price) ? money(price) : "",
    fechaSorteo: drawDate ?? "",
    reservado: reservedAt ?? "",
  };

  const template = (isPaid ? templates?.pagado : templates?.apartado) ??
    (isPaid ? DEFAULT_WA_TEMPLATES.pagado : DEFAULT_WA_TEMPLATES.apartado);
  return renderWaTemplate(template, vars);
}

/**
 * Devuelve el enlace `https://wa.me/<dígitos>?text=...` listo para abrir, o `null`
 * si el teléfono no es válido. Abre WhatsApp con el mensaje + link del recibo.
 */
export function buildReceiptWaLink(input: ReceiptWaInput, templates?: WaMessageTemplates): string | null {
  const e164 = normalizePhone(input.phone, "VE");
  if (!e164) return null;
  const digits = e164.replace(/[^\d]/g, ""); // wa.me espera solo dígitos, sin '+'
  const text = encodeURIComponent(buildReceiptMessage(input, templates));
  return `https://wa.me/${digits}?text=${text}`;
}
