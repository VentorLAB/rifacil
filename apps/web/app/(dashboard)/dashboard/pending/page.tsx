"use client";

import { api } from "@/lib/trpc";
import { toast } from "react-hot-toast";
import { Loader2, Check, X, Receipt, ClipboardCheck, ImageIcon } from "lucide-react";

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
};

const money = (v: unknown) =>
  `$${Number(v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleString("es-VE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function PendingPage() {
  const utils = api.useContext();
  const { data, isLoading } = api.sale.listPending.useQuery();

  const refresh = () => {
    utils.sale.listPending.invalidate();
    utils.raffle.getStats.invalidate();
    utils.raffle.listNumbers.invalidate();
    utils.sale.list.invalidate();
  };

  const confirm = api.sale.confirmSale.useMutation({
    onSuccess: (res: any) => {
      toast.success(res.isFullyPaid ? "Aprobada · pagado ✓" : "Aprobada · apartado ✓");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const reject = api.sale.rejectSale.useMutation({
    onSuccess: () => {
      toast.success("Rechazada · número(s) liberados");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const sales = data?.sales ?? [];
  const busyId = confirm.variables?.id ?? reject.variables?.id;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-6 w-6 text-slate-700" />
        <h1 className="text-2xl font-bold text-slate-900">Por confirmar</h1>
        {sales.length > 0 && (
          <span className="rounded-full bg-yellow-100 px-2.5 py-0.5 text-sm font-semibold text-yellow-800">
            {sales.length}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : sales.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white p-10 text-center text-slate-500">
          <p className="font-medium text-slate-700">No hay pagos por confirmar</p>
          <p className="mt-1 text-sm">Los apartados desde la página pública aparecerán aquí.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {sales.map((s: any) => {
            const debt = Math.max(0, Number(s.finalAmount) - Number(s.amountPaid));
            const proof = s.paymentProof || s.payments?.[0]?.proofUrl;
            const isBusy = busyId === s.id && (confirm.isLoading || reject.isLoading);
            return (
              <div key={s.id} className="rounded-xl border bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{s.contact?.name ?? "—"}</p>
                    <p className="text-sm text-slate-500">{s.contact?.phone}</p>
                    <p className="text-xs text-slate-400">
                      {s.raffle?.title} · {fmtDate(s.createdAt)}
                    </p>
                  </div>
                  <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
                    Por confirmar
                  </span>
                </div>

                <p className="mt-2 font-mono text-sm text-slate-700">{s.numbers.join(", ")}</p>

                <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-slate-400">Total</p>
                    <p className="font-medium text-slate-900">{money(s.finalAmount)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Reportado</p>
                    <p className="font-medium text-green-600">{money(s.amountPaid)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Deuda</p>
                    <p className="font-medium text-red-600">{money(debt)}</p>
                  </div>
                </div>

                <p className="mt-2 text-xs text-slate-500">
                  {METHOD_LABELS[s.paymentMethod] ?? s.paymentMethod}
                  {s.paymentReference ? ` · Ref: ${s.paymentReference}` : ""}
                </p>

                {proof ? (
                  <a
                    href={proof}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 flex items-center gap-2 text-sm text-blue-600 hover:underline"
                  >
                    <Receipt className="h-4 w-4" /> Ver comprobante
                  </a>
                ) : (
                  <p className="mt-2 flex items-center gap-2 text-sm text-slate-400">
                    <ImageIcon className="h-4 w-4" /> Sin comprobante
                  </p>
                )}

                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => confirm.mutate({ id: s.id })}
                    disabled={isBusy}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-green-600 py-2.5 font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {isBusy && confirm.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Aprobar
                  </button>
                  <button
                    onClick={() => {
                      if (confirm.isLoading || reject.isLoading) return;
                      if (window.confirm(`¿Rechazar y liberar ${s.numbers.length} número(s)?`)) {
                        reject.mutate({ id: s.id });
                      }
                    }}
                    disabled={isBusy}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-red-200 py-2.5 font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    {isBusy && reject.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                    Rechazar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
