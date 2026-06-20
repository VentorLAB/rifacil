// Tienda del rifero servida en SU dominio propio (rifashermanospernia.com).
// El middleware reescribe "/" → /d/<host>. Acá (server component) resolvemos el
// rifero por su customDomain y mostramos sus rifas. Cada tarjeta enlaza al
// /r/[id] existente (NO se toca el storefront).
//
// Reglas:
//  - 0 rifas → mensaje "no hay rifas activas" con la marca.
//  - 1 rifa  → redirect directo a /r/[id] (no tiene sentido una landing de 1).
//  - 2+      → grilla de tarjetas.
//  - host no vinculado a ningún rifero → notFound() (404 limpio).

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Ticket, Calendar } from "lucide-react";
import { getPublicCaller } from "@/lib/server-trpc";

export const dynamic = "force-dynamic"; // depende del host, nunca cachear estático.

// Título de la pestaña = nombre de marca del rifero (aunque el logo lo reemplace
// visualmente en el header). Si el dominio no resuelve, título genérico.
export async function generateMetadata({ params }: { params: { host: string } }) {
  const host = decodeURIComponent(params.host);
  try {
    const data = await getPublicCaller().public.getStorefrontByDomain({ host });
    return { title: data.brand.name };
  } catch {
    return { title: "Tienda" };
  }
}

const money = (v: number) =>
  `$${Number(v ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Activa",
  PAUSED: "En pausa",
  DRAWN: "Sorteada",
};

export default async function TenantStorefront({
  params,
}: {
  params: { host: string };
}) {
  const host = decodeURIComponent(params.host);

  let data: Awaited<ReturnType<ReturnType<typeof getPublicCaller>["public"]["getStorefrontByDomain"]>>;
  try {
    data = await getPublicCaller().public.getStorefrontByDomain({ host });
  } catch {
    // Dominio no vinculado a un rifero → 404 limpio.
    notFound();
  }

  const { brand, raffles } = data;

  // 1 sola rifa → directo al storefront (sin landing intermedia).
  if (raffles.length === 1) {
    redirect(`/r/${raffles[0].id}`);
  }

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Encabezado con la marca del rifero */}
      <header
        className="px-6 py-10 text-white"
        style={{
          background: `linear-gradient(135deg, ${brand.color}, ${brand.colorSecondary})`,
        }}
      >
        <div className="mx-auto max-w-3xl">
          {brand.logo ? (
            // Con logo: el logotipo YA dice el nombre → no repetimos el nombre
            // como heading (sería redundante). brandName queda en alt + <title>.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logo}
              alt={brand.name}
              className="h-16 w-auto max-w-full object-contain sm:h-20"
            />
          ) : (
            // Sin logo: el nombre va como heading.
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20">
                <Ticket className="h-8 w-8" />
              </div>
              <h1 className="text-2xl font-bold">{brand.name}</h1>
            </div>
          )}
          <p className="mt-3 text-white/80">Rifas oficiales · compra segura</p>
        </div>
      </header>

      {/* Grilla de rifas */}
      <section className="mx-auto max-w-3xl px-6 py-8">
        {raffles.length === 0 ? (
          <p className="py-16 text-center text-slate-500">
            No hay rifas activas en este momento. ¡Vuelve pronto!
          </p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            {raffles.map((r) => {
              const pct =
                r.totalNumbers > 0
                  ? Math.min(100, Math.round((r.soldCount / r.totalNumbers) * 100))
                  : 0;
              return (
                <Link
                  key={r.id}
                  href={`/r/${r.id}`}
                  className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md"
                >
                  <div className="aspect-[16/9] w-full overflow-hidden bg-slate-100">
                    {r.bannerUrl || r.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.bannerUrl || r.iconUrl || ""}
                        alt={r.title}
                        className="h-full w-full object-cover transition group-hover:scale-105"
                      />
                    ) : (
                      <div
                        className="flex h-full w-full items-center justify-center"
                        style={{ background: r.color || brand.color }}
                      >
                        <Ticket className="h-10 w-10 text-white/80" />
                      </div>
                    )}
                  </div>
                  <div className="space-y-2 p-4">
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                      <span className="text-sm font-semibold" style={{ color: brand.color }}>
                        {money(r.pricePerNumber)} / número
                      </span>
                    </div>
                    <h2 className="font-semibold text-slate-800">{r.title}</h2>
                    {r.prize && (
                      <p className="line-clamp-1 text-sm text-slate-500">🏆 {r.prize}</p>
                    )}
                    {r.drawDate && (
                      <p className="flex items-center gap-1 text-xs text-slate-400">
                        <Calendar className="h-3.5 w-3.5" />
                        {new Date(r.drawDate).toLocaleDateString("es-VE")}
                        {r.loteria ? ` · ${r.loteria}` : ""}
                      </p>
                    )}
                    {/* Progreso de venta */}
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: brand.color }}
                      />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <footer className="py-8 text-center text-xs text-slate-400">
        {brand.name} · Sistema de rifas
      </footer>
    </main>
  );
}
