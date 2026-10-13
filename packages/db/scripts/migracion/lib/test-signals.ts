/**
 * Heuristics that flag a sale made in rifacil as a likely TEST sale (🧪), so
 * Marco only has to confirm. SUGGESTIONS ONLY: nothing is dropped unless Marco
 * lists the receipt in DROP_SALES himself.
 *
 * Reasons are user-facing (Spanish) because they go straight into the report.
 */

export interface SaleForSignals {
  receiptNumber: string;
  contactName: string;
  contactPhone: string;
  createdAt: Date;
  amountPaid: number;
}

export interface SignalContext {
  /** Price of one number in the raffle (to tell "round" amounts from normal ones). */
  pricePerNumber: number;
  /** Phones of the business itself: owner, team members and vendors (E.164). */
  businessPhones: Set<string>;
  /** How many of the reviewed sales share each phone. */
  phoneSaleCount: Map<string, number>;
}

/** Venezuela has no DST: VET is UTC-4 all year. */
const VET_OFFSET_HOURS = -4;
export const REPEATED_PHONE_MIN = 3;

const TEST_NAME = /\b(test|testing|tester|prueba|pruebas|probando|demo|ensayo|asdf|qwerty|xxx+|aaa+|fulano|mengano)\b/i;
const OWNER_NAME = /\bmarco\s+(antonio\s+)?vera\b/i;

export function vetTime(d: Date): { hour: number; label: string } {
  const shifted = new Date(d.getTime() + VET_OFFSET_HOURS * 3_600_000);
  const hour = shifted.getUTCHours();
  const label = `${String(hour).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")} VET`;
  return { hour, label };
}

export function testSignals(s: SaleForSignals, ctx: SignalContext): string[] {
  const reasons: string[] = [];
  const name = s.contactName.trim();

  if (OWNER_NAME.test(name)) reasons.push("nombre Marco Vera");
  else if (TEST_NAME.test(name)) reasons.push(`nombre tipo prueba ("${name}")`);
  else if (name.replace(/[^a-záéíóúñ]/gi, "").length <= 2) reasons.push(`nombre vacío o de 1-2 letras ("${name}")`);

  if (ctx.businessPhones.has(s.contactPhone)) reasons.push("teléfono del propio negocio (dueño, equipo o vendedor)");
  const repeats = ctx.phoneSaleCount.get(s.contactPhone) ?? 0;
  if (repeats >= REPEATED_PHONE_MIN) reasons.push(`teléfono repetido en ${repeats} ventas`);

  const { hour, label } = vetTime(s.createdAt);
  if (hour < 6) reasons.push(`madrugada (${label})`);

  const paid = Math.round(s.amountPaid * 100) / 100;
  if (paid > 0 && paid <= 1) reasons.push(`monto simbólico ($${paid})`);
  else if (paid > 0 && paid % 50 === 0 && ctx.pricePerNumber > 0 && paid % ctx.pricePerNumber !== 0) {
    reasons.push(`monto redondo $${paid} (no es múltiplo del precio $${ctx.pricePerNumber})`);
  }
  return reasons;
}

/** Counts sales per phone, for the "repeated phone" signal. */
export function countPhones(sales: Array<{ contactPhone: string }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of sales) m.set(s.contactPhone, (m.get(s.contactPhone) ?? 0) + 1);
  return m;
}
