"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/trpc";
import { Search, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { SellNumberSheet } from "./sell-number-sheet";
import { SaleDetailSheet } from "./sale-detail-sheet";

const PAGE_SIZE = 120;

type StatusFilter = "ALL" | "AVAILABLE" | "RESERVED" | "SOLD" | "PAID";

// Pastilla por estado. gris=disponible, naranja=apartado, amarillo=por confirmar,
// verde=vendido (pagado).
const PILL_STYLES: Record<string, string> = {
  AVAILABLE: "bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200",
  RESERVED: "bg-orange-400 text-white hover:bg-orange-500",
  SOLD: "bg-yellow-300 text-yellow-900 hover:bg-yellow-400",
  PAID: "bg-green-500 text-white hover:bg-green-600",
};

const FILTERS: { key: StatusFilter; label: string; dot?: string }[] = [
  { key: "ALL", label: "Todos" },
  { key: "AVAILABLE", label: "Disponibles", dot: "bg-slate-300" },
  { key: "RESERVED", label: "Apartados", dot: "bg-orange-400" },
  { key: "SOLD", label: "Por confirmar", dot: "bg-yellow-300" },
  { key: "PAID", label: "Vendidos", dot: "bg-green-500" },
];

export function NumberBoard({
  raffleId,
  raffleStatus,
  pricePerNumber,
}: {
  raffleId: string;
  raffleStatus: string;
  pricePerNumber: number;
}) {
  const utils = api.useContext();
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  // Sheets abiertas
  const [sellNumber, setSellNumber] = useState<string | null>(null);
  const [detailSaleId, setDetailSaleId] = useState<string | null>(null);

  // Debounce del buscador de número.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query.trim());
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  // Resetear página al cambiar de filtro.
  useEffect(() => {
    setPage(0);
  }, [status]);

  const { data: stats } = api.raffle.getStats.useQuery({ id: raffleId });
  const { data, isLoading, isFetching } = api.raffle.listNumbers.useQuery({
    raffleId,
    status,
    search: search || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  function refreshBoard() {
    utils.raffle.listNumbers.invalidate();
    utils.raffle.getStats.invalidate({ id: raffleId });
    utils.raffle.getById.invalidate({ id: raffleId });
  }

  function onPillClick(n: { number: string; status: string; saleId: string | null }) {
    if (n.status === "AVAILABLE") {
      setSellNumber(n.number);
    } else if (n.saleId) {
      setDetailSaleId(n.saleId);
    }
  }

  const counts: Record<StatusFilter, number> = {
    ALL: stats?.total ?? 0,
    AVAILABLE: stats?.available ?? 0,
    RESERVED: stats?.reserved ?? 0,
    SOLD: stats?.sold ?? 0,
    PAID: stats?.paid ?? 0,
  };

  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="rounded-xl border bg-white p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">Tablero de números</h2>
        {isFetching && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
      </div>

      {/* Filtros por estado */}
      <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatus(f.key)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
              status === f.key
                ? "border-blue-600 bg-blue-50 text-blue-700"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {f.dot && <span className={`h-2.5 w-2.5 rounded-full ${f.dot}`} />}
            {f.label}
            <span className="text-xs text-slate-400">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {/* Buscador de número */}
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar número…"
          inputMode="numeric"
          className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-9 pr-4 text-slate-900"
        />
      </div>

      {/* Grilla de pastillas */}
      {isLoading ? (
        <div className="flex justify-center py-12 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : !data || data.numbers.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-slate-50 py-12 text-center text-sm text-slate-500">
          No hay números para este filtro.
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-8 md:grid-cols-10">
          {data.numbers.map((n) => (
            <button
              key={n.id}
              onClick={() => onPillClick(n)}
              title={n.contact ? `${n.contact.name} · ${n.contact.phone}` : `Número ${n.number}`}
              className={`min-h-[44px] rounded-lg py-2 text-center font-mono text-xs font-semibold transition ${
                PILL_STYLES[n.status] ?? PILL_STYLES.AVAILABLE
              }`}
            >
              {n.number}
            </button>
          ))}
        </div>
      )}

      {/* Paginación */}
      {data && data.total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page <= 0}
            className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm text-slate-600 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" /> Anterior
          </button>
          <span className="text-sm text-slate-500">
            Página {page + 1} de {totalPages}
            <span className="ml-2 text-xs text-slate-400">({data.total} números)</span>
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm text-slate-600 disabled:opacity-40"
          >
            Siguiente <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Sheets */}
      {sellNumber && (
        <SellNumberSheet
          raffleId={raffleId}
          raffleStatus={raffleStatus}
          number={sellNumber}
          pricePerNumber={pricePerNumber}
          onClose={() => setSellNumber(null)}
          onSold={() => {
            setSellNumber(null);
            refreshBoard();
          }}
        />
      )}
      {detailSaleId && (
        <SaleDetailSheet
          saleId={detailSaleId}
          onClose={() => {
            setDetailSaleId(null);
            // El detalle puede haber registrado un abono que cambia el estado.
            refreshBoard();
          }}
        />
      )}
    </div>
  );
}
