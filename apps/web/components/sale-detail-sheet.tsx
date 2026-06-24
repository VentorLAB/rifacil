"use client";

import { useState } from "react";
import { api } from "@/lib/trpc";
import { toast } from "react-hot-toast";
import { buildReceiptWaLink } from "@riffas/shared";
import { X, Loader2, Plus, Receipt, MessageCircle } from "lucide-react";

// Etiquetas legibles por método (los del abono primero: Venezuela).
const METHOD_LABELS: Record<string, string> = {
  PAGO_MOVIL: "Pago Móvil",
  BINANCE: "Binance / USDT",
  ZELLE: "Zelle",
  EFECTIVO_USD: "Efectivo USD",
  EFECTIVO_VES: "Efectivo Bs",
  TRANSFERENCIA_VES: "Transferencia Bs",
  NEQUI: "Nequi",
  DAVIPLATA: "Daviplata",
  PSE: "PSE",
  BANK_TRANSFER: "Transferencia",
  MERCADOPAGO: "MercadoPago",
  STRIPE: "Stripe",
  WOMPI: "Wompi",
  CASH: "Efectivo",
  ZINLI: "Zinli",
  BANCOLOMBIA: "Bancolombia",
};

// Métodos ofrecidos para registrar un abono.
const ABONO_METHODS = [
  "PAGO_MOVIL",
  "BINANCE",
  "ZELLE",
  "ZINLI",
  "EFECTIVO_USD",
  "EFECTIVO_VES",
  "BANCOLOMBIA",
] as const;

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

