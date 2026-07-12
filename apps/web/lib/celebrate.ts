// Celebraciones estilo Canva: micro-momentos de logro que hacen que usar la app
// se sienta bien (confetti + frases). Reglas: respetar prefers-reduced-motion,
// nunca bloquear la UI, y celebrar LOGROS reales (venta, saldo, hito, rifa lista).
import confetti from "canvas-confetti";

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Ráfaga corta: cada venta/apartado registrado. */
export function celebrateSale() {
  if (reducedMotion()) return;
  confetti({
    particleCount: 90,
    spread: 75,
    startVelocity: 38,
    origin: { y: 0.7 },
    zIndex: 9999,
  });
}

/** Lluvia doble (~1.2s): logros grandes — rifa creada, venta saldada, hito, checklist completo. */
export function celebrateBig() {
  if (reducedMotion()) return;
  const end = Date.now() + 1200;
  (function frame() {
    confetti({ particleCount: 5, angle: 60, spread: 60, startVelocity: 45, origin: { x: 0, y: 0.8 }, zIndex: 9999 });
    confetti({ particleCount: 5, angle: 120, spread: 60, startVelocity: 45, origin: { x: 1, y: 0.8 }, zIndex: 9999 });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

// Frases rotativas para la pantalla de venta registrada (tono rifero, cero corporate).
const SALE_CHEERS = [
  "¡Boom! Otra venta pa' la cuenta 💪",
  "¡Así se vende! 🔥",
  "Eso está quedando bueno... 🤑",
  "¡Tremendo ritmo de venta! 🚀",
  "Un número menos, un cliente más feliz 🙌",
  "La rifa se está moviendo sola 😎",
  "¡Duro! Sigue así que esto vuela 🛫",
  "Caja registrada 🧾💚",
];

export function saleCheer(): string {
  return SALE_CHEERS[Math.floor(Math.random() * SALE_CHEERS.length)];
}

// Hitos de venta de una rifa (porcentaje vendido). Devuelve el hito cruzado
// entre prevPct y nextPct (el mayor), o null si no se cruzó ninguno.
const MILESTONES: { pct: number; message: string }[] = [
  { pct: 100, message: "🏆 ¡RIFA VENDIDA COMPLETA! Eres una máquina." },
  { pct: 90, message: "🔥 ¡90% vendido! Esto ya casi se cierra." },
  { pct: 75, message: "🚀 ¡75% vendido! Quedan los últimos números." },
  { pct: 50, message: "🎉 ¡Mitad de la rifa vendida! Vas volando." },
  { pct: 25, message: "💪 ¡25% vendido! Arrancaste con todo." },
];

export function crossedMilestone(
  prevPct: number,
  nextPct: number
): { pct: number; message: string } | null {
  for (const m of MILESTONES) {
    if (prevPct < m.pct && nextPct >= m.pct) return m;
  }
  return null;
}
