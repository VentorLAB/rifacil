"use client";
import { useState } from "react";
import { api } from "@/lib/trpc";
import { SaleDetailSheet } from "@/components/sale-detail-sheet";

const money = (v: unknown) =>
  `$${Number(v ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const STATUS_STYLES: Record<string, string> = {
  PAID: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  RESERVED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  PENDING: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  CANCELLED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  REFUNDED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

const STATUS_LABELS: Record<string, string> = {
  PAID: "Pagada",
  RESERVED: "Apartada",
  PENDING: "Pendiente",
  CANCELLED: "Cancelada",
  REFUNDED: "Reembolsada",
};

export default function SalesPage() {
  const { data } = api.sale.list.useQuery({ limit: 50 });
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Ventas</h1>

      <div className="overflow-x-auto rounded-xl border bg-white dark:bg-slate-900">
        <table className="w-full min-w-[560px]">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">Recibo</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">Cliente</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">Total</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">Deuda</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-slate-800">
            {data?.sales.map((s) => {
              const debt = Math.max(
                0,
                Number((Number(s.finalAmount) - Number(s.amountPaid)).toFixed(2))
              );
              return (
                <tr
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <td className="px-4 py-3 font-mono text-sm">{s.receiptNumber}</td>
                  <td className="px-4 py-3">{s.contact.name}</td>
                  <td className="px-4 py-3 text-right">{money(s.finalAmount)}</td>
                  <td
                    className={`px-4 py-3 text-right font-medium ${
                      debt > 0
                        ? "text-red-600 dark:text-red-400"
                        : "text-slate-400"
                    }`}
                  >
                    {money(debt)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${
                        STATUS_STYLES[s.status] ?? STATUS_STYLES.PENDING
                      }`}
                    >
                      {STATUS_LABELS[s.status] ?? s.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {data && data.sales.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            Aún no hay ventas.
          </p>
        )}
      </div>

      {selected && (
        <SaleDetailSheet saleId={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
