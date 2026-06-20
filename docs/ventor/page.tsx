"use client";

// Tienda del rifero servida en SU dominio propio (rifashermanospernia.com).
// El middleware reescribe "/" → /t/d/<host>. Aquí resolvemos el rifero por
// dominio y mostramos sus rifas activas. Cada tarjeta enlaza al /r/[id] que ya existe.

import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/trpc";
import { Loader2, Ticket, Calendar } from "lucide-react";

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

export default function TenantStorefront() {
  const params = useParams<{ host: string }>();
  const host = decodeURIComponent(params.host);

  const { data, isLoading, error } = api.public.getStorefrontByDomain.useQuery(
    { host },
    { retry: false }
  );

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 px-6 text-center">
        <h1 className="text-xl font-semibold text-slate-800">Tienda no encontrada</h1>
        <p className="text-slate-500">
          Este dominio aún no está vinculado a un rifero activo.
        </p>
      </div>
    );
  }

  const { brand, raffles } = data;

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Encabezado con la marca del rifero */}
      <header
        className="px-6 py-10 text-white"
        style={{
          background: `linear-gradient(135deg, ${brand.color}, ${brand.colorSecondary})`,
        }}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-4">
          {brand.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logo}
              alt={brand.name}
              className="h-16 w-16 rounded-full border-2 border-white/70 object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20">
              <Ticket className="h-8 w-8" />
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold">{brand.name}</h1>
            <p className="text-white/80">Rifas oficiales · compra segura</p>
          </div>
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
                    <p className="line-clamp-1 text-sm text-slate-500">🏆 {r.prize}</p>
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
