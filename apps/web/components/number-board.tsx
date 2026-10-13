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

const METHOD_LABELS: Record<string, string> = {
  PAGO_MOVIL: "Pago Móvil",
  ZELLE: "Zelle",
  BINANCE: "Binance / USDT",
  ZINLI: "Zinli",
  EFECTIVO_USD: "Efectivo USD",
  EFECTIVO_VES: "Efectivo Bs",
  TRANSFERENCIA_VES: "Transferencia Bs",
  NEQUI: "Nequi",
  BANCOLOMBIA: "Bancolombia",
  CASH: "Efectivo (otro)",
  BANK_TRANSFER: "Transferencia",
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
  discountPackages,
}: {
  raffleId: string;
  raffleStatus: string;
  pricePerNumber: number;
  discountPackages?: { qty: number; discountPercent: number }[] | null;
}) {
  const utils = api.useContext();
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  // Filtros de paridad (riffas.info): vendedor, método de pago y rango de fechas.
  const [vendorId, setVendorId] = useState("");
  const [method, setMethod] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Selección multi-número: tocar un disponible lo suma a la venta en curso.
  const [selected, setSelected] = useState<string[]>([]);
  // Sheets abiertas
  const [sellNumbers, setSellNumbers] = useState<string[] | null>(null);
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
  }, [status, vendorId, method, dateFrom, dateTo]);

  const { data: stats } = api.raffle.getStats.useQuery({ id: raffleId });
  const { data: vendors } = api.vendor.list.useQuery();
  const { data, isLoading, isFetching } = api.raffle.listNumbers.useQuery({
    raffleId,
    status,
    search: search || undefined,
    vendorId: vendorId || undefined,
    paymentMethod: method || undefined,
    dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : undefined,
    dateTo: dateTo ? new Date(`${dateTo}T23:59:59`).toISOString() : undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const hasExtraFilters = !!(vendorId || method || dateFrom || dateTo);

  function refreshBoard() {
    utils.raffle.listNumbers.invalidate();
    utils.raffle.getStats.invalidate({ id: raffleId });
    utils.raffle.getById.invalidate({ id: raffleId });
  }

  function onPillClick(n: { number: string; status: string; saleId: string | null }) {
    if (n.status === "AVAILABLE") {
      // Toca para sumar/quitar de la selección; se venden todos de una vez.
      setSelected((cur) =>
        cur.includes(n.number) ? cur.filter((x) => x !== n.number) : [...cur, n.number],
      );
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

      {/* Filtros avanzados: vendedor, método de pago, fechas de venta */}
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <select
          value={vendorId}
          onChange={(e) => setVendorId(e.target.value)}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
        >
          <option value="">Vendedor: todos</option>
          {((vendors as any)?.vendors ?? []).map((v: any) => (
            <option key={v.id} value={v.id}>
              {v.name} {v.lastName ?? ""}
            </option>
          ))}
        </select>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
        >
          <option value="">Método: todos</option>
          {Object.entries(METHOD_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          aria-label="Vendidos desde"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          aria-label="Vendidos hasta"
        />
      </div>
      {hasExtraFilters && (
        <button
          onClick={() => { setVendorId(""); setMethod(""); setDateFrom(""); setDateTo(""); }}
          className="mb-3 text-xs font-medium text-blue-600 hover:underline"
        >
          Limpiar filtros
        </button>
      )}

      {/* Grilla de pastillas */}
      {/* Barra de selección multi-número */}
      {selected.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
          <span className="text-sm font-medium text-blue-900">
            {selected.length} seleccionado{selected.length === 1 ? "" : "s"}:{" "}
            <span className="font-mono">
              {selected.slice(0, 6).join(", ")}
              {selected.length > 6 ? ` +${selected.length - 6}` : ""}
            </span>
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setSelected([])}
              className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Limpiar
            </button>
            <button
              onClick={() => setSellNumbers(selected)}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Vender ({selected.length})
            </button>
          </div>
        </div>
      )}

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
                selected.includes(n.number)
                  ? "bg-blue-600 text-white border border-blue-700 ring-2 ring-blue-300"
                  : PILL_STYLES[n.status] ?? PILL_STYLES.AVAILABLE
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
      {sellNumbers && (
        <SellNumberSheet
          raffleId={raffleId}
          raffleStatus={raffleStatus}
          numbers={sellNumbers}
          pricePerNumber={pricePerNumber}
          discountPackages={discountPackages}
          onClose={() => {
            setSellNumbers(null);
            setSelected([]);
          }}
          onSold={() => {
            setSellNumbers(null);
            setSelected([]);
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
