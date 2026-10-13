"use client";

import { useState } from "react";
import { api } from "@/lib/trpc";
import { BarChart3, Loader2 } from "lucide-react";

// Contador de envíos por WhatsApp de Meta (Cloud API) + costo estimado.
// Los datos vienen del metering por tenant (WhatsappMessageLog: cada plantilla
// enviada por recibo automático o campaña). El VOLUMEN es exacto; el COSTO es
// una estimación por tarifa Meta del país del destinatario (cada rifero paga su
// propia WABA — esto solo le muestra cuánto está gastando).

const VE_MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

// "2026-10" → "octubre 2026"
function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return month;
  return `${VE_MONTHS[m - 1]} ${y}`;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

const STATUS_LABELS: Record<string, string> = {
  SENT: "Enviados",
  DELIVERED: "Entregados",
  READ: "Leídos",
  FAILED: "Fallidos",
};
const STATUS_ORDER = ["SENT", "DELIVERED", "READ", "FAILED"];

const CATEGORY_LABELS: Record<string, string> = {
  UTILITY: "Utilidad (recibos)",
  MARKETING: "Marketing",
  AUTHENTICATION: "Autenticación",
  SERVICE: "Servicio",
};

export function WhatsappUsageCard() {
  const [month, setMonth] = useState(currentMonth());
  const usage = api.analytics.whatsappUsage.useQuery({ month }, { retry: false });

  const u = usage.data;
  const statusEntries = u
    ? STATUS_ORDER.filter((k) => (u.byStatus[k] ?? 0) > 0).map((k) => ({
        label: STATUS_LABELS[k] ?? k,
        count: u.byStatus[k],
      }))
    : [];
  const categoryEntries = u
    ? Object.entries(u.byCategory)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => ({ label: CATEGORY_LABELS[k] ?? k, count: n }))
    : [];

  return (
    <div className="space-y-4 rounded-xl border bg-white p-6 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-slate-700 dark:text-slate-300" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Envíos por Meta{u ? ` · ${monthLabel(u.month)}` : ""}
          </h2>
        </div>
        <input
          type="month"
          value={month}
          max={currentMonth()}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          className="rounded-lg border px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
          aria-label="Mes"
        />
      </div>

      {usage.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Contando mensajes…
        </div>
      ) : usage.isError ? (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          No se pudo cargar el conteo de envíos.
        </div>
      ) : u && u.totalMessages === 0 ? (
        <p className="text-sm text-slate-500">
          Todavía no hay envíos por Meta en {monthLabel(u.month)}. Los recibos
          automáticos y las campañas por plantilla se cuentan aquí.
        </p>
      ) : u ? (
        <>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <div className="text-3xl font-bold text-slate-900 dark:text-white">
                {u.totalMessages.toLocaleString("en-US")}
              </div>
              <div className="text-xs text-slate-500">mensajes en {monthLabel(u.month)}</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-slate-900 dark:text-white">
                ≈ ${u.costUsdEstimated.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-slate-500">costo estimado del mes</div>
            </div>
          </div>

          {statusEntries.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {statusEntries.map((s) => (
                <span
                  key={s.label}
                  className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  {s.label}: {s.count}
                </span>
              ))}
            </div>
          )}

          {categoryEntries.length > 0 && (
            <div className="text-xs text-slate-500">
              {categoryEntries.map((c) => `${c.label}: ${c.count}`).join(" · ")}
            </div>
          )}

          <p className="text-xs text-slate-400">
            El conteo es exacto; el costo es una estimación según la tarifa de Meta
            para el país de cada cliente (las utility dentro de la ventana de
            servicio pueden salir en $0). El cobro real lo ves en tu cuenta de Meta.
          </p>
        </>
      ) : null}
    </div>
  );
}