const money = (v: unknown) =>
  `$${Number(v ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleString("es-VE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export function SaleDetailSheet({
  saleId,
  onClose,
}: {
  saleId: string;
  onClose: () => void;
}) {
  const utils = api.useContext();
  const { data: sale, isLoading } = api.sale.getById.useQuery({ id: saleId });

  const [amount, setAmount] = useState("");
  const [method, setMethod] =
    useState<(typeof ABONO_METHODS)[number]>("PAGO_MOVIL");
  const [reference, setReference] = useState("");

  const addPayment = api.sale.addPayment.useMutation({
    onSuccess: (res) => {
      toast.success(
        res.isFullyPaid
          ? "¡Venta saldada! 🎉"
          : `Abono registrado · Deuda ${money(res.debt)}`
      );
      setAmount("");
      setReference("");
      // Refrescar el detalle (deuda + historial) y la lista de ventas.
      utils.sale.getById.invalidate({ id: saleId });
      utils.sale.list.invalidate();
    },
    onError: (e) => toast.error(e.message || "No se pudo registrar el abono"),
  });

  const total = Number(sale?.finalAmount ?? 0);
  const paid = Number(sale?.amountPaid ?? 0);
  const debt = Math.max(0, Number((total - paid).toFixed(2)));
  const settled = !!sale && debt <= 0;
  const closed = sale?.status === "CANCELLED" || sale?.status === "REFUNDED";
  const rate = sale?.rateUsed ? Number(sale.rateUsed) : null;

  function submit() {
    const n = Number(amount);
    if (!n || n <= 0) {
      toast.error("Ingresá un monto válido");
      return;
    }
    if (n - debt > 0.001) {
      toast.error(`El abono supera la deuda (${money(debt)})`);
      return;
    }
    addPayment.mutate({
      saleId,
      amount: Number(n.toFixed(2)),
      paymentMethod: method,
      reference: reference.trim() || undefined,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl dark:bg-slate-900 sm:max-w-lg sm:rounded-2xl">
        {/* Header pegajoso */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Detalle de venta
            </h2>
            <p className="font-mono text-xs text-slate-500">
              {sale?.receiptNumber ?? "…"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {isLoading || !sale ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="space-y-5 p-5">
            {/* Cliente + rifa */}
            <div className="space-y-1">
              <p className="font-semibold text-slate-900 dark:text-white">
                {sale.contact.name}
              </p>
              <p className="text-sm text-slate-500">{sale.contact.phone}</p>
              <p className="text-sm text-slate-500">{sale.raffle.title}</p>
              <p className="text-sm text-slate-500">
                Boletos:{" "}
                <span className="font-mono text-slate-700 dark:text-slate-300">
                  {sale.numbers.join(", ")}
                </span>
              </p>
            </div>

            {/* Montos */}
            <div className="rounded-xl border p-4 dark:border-slate-700">
              <Row label="Valor total" value={money(total)} />
              <Row
                label="Abonado"
                value={money(paid)}
                valueClass="text-green-600 dark:text-green-400"
              />
              <Row
                label="Deuda"
                value={money(debt)}
                valueClass={
                  debt > 0
                    ? "text-red-600 dark:text-red-400"
                    : "text-slate-400"
                }
              />
              {rate && (
                <div className="mt-2 border-t pt-2 dark:border-slate-700">
                  <Row label="Tasa" value={`${rate.toLocaleString("es-VE", { maximumFractionDigits: 4 })} Bs/USD`} />
                  <Row
                    label={debt > 0 ? "Deuda en Bs" : "Total en Bs"}
                    value={`${((debt > 0 ? debt : total) * rate).toLocaleString("es-VE", { maximumFractionDigits: 2 })} Bs`}
                  />
                </div>
              )}
              <div className="mt-3">
                <span
                  className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${
                    STATUS_STYLES[sale.status] ?? STATUS_STYLES.PENDING
                  }`}
                >
                  {STATUS_LABELS[sale.status] ?? sale.status}
                </span>
              </div>
            </div>

            {/* Historial de abonos */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Historial de abonos
              </h3>
              {sale.payments.length === 0 ? (
                <p className="text-sm text-slate-400">
                  Sin abonos registrados.
                </p>
              ) : (
                <ul className="divide-y rounded-xl border dark:divide-slate-700 dark:border-slate-700">
                  {sale.payments.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 dark:text-white">
                          {money(p.amount)}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {METHOD_LABELS[p.method] ?? p.method}
                          {p.reference ? ` · ${p.reference}` : ""} ·{" "}
                          {fmtDate(p.createdAt)}
                        </p>
                      </div>
                      <span className="ml-3 shrink-0 text-xs text-slate-400">
                        {p.status === "CONFIRMED" ? "Confirmado" : p.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Registrar abono / estados terminales */}
            {settled ? (
              <div className="rounded-xl bg-green-50 p-4 text-center text-sm font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
                Venta saldada por completo ✓
              </div>
            ) : closed ? (
              <div className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 dark:bg-slate-800">
                Venta {sale.status === "CANCELLED" ? "cancelada" : "reembolsada"}{" "}
                — no admite abonos.
              </div>
            ) : (
              <div className="rounded-xl border p-4 dark:border-slate-700">
                <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Registrar abono
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">
                      Monto (USD)
                    </label>
                    <div className="flex gap-2">
                      <input
                        inputMode="decimal"
                        type="number"
                        step="0.01"
                        min="0"
                        max={debt}
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder={debt.toFixed(2)}
                        className="w-full rounded-xl border px-4 py-3 dark:border-slate-700 dark:bg-slate-800"
                      />
                      <button
                        type="button"
                        onClick={() => setAmount(debt.toFixed(2))}
                        className="whitespace-nowrap rounded-xl border px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        Saldar todo
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">
                      Método
                    </label>
                    <select
                      value={method}
                      onChange={(e) =>
                        setMethod(
                          e.target.value as (typeof ABONO_METHODS)[number]
                        )
                      }
                      className="w-full rounded-xl border px-4 py-3 dark:border-slate-700 dark:bg-slate-800"
                    >
                      {ABONO_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {METHOD_LABELS[m]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">
                      Referencia (opcional)
                    </label>
                    <input
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="Nº de operación, últimos dígitos…"
                      className="w-full rounded-xl border px-4 py-3 dark:border-slate-700 dark:bg-slate-800"
                    />
                  </div>

                  <button
                    onClick={submit}
                    disabled={addPayment.isLoading}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-3 font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {addPayment.isLoading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        <Plus className="h-5 w-5" /> Registrar abono
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Enviar comprobante por WhatsApp (wa.me, sin Cloud API) */}
            {(() => {
              const waLink = sale.contact.phone
                ? buildReceiptWaLink({
                    phone: sale.contact.phone,
                    contactName: sale.contact.name,
                    brandName: sale.user?.brandName || sale.user?.name,
                    raffleTitle: sale.raffle.title,
                    numbers: sale.numbers,
                    total: sale.finalAmount,
                    paid: sale.amountPaid,
                    receiptUrl: sale.receiptUrl,
                  })
                : null;
              return waLink ? (
                <a
                  href={waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-3 font-medium text-white hover:bg-green-700"
                >
                  <MessageCircle className="h-5 w-5" /> Enviar por WhatsApp
                </a>
              ) : null;
            })()}

            {/* Recibo */}
            {sale.receiptUrl && (
              <a
                href={sale.receiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 text-sm text-blue-600 hover:underline dark:text-blue-400"
              >
                <Receipt className="h-4 w-4" /> Ver recibo
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-slate-500">{label}</span>
      <span
        className={`text-sm font-semibold text-slate-900 dark:text-white ${
          valueClass ?? ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}
