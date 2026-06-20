// Seed de la TIENDA de marca de Orlando (Grandes Rifas Hermanos Pernía):
//  - storefrontConfig (validado con Zod antes de escribir)
//  - 5 cuentas de pago en PaymentAccount (incluye las de terceros que ya eran
//    públicas en rifas-hp: Bancolombia/Georgely, Zelle/Delcy — paridad).
// Idempotente: storefrontConfig se sobrescribe; las cuentas via upsert (userId+method).
// Uso (dev o prod): cargar DATABASE_URL/DIRECT_URL del entorno destino y correr con tsx.
import { prisma, PaymentMethod } from "@riffas/db";
import { storefrontConfigSchema } from "../src/lib/storefrontConfig";

const ORLANDO_EMAIL = "orlando.pernia@rifacil.vip";

function host(u?: string) { const m = u?.match(/@([^/:?]+)/); return m ? m[1] : "<sin>"; }

const config = {
  tagline: "Grandes Rifas",
  whatsapp: "584123863998",
  whatsappText: "Hola Hermanos Pernía, quiero participar en una rifa 🎟️",
  instagram: "https://www.instagram.com/rifashermanospernia2023",
  instagramHandle: "@rifashermanospernia2023",
  email: "rifashermanospernia2023@gmail.com",
  location: "Venezuela",
  nit: "04247376999",
  organizer: "Orlando Pernía · Eduard Pernía",
  contacts: [
    { name: "Orlando Pernía", phone: "584123863998" },
    { name: "Eduard Pernía", phone: "584147382696" },
  ],
  stats: [
    { value: 312, prefix: "", suffix: "+", label: "Ganadores felices" },
    { value: 85000, prefix: "$", suffix: "", label: "Repartido en premios" },
    { value: 4, prefix: "", suffix: "", label: "Rifas realizadas" },
  ],
  faqs: [
    { q: "¿Cómo participo en una rifa?", a: "Entrá a la rifa que quieras, elegí tus números (o pulsá “Elegir a la suerte”), llená tus datos, pagá por el método que prefieras y subí tu comprobante. Confirmamos tu boleto por WhatsApp." },
    { q: "¿Cómo sé que mis números quedaron reservados?", a: "Apenas confirmás, recibís tu boleto por WhatsApp. También podés consultarlos en el verificador con tu teléfono o número de boleto." },
    { q: "¿Cuándo y cómo se realiza el sorteo?", a: "El sorteo se transmite EN VIVO por nuestro Instagram en la fecha indicada de cada rifa. Jugamos con la lotería para total transparencia." },
    { q: "¿Qué pasa si la rifa no se vende completa?", a: "Nuestros premios juegan hasta que haya ganador. Si no se vende el total, se reprograma y se avisa por nuestras redes." },
    { q: "¿Cómo recibo mi premio si gano?", a: "Te contactamos de inmediato por WhatsApp para coordinar la entrega. Los premios en efectivo se pagan por el método que prefieras." },
  ],
};

// Cuentas de pago (paridad con data.js de rifas-hp). PII de terceros ya pública.
const accounts: Array<{ method: PaymentMethod; data: any }> = [
  { method: "PAGO_MOVIL", data: { bankName: "0102 · Banco Provincial", phone: "0424-7376999", idDocument: "21.180.135", holderName: "Orlando Pernía" } },
  { method: "BANCOLOMBIA", data: { bankName: "Bancolombia (Ahorros)", accountNumber: "820-741160-07", idDocument: "1.127.664.184", holderName: "Georgely Toledo" } },
  { method: "ZELLE", data: { email: "agropecuariagyd@gmail.com", holderName: "Delcy Zambrano", note: "Deja el concepto/nota EN BLANCO (si es obligatorio, escribe solo tu nombre). No pongas “rifa”, “boletos” ni “lotería”: puede causar el bloqueo de la cuenta. Luego envía la captura del pago." } },
  { method: "BINANCE", data: { email: "eduardpernia31@gmail.com", wallet: "eduardpernia31@gmail.com", holderName: "Eduard Pernía" } },
  { method: "ZINLI", data: { email: "eduardpernia31@gmail.com", holderName: "Eduard Pernía" } },
];

(async () => {
  console.log(`[host] ${host(process.env.DATABASE_URL)}`);

  // 1) Validar config con Zod ANTES de escribir.
  const parsed = storefrontConfigSchema.safeParse(config);
  if (!parsed.success) {
    console.error("storefrontConfig inválido:", JSON.stringify(parsed.error.flatten(), null, 2));
    process.exit(1);
  }

  const orlando = await prisma.user.findUnique({ where: { email: ORLANDO_EMAIL }, select: { id: true } });
  if (!orlando) { console.error("Orlando no encontrado"); process.exit(1); }

  // 2) storefrontConfig
  await prisma.user.update({ where: { id: orlando.id }, data: { storefrontConfig: parsed.data } });
  console.log("[config] ✅ storefrontConfig seteado (validado Zod)");

  // 3) cuentas de pago (upsert por userId+method)
  for (const acc of accounts) {
    await prisma.paymentAccount.upsert({
      where: { userId_method: { userId: orlando.id, method: acc.method } },
      update: { ...acc.data, active: true },
      create: { userId: orlando.id, method: acc.method, active: true, ...acc.data },
    });
    console.log(`[pago] ✅ ${acc.method}`);
  }

  const count = await prisma.paymentAccount.count({ where: { userId: orlando.id, active: true } });
  console.log(`\n✅ OK — ${count} cuentas activas`);
  await prisma.$disconnect();
})();
