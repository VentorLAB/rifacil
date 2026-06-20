"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/trpc";
import { toast } from "react-hot-toast";
import { X, Loader2, Search, UserPlus, Check, Receipt } from "lucide-react";

// Métodos de pago ofrecidos (Venezuela primero).
const METHODS = [
  "PAGO_MOVIL",
  "BINANCE",
  "ZELLE",
  "ZINLI",
  "EFECTIVO_USD",
  "EFECTIVO_VES",
  "TRANSFERENCIA_VES",
  "BANCOLOMBIA",
] as const;
const METHOD_LABELS: Record<(typeof METHODS)[number], string> = {
  PAGO_MOVIL: "Pago Móvil",
  BINANCE: "Binance / USDT",
  ZELLE: "Zelle",
  ZINLI: "Zinli",
  EFECTIVO_USD: "Efectivo USD",
  EFECTIVO_VES: "Efectivo Bs",
  TRANSFERENCIA_VES: "Transferencia Bs",
  BANCOLOMBIA: "Bancolombia",
};

const money = (v: unknown) =>
  `$${Number(v ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

type PickedContact = { id: string; name: string; phone: string };

export function SellNumberSheet({
  raffleId,
  raffleStatus,
  number,
  pricePerNumber,
  onClose,
  onSold,
}: {
  raffleId: string;
  raffleStatus: string;
  number: string;
  pricePerNumber: number;
  onClose: () => void;
  onSold: () => void;
}) {
  const total = pricePerNumber;

  // --- Cliente: buscar existente (fuzzy) o crear nuevo ---
  const [mode, setMode] = useState<"search" | "new">("search");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [picked, setPicked] = useState<PickedContact | null>(null);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data: searchData, isFetching } = api.contact.list.useQuery(
    { search: debounced, limit: 8 },
    { enabled: mode === "search" && debounced.length >= 2 && !picked }
  );

  // Tasa USD->VES para mostrar el equivalente en Bs.
  const { data: rate } = api.settings.getRate.useQuery();
  const vesPerUsd = rate ? Number(rate.vesPerUsd) : null;
  const bs = (v: number) =>
    vesPerUsd ? `${(v * vesPerUsd).toLocaleString("es-VE", { maximumFractionDigits: 2 })} Bs` : null;

  // --- Pago ---
  const [amount, setAmount] = useState(String(total));
  const [method, setMethod] = useState<(typeof METHODS)[number]>("PAGO_MOVIL");
  const [reference, setReference] = useState("");

  const paid = Number(amount) || 0;
  const debt = useMemo(() => Math.max(0, Number((total - paid).toFixed(2))), [total, paid]);
  const willReserve = paid > 0 && paid < total; // apartado
  const isActive = raffleStatus === "ACTIVE";

  const createSale = api.sale.create.useMutation({
    onSuccess: (res) => {
      toast.success(
        res.isFullyPaid
          ? `¡Número ${number} vendido! 🎉`
          : `Número ${number} apartado · Deuda ${money(res.debt)}`
      );
      onSold();
    },
    onError: (e) => toast.error(e.message || "No se pudo registrar la venta"),
  });

  function submit() {
    if (paid < 0) {
      toast.error("El monto no puede ser negativo");
      return;
    }
    if (paid - total > 0.001) {
      toast.error(`El abono supera el total (${money(total)})`);
      return;
    }

    const base = {
      raffleId,
      numbers: [number],
      paymentMethod: method,
      amountPaid: Number(paid.toFixed(2)),
      paymentReference: reference.trim() || undefined,
    };

    if (mode === "search") {
      if (!picked) {
        toast.error("Busca y selecciona un cliente");
        return;
      }
      createSale.mutate({ ...base, contactId: picked.id });
    } else {
      if (!newName.trim() || !newPhone.trim()) {
        toast.error("Completa nombre y teléfono del cliente");
        return;
      }
      createSale.mutate({
        ...base,
        contactData: { name: newName.trim(), phone: newPhone.trim() },
      });
    }
  }

  const contacts = searchData?.contacts ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Vender / Apartar</h2>
            <p className="font-mono text-sm text-slate-500">Número {number}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {!isActive && (
            <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
              La rifa no está activa. Actívala para registrar ventas.
            </div>
          )}

          {/* --- Cliente --- */}
          <div>
            <div className="mb-2 flex gap-2">
              <TabBtn active={mode === "search"} onClick={() => setMode("search")}>
                <Search className="h-4 w-4" /> Buscar cliente
              </TabBtn>
              <TabBtn active={mode === "new"} onClick={() => setMode("new")}>
                <UserPlus className="h-4 w-4" /> Nuevo
              </TabBtn>
            </div>

            {mode === "search" ? (
              picked ? (
                <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{picked.name}</p>
                    <p className="truncate text-sm text-slate-500">{picked.phone}</p>
                  </div>
                  <button
                    onClick={() => setPicked(null)}
                    className="ml-3 shrink-0 text-sm text-blue-600 hover:underline"
                  >
                    Cambiar
                  </button>
                </div>
              ) : (
                <div>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Nombre o teléfono…"
                      className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-9 pr-4 text-slate-900"
                    />
                    {isFetching && (
                      <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
                    )}
                  </div>
                  {debounced.length >= 2 && (
                    <ul className="mt-2 max-h-48 divide-y overflow-y-auto rounded-xl border">
                      {contacts.length === 0 && !isFetching ? (
                        <li className="px-4 py-3 text-sm text-slate-400">
                          Sin resultados.{" "}
                          <button
                            onClick={() => {
                              setMode("new");
                              setNewName(query);
                            }}
                            className="text-blue-600 hover:underline"
                          >
                            Crear cliente nuevo
                          </button>
                        </li>
                      ) : (
                        contacts.map((c: any) => (
                          <li key={c.id}>
                            <button
                              onClick={() =>
                                setPicked({ id: c.id, name: c.name, phone: c.phone })
                              }
                              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
                            >
                              <div className="min-w-0">
                                <p className="truncate font-medium text-slate-900">{c.name}</p>
                                <p className="truncate text-sm text-slate-500">{c.phone}</p>
                              </div>
                              <Check className="ml-3 h-4 w-4 shrink-0 text-slate-300" />
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </div>
              )
            ) : (
              <div className="space-y-3">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nombre del cliente"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
                />
                <input
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="WhatsApp (ej: 0424 123 4567)"
                  inputMode="tel"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
                />
              </div>
            )}
          </div>

          {/* --- Pago --- */}
          <div className="rounded-xl border p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-slate-500">Valor del número</span>
              <span className="text-right">
                <span className="block text-sm font-semibold text-slate-900">{money(total)}</span>
                {bs(total) && <span className="block text-xs text-slate-400">≈ {bs(total)}</span>}
              </span>
            </div>

            <label className="mb-1 block text-xs font-medium text-slate-500">
              Monto a cobrar ahora (USD)
            </label>
            <div className="flex gap-2">
              <input
                inputMode="decimal"
                type="number"
                step="0.01"
                min="0"
                max={total}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
              />
              <button
                type="button"
                onClick={() => setAmount(String(total))}
                className="whitespace-nowrap rounded-xl border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Pagar todo
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className={willReserve ? "font-medium text-orange-600" : "text-slate-400"}>
                {willReserve ? `Quedará apartado · deuda ${money(debt)}` : "Se marca como vendido"}
              </span>
              {bs(paid) && <span className="text-slate-400">≈ {bs(paid)}</span>}
            </div>

            <label className="mb-1 mt-4 block text-xs font-medium text-slate-500">Método</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as (typeof METHODS)[number])}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m]}
                </option>
              ))}
            </select>

            <label className="mb-1 mt-4 block text-xs font-medium text-slate-500">
              Referencia (opcional)
            </label>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Nº de operación, últimos dígitos…"
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
            />
          </div>

          <button
            onClick={submit}
            disabled={createSale.isLoading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-3.5 font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {createSale.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <Receipt className="h-5 w-5" />
                {willReserve ? "Apartar número" : "Vender número"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium ${
        active
          ? "border-blue-600 bg-blue-50 text-blue-700"
          : "border-slate-200 text-slate-500 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}
