// Página PÚBLICA del comprobante — el enlace que viaja por WhatsApp.
// Server component: los OG tags (generateMetadata) hacen que WhatsApp muestre el
// recibo como preview grande en el chat (nada de "descarga este link"), y al tocar
// se ve el recibo completo, bonito y con acciones de un toque. El saleId es un
// cuid no adivinable: misma superficie que la URL de Cloudinary que ya se enviaba.
import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicCaller } from "@/lib/server-trpc";
import { Download, Ticket, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

// Deduplicado con React cache: generateMetadata + page comparten UNA sola query.
const getReceipt = cache(async (id: string) => {
  try {
    return await getPublicCaller().public.getReceipt({ id });
  } catch {
    return null;
  }
});

const money = (v: number) =>
  `$${Number(v ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;

// Lista de números acotada para textos (una venta grande no debe reventar la
// descripción OG que WhatsApp muestra bajo el preview).
function numbersLabel(numbers: string[], max = 6): string {
  if (numbers.length <= max) return numbers.join(", ");
  return `${numbers.slice(0, max).join(", ")} y ${numbers.length - max} más`;
}

// Texto negro o blanco según la luminancia del color de marca (YIQ): el botón
// "Guardar mi recibo" debe leerse igual con marcas claras que oscuras.
function readableTextOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#000";
  const n = parseInt(m[1], 16);
  const yiq =
    ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
  return yiq >= 140 ? "#000" : "#fff";
}

const drawDateLabel = (d: Date | string) =>
  new Date(d).toLocaleDateString("es-VE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

// Preview cuadrado para WhatsApp: recorte superior del recibo (marca + premio),
// jpg comprimido para quedar por debajo del límite de preview de WhatsApp.
function ogImageFromReceipt(receiptUrl: string): string {
  return receiptUrl.replace(
    "/upload/",
    "/upload/c_fill,g_north,w_1080,h_1080,q_auto:good,f_jpg/"
  );
}

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const r = await getReceipt(params.id);
  if (!r) return { title: "Comprobante no encontrado", robots: { index: false } };

  const title = `🧾 Tu comprobante — ${r.brand.name}`;
  const description = `${r.raffle.title} · Números ${numbersLabel(r.numbers)} · ${
    r.status === "PAID"
      ? "PAGADO ✅"
      : `Abonado ${money(r.paid)} de ${money(r.total)}`
  }`;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      type: "website",
      images: [
        { url: ogImageFromReceipt(r.receiptUrl), width: 1080, height: 1080 },
      ],
    },
    twitter: { card: "summary_large_image" },
  };
}

export default async function PublicReceiptPage({
  params,
}: {
  params: { id: string };
}) {
  const r = await getReceipt(params.id);
  if (!r) notFound();

  const accent = r.brand.color || "#f5c518";
  const accentText = readableTextOn(accent);
  // "Pagado" lo decide el ESTADO confirmado por el rifero, nunca la resta de
  // montos (los de una venta pública son auto-reportados por el comprador).
  const paid = r.status === "PAID";

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-4 py-8 text-white">
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5">
        {/* Marca */}
        <div className="flex items-center gap-3">
          {r.brand.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={r.brand.logo}
              alt={r.brand.name}
              className="h-10 w-10 rounded-full object-cover ring-2 ring-white/20"
            />
          )}
          <div>
            <p className="text-base font-bold leading-tight">{r.brand.name}</p>
            <p className="text-xs text-white/50">Comprobante {r.receiptNumber}</p>
          </div>
        </div>

        {/* Estado */}
        {paid ? (
          <span className="rounded-full bg-green-500/15 px-4 py-1.5 text-sm font-semibold text-green-400 ring-1 ring-green-500/40">
            PAGADO ✅ ¡Estás dentro del juego!
          </span>
        ) : (
          <span className="rounded-full bg-amber-500/15 px-4 py-1.5 text-sm font-semibold text-amber-300 ring-1 ring-amber-500/40">
            Apartado · te falta {money(r.debt)}
          </span>
        )}

        {/* Fecha del sorteo: el dato que el comprador más va a volver a buscar */}
        {r.raffle.drawDate && (
          <p className="-mt-2 text-sm text-white/60">
            🗓️ Sorteo: {drawDateLabel(r.raffle.drawDate)}
          </p>
        )}

        {/* El recibo, protagonista */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={r.receiptUrl}
          alt={`Comprobante ${r.receiptNumber} — ${r.raffle.title}`}
          className="w-full rounded-2xl shadow-2xl ring-1 ring-white/10"
        />

        {/* Acciones de un toque */}
        <div className="flex w-full flex-col gap-3">
          <a
            href={`/api/receipt/${r.id}?download=1`}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-semibold transition hover:opacity-90"
            style={{ backgroundColor: accent, color: accentText }}
          >
            <Download className="h-5 w-5" /> Guardar mi recibo
          </a>
          {r.raffle.isPublic && (
            <Link
              href={`/r/${r.raffle.id}`}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 py-3.5 font-semibold text-white transition hover:bg-white/10"
            >
              <Ticket className="h-5 w-5" /> Quiero más números 🍀
            </Link>
          )}
        </div>

        <p className="text-center text-sm text-white/60">
          ¡Mucha suerte, {r.buyerName}! 🍀 Todo juega hasta tener ganador.
        </p>

        <p className="flex items-center gap-1.5 text-xs text-white/35">
          <ShieldCheck className="h-3.5 w-3.5" />
          Comprobante verificado · Emitido con Rifácil
        </p>
      </div>
    </main>
  );
}
