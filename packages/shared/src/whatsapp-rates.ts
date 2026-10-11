/**
 * Tarifas Meta por país/categoría para el METERING de mensajes.
 *
 * HONESTIDAD DE DATOS: estas cifras son ESTIMADAS a partir de la tarifa pública
 * de Meta (cobro por mensaje de plantilla entregado, vigente desde jul-2025).
 * Las tarifas oficiales cambian por país y por trimestre: antes de refacturar a
 * un rifero, VERIFICAR contra la tabla oficial vigente
 * (developers.facebook.com/docs/whatsapp/pricing). Se pueden corregir sin deploy:
 * env WHATSAPP_RATES_JSON = {"58": {"UTILITY": 0.013, "MARKETING": 0.024}, ...}.
 *
 * Lo que el medidor garantiza HOY es el VOLUMEN exacto (cuántos mensajes, de qué
 * tipo, a qué país, con qué estado) — el costo es una estimación etiquetada.
 */

export type TemplateCategory = "UTILITY" | "MARKETING" | "AUTHENTICATION" | "SERVICE";

interface RateEntry { UTILITY?: number; MARKETING?: number; AUTHENTICATION?: number }

// Estimados USD por mensaje entregado (por calling code del DESTINATARIO).
const DEFAULT_RATES: Record<string, RateEntry> = {
  "58": { UTILITY: 0.013, MARKETING: 0.024 }, // Venezuela (estimado, verificar)
  "57": { UTILITY: 0.0002, MARKETING: 0.0125 }, // Colombia (estimado, verificar)
  "56": { UTILITY: 0.02, MARKETING: 0.03 }, // Chile (estimado)
  "51": { UTILITY: 0.02, MARKETING: 0.03 }, // Perú (estimado)
  "593": { UTILITY: 0.02, MARKETING: 0.03 }, // Ecuador (estimado)
  "34": { UTILITY: 0.02, MARKETING: 0.03 }, // España (estimado)
  "1": { UTILITY: 0.005, MARKETING: 0.025 }, // US/CA (estimado)
};

function loadRates(): Record<string, RateEntry> {
  try {
    const env = process.env.WHATSAPP_RATES_JSON;
    if (env) return { ...DEFAULT_RATES, ...JSON.parse(env) };
  } catch { /* env inválido → defaults */ }
  return DEFAULT_RATES;
}

/** Extrae el calling code de un E.164 (los de 1 dígito: +1; 2: +58/+57...; 3: +593). */
export function callingCodeOf(e164: string): string | null {
  const digits = e164.replace(/^\+/, "");
  for (const len of [1, 2, 3]) {
    const cc = digits.slice(0, len);
    if (DEFAULT_RATES[cc] || ["1", "58", "57", "56", "51", "593", "34", "52", "54", "55", "507", "591", "595", "598"].includes(cc)) return cc;
  }
  return digits.slice(0, 2); // fallback razonable
}

/**
 * Estima el costo Meta de una plantilla. SERVICE siempre es $0 (ventana abierta).
 * UTILITY también puede salir $0 si el cliente escribió en las últimas 24h — eso
 * solo se sabe con el webhook de entrada; por eso pricingNote lo advierte.
 */
export function estimateCostUsd(
  e164: string,
  category: TemplateCategory
): { costUsd: number | null; countryCode: string | null; pricingNote: string } {
  const countryCode = callingCodeOf(e164);
  if (category === "SERVICE") {
    return { costUsd: 0, countryCode, pricingNote: "mensaje de servicio (ventana): gratis" };
  }
  const rate = countryCode ? loadRates()[countryCode]?.[category] : undefined;
  const windowNote = category === "UTILITY" ? "; posible $0 si había ventana de servicio abierta (cliente escribió en 24h)" : "";
  if (rate === undefined) {
    return { costUsd: null, countryCode, pricingNote: `sin tarifa para +${countryCode} — completar desde tabla oficial${windowNote}` };
  }
  return { costUsd: rate, countryCode, pricingNote: `tarifa ESTIMADA +${countryCode} ${category}, verificar tabla Meta vigente${windowNote}` };
}
