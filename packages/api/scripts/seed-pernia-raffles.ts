// Seed AUTORITATIVO de las 4 rifas reales de Hermanos Pernía (paridad con
// rifas-hp/data.js):
//   - El Dubai  → ACTIVE (rifa en curso). NO se tocan sus ventas/números reales,
//     solo se sincronizan los campos de marketing + premios + packs.
//   - Gran Rifa Resuelve / El Azulejo / El Marino → DRAWN (sorteos cumplidos),
//     alimentan la sección "Ganadores". Slot de ganador (nombre/foto) queda vacío
//     hasta tener los datos.
// Además oculta la rifa de prueba "Rifa Dubay" (isPublic=false) para que no
// ensucie la tienda.
// Idempotente: busca por (userId, title) y actualiza; crea las DRAWN si faltan.
// Uso: cargar DATABASE_URL/DIRECT_URL del entorno destino y correr con tsx.
import { prisma } from "@riffas/db";

const ORLANDO_EMAIL = "orlando.pernia@rifacil.vip";
function host(u?: string) { const m = u?.match(/@([^/:?]+)/); return m ? m[1] : "<sin>"; }
const D = (iso: string) => new Date(iso); // pasar siempre en UTC (Z)

// VE es UTC-4: 23:10 VE = 03:10Z del día siguiente.
const LOTERIA = "Lotería del Táchira";

type Seed = {
  title: string;
  status: "ACTIVE" | "DRAWN";
  prize: string;
  prizeValue: number;
  price: number;
  total: number;
  drawDateZ: string;
  packs?: { qty: number; discountPercent: number }[];
  prizes: { titulo: string; descripcion: string }[];
};

const RAFFLES: Seed[] = [
  {
    title: "El Dubai",
    status: "ACTIVE",
    prize: "Toyota Agya 2026 + $1.000 y $500 en efectivo. Juega con la Lotería del Táchira (Triple A, B y Zodiacal 10:10 pm).",
    prizeValue: 16000,
    price: 55,
    total: 1000,
    drawDateZ: "2026-07-12T03:10:00Z", // 11 jul 23:10 VE
    // packs de data.js: 1=$55, 2=$100, 3=$145. Guardados como % para que el
    // checkout (createSale usa discountPercent) cobre exacto $100 / $145.
    packs: [
      { qty: 2, discountPercent: 9.0909090909 },   // 110 → 100 (ahorra $10)
      { qty: 3, discountPercent: 12.1212121212 },  // 165 → 145 (ahorra $20)
    ],
    prizes: [
      { titulo: "Toyota Agya 2026", descripcion: "Triple “A” de la Lotería del Táchira, 10:10 pm." },
      { titulo: "$1.000 en efectivo", descripcion: "Triple “B” de la Lotería del Táchira, 10:10 pm." },
      { titulo: "$500 en efectivo", descripcion: "Triple Zodiacal de la Lotería del Táchira, 10:10 pm." },
    ],
  },
  {
    title: "Gran Rifa Resuelve",
    status: "DRAWN",
    prize: "$5.000 en efectivo. ¡Resuelve en grande con la Lotería del Táchira!",
    prizeValue: 5500,
    price: 13,
    total: 1000,
    drawDateZ: "2026-05-10T02:15:00Z", // 9 may 22:15 VE
    prizes: [
      { titulo: "$5.000 en efectivo", descripcion: "Triple “A” de la Lotería del Táchira, 10:10 pm." },
      { titulo: "$500 en efectivo", descripcion: "Triple “B” de la Lotería del Táchira, 10:10 pm." },
    ],
  },
  {
    title: "El Azulejo",
    status: "DRAWN",
    prize: "Aveo Automático 2007 + moto EK Xpress 2026 + efectivo. Juega con la Lotería del Táchira.",
    prizeValue: 8000,
    price: 25,
    total: 1000,
    drawDateZ: "2026-04-12T03:10:00Z", // 11 abr 23:10 VE
    prizes: [
      { titulo: "Aveo Automático 2007 + $200 en efectivo", descripcion: "Táchira Triple “A”, 10:10 pm." },
      { titulo: "Moto EK Xpress 2026", descripcion: "Táchira Triple “B”, 10:10 pm." },
      { titulo: "$200 en efectivo", descripcion: "Táchira Triple Zodiacal, 10:10 pm." },
    ],
  },
  {
    title: "El Marino",
    status: "DRAWN",
    prize: "Aveo 2013 + moto EK Xpress 2026 + efectivo. Juega con la Lotería del Táchira.",
    prizeValue: 9000,
    price: 35,
    total: 1000,
    drawDateZ: "2026-03-01T03:10:00Z", // 28 feb 23:10 VE
    prizes: [
      { titulo: "Aveo 2013 + $200 en efectivo", descripcion: "Táchira Triple “A”, 10:10 pm." },
      { titulo: "Moto EK Xpress 2026", descripcion: "Táchira Triple “B”, 10:10 pm." },
      { titulo: "$300 en efectivo", descripcion: "Táchira Triple Zodiacal, 10:10 pm." },
    ],
  },
];

