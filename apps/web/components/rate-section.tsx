"use client";

import { useState } from "react";
import { api } from "@/lib/trpc";
import { toast } from "react-hot-toast";
import { Loader2, RefreshCw, Check, DollarSign } from "lucide-react";

const SOURCE_LABELS: Record<string, string> = {
  BCV: "BCV",
  BINANCE: "Binance P2P (automática)",
  MANUAL: "Manual",
};

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleString("es-VE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export function RateSection() {
  const utils = api.useContext();
  const { data: rate, isLoading } = api.settings.getRate.useQuery();
  const [manual, setManual] = useState("");

  const refresh = api.settings.refreshRate.useMutation({
    onSuccess: () => {
      toast.success("Tasa de Binance P2P actualizada");
      utils.settings.getRate.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const setManualRate = api.settings.setManualRate.useMutation({
    onSuccess: () => {
      toast.success("Tasa manual guardada");
      setManual("");
      utils.settings.getRate.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  function saveManual() {
    const v = Number(manual);
    if (!v || v <= 0) {
      toast.error("Ingresa una tasa válida (Bs por USD)");
      return;
    }
    setManualRate.mutate({ vesPerUsd: v });
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border p-6 space-y-4">
      <div className="flex items-center gap-2">
        <DollarSign className="w-5 h-5 text-slate-700" />
        <h2 className="text-lg font-semibold text-slate-900">Tasa de cambio (USD → VES)</h2>
      </div>
      <p className="-mt-2 text-sm text-slate-500">
        Se usa para mostrar el equivalente en bolívares en el tablero, el detalle de venta y el recibo.
      </p>

      {/* Tasa actual */}
      <div className="rounded-xl border bg-slate-50 p-4">
        {isLoading ? (
          <div className="flex justify-center text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : rate ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold text-slate-900">
                {Number(rate.vesPerUsd).toLocaleString("es-VE", { maximumFractionDigits: 4 })}{" "}
                <span className="text-base font-normal text-slate-500">Bs / USD</span>
              </p>
              <p className="text-xs text-slate-500">
                {SOURCE_LABELS[rate.source] ?? rate.source} · {fmtDate(rate.createdAt)}
              </p>
            </div>
            <Check className="h-6 w-6 text-green-500" />
          </div>
        ) : (
          <p className="text-sm text-slate-500">Aún no hay tasa configurada.</p>
        )}
      </div>

      {/* Actualizar desde Binance P2P */}
      <button
        onClick={() => refresh.mutate()}
        disabled={refresh.isLoading}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {refresh.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        Actualizar desde Binance P2P
      </button>

      {/* Override manual */}
      <div className="rounded-xl border p-4">
        <label className="mb-1 block text-xs font-medium text-slate-500">
          Tasa manual (si la fuente automática falla)
        </label>
        <div className="flex gap-2">
          <input
            inputMode="decimal"
            type="number"
            step="0.0001"
            min="0"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Ej: 36.5000"
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
          />
          <button
            onClick={saveManual}
            disabled={setManualRate.isLoading}
            className="whitespace-nowrap rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {setManualRate.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
