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
   * URL de la página pública del comprobante (/c/[saleId]). Si viene, el mensaje
   * enlaza AQUÍ en vez del PNG crudo: WhatsApp muestra el recibo como preview
   * grande (og:image) y al tocar se ve bonito, sin obligar a descargar nada.
   */
  receiptPageUrl?: string | null;
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
  const link = input.receiptPageUrl || input.receiptUrl || null;
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
    link ? `` : null,
    link ? `🧾 Mira tu comprobante aquí:` : null,
    link ? link : null,
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