(async () => {
  console.log(`[host] ${host(process.env.DATABASE_URL)}`);
  const u = await prisma.user.findUnique({ where: { email: ORLANDO_EMAIL }, select: { id: true } });
  if (!u) { console.error("Orlando no encontrado"); process.exit(1); }
  const userId = u.id;

  for (const r of RAFFLES) {
    const existing = await prisma.raffle.findFirst({
      where: { userId, title: r.title },
      select: { id: true },
    });

    const common = {
      prize: r.prize,
      prizeValue: r.prizeValue,
      pricePerNumber: r.price,
      totalNumbers: r.total,
      drawDate: D(r.drawDateZ),
      loteria: LOTERIA,
      status: r.status,
      isPublic: true,
      contactWhatsapp: "+584123863998",
      discountPackages: r.packs ?? undefined,
    };

    let raffleId: string;
    if (existing) {
      // El Dubai (y cualquier rifa ya existente): actualizar campos, NO tocar
      // sus números/ventas reales.
      await prisma.raffle.update({ where: { id: existing.id }, data: common });
      raffleId = existing.id;
      console.log(`[rifa] ✏️  ${r.title} (${r.status}) actualizada`);
    } else {
      // Rifas históricas (DRAWN): crear fila mínima (sin RaffleNumber: no son
      // navegables, solo vitrina de ganadores).
      const created = await prisma.raffle.create({
        data: {
          userId,
          title: r.title,
          startDate: D(r.drawDateZ),
          ...common,
        },
        select: { id: true },
      });
      raffleId = created.id;
      console.log(`[rifa] ➕ ${r.title} (${r.status}) creada`);
    }

    // Premios: reescribir autoritativo.
    await prisma.prize.deleteMany({ where: { raffleId } });
    await prisma.prize.createMany({
      data: r.prizes.map((p, i) => ({ raffleId, titulo: p.titulo, descripcion: p.descripcion, orden: i })),
    });
  }

  // Ocultar la rifa de PRUEBA "Rifa Dubay" (typo "Dubay" con y — distinta de la
  // real "El Dubai" con i). Match por contains para tolerar espacios sobrantes.
  const junk = await prisma.raffle.updateMany({
    where: { userId, title: { contains: "Dubay" }, isPublic: true },
    data: { isPublic: false },
  });
  if (junk.count) console.log(`[limpieza] 🙈 "Rifa Dubay" ocultada (isPublic=false) ×${junk.count}`);

  const active = await prisma.raffle.count({ where: { userId, status: "ACTIVE", isPublic: true } });
  const drawn = await prisma.raffle.count({ where: { userId, status: "DRAWN", isPublic: true } });
  console.log(`\n✅ OK — ${active} activa(s), ${drawn} sorteo(s) cumplido(s) públicos`);
  await prisma.$disconnect();
})();
