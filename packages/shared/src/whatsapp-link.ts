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

const money = (v: unknown) =>
  `$${Number(v ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
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
  /** URL de la imagen del recibo (Cloudinary). Si falta, el mensaje va sin link. */
  receiptUrl?: string | null;
}

/**
 * Arma el cuerpo del mensaje del comprobante. Exportado aparte por si se quiere
 * mostrar/copiar el texto sin el enlace.
 */
export function buildReceiptMessage(input: ReceiptWaInput): string {
  const total = Number(input.total ?? 0);
  const paid = Number(input.paid ?? total);
  const debt = Math.max(0, Math.round((total - paid) * 100) / 100);

  return [
    `¡Hola ${input.contactName ?? ""}! 🎟️ Tu apartado en *${input.raffleTitle}* quedó registrado.`,
    ``,
    `Número(s): ${input.numbers.join(", ")}`,
    `Valor total: ${money(total)}`,
    debt > 0 ? `Abonado: ${money(paid)} · Deuda: ${money(debt)}` : `Estado: PAGADO ✅`,
    input.receiptUrl ? `` : null,
    input.receiptUrl ? `Tu comprobante: ${input.receiptUrl}` : null,
    ``,
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
