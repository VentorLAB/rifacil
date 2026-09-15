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

// Mismo formato que el recibo (imagen): sin decimales si es entero, hasta 2 si hay
// centavos. Antes usaba 2 fijos ($9.00) y no cuadraba con la imagen ($9).
const money = (v: unknown) =>
  `$${Number(v ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;

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
  /** URL de la imagen del recibo (Cloudinary). Si falta, el mensaje va sin link. */
  receiptUrl?: string | null;
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
}

// El enlace PREVIEW del mensaje debe ser una IMAGEN directa: WhatsApp la muestra
// inline en el chat (foto grande), de forma fiable en móvil Y en WhatsApp Web —
// a diferencia de enlazar una página HTML y depender del scrapeo de og:image
// (flaky, y peor en Web / cold start). Derivamos una versión comprimida del PNG
// del recibo (Cloudinary): recibo COMPLETO, jpg, ancho 1080 → bien por debajo del
// límite de preview de WhatsApp. Solo transformamos URLs de Cloudinary /upload/;
// cualquier otra URL se usa tal cual (sigue siendo una imagen válida).
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

// El dominio propio se guarda "pelado" (sin esquema). Para un enlace tocable en
// WhatsApp necesita https://. Devuelve null si no hay dominio.
function normalizeBrandUrl(raw?: string | null): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  return /^https?:\/\//i.test(t) ? t : `https://${t.replace(/^\/+/, "")}`;
}

/**
 * Arma el cuerpo del mensaje del comprobante. Exportado aparte por si se quiere
 * mostrar/copiar el texto sin el enlace.
 */
export function buildReceiptMessage(input: ReceiptWaInput): string {
  const total = Number(input.total ?? 0);
  const paid = Number(input.paid ?? total);
  const debt = Math.max(0, Math.round((total - paid) * 100) / 100);
  const isPaid = input.status ? input.status === "PAID" : debt <= 0;

  const hola = input.contactName ? `¡Hola ${input.contactName}! ` : "";
  // Preview del chat = la IMAGEN del recibo (debe ir PRIMERA: WhatsApp previsualiza
  // el primer enlace del mensaje).
  const imageUrl = input.receiptUrl ? receiptImageForWa(input.receiptUrl) : null;
  // CTA tocable secundario: dominio propio del rifero; si no tiene, la página /c.
  const ctaUrl = normalizeBrandUrl(input.brandUrl) || input.receiptPageUrl || null;
  return [
    `🎟️ *${input.raffleTitle}*`,
    `${hola}Tu apartado quedó registrado. 🍀`,
    ``,
    `Tus números: *${input.numbers.join(", ")}*`,
    `Valor total: ${money(total)}`,
    isPaid
      ? `Estado: *PAGADO* ✅`
      : debt > 0
        ? `Abonado: ${money(paid)} · *Te falta: ${money(debt)}*`
        : `Abonado: ${money(paid)}`,
    !isPaid && debt > 0 ? `Cuando completes el pago confirmamos tu apartado. 🤝` : null,
    imageUrl ? `` : null,
    imageUrl ? `🧾 Aquí tienes tu comprobante:` : null,
    imageUrl ? imageUrl : null,
    ctaUrl ? `` : null,
    ctaUrl ? `🎉 Mira todas nuestras rifas:` : null,
    ctaUrl ? ctaUrl : null,
    ``,
    `🏆 Todo juega hasta tener ganador.`,
    `— ${input.brandName ?? "Riffas"}`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/**
 * Devuelve el enlace `https://wa.me/<dígitos>?text=...` listo para abrir, o `null`
 * si el teléfono no es válido. Abre WhatsApp con el mensaje + link del recibo.
 */
export function buildReceiptWaLink(input: ReceiptWaInput): string | null {
  const e164 = normalizePhone(input.phone, "VE");
  if (!e164) return null;
  const digits = e164.replace(/[^\d]/g, ""); // wa.me espera solo dígitos, sin '+'
  const text = encodeURIComponent(buildReceiptMessage(input));
  return `https://wa.me/${digits}?text=${text}`;
}
