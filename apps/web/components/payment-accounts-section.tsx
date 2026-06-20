"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/trpc";
import { toast } from "react-hot-toast";
import { Loader2, Wallet } from "lucide-react";

// Campos posibles por método. Cada método declara cuáles usa.
type Field = "bankName" | "phone" | "idDocument" | "email" | "wallet" | "holderName" | "accountNumber" | "note";

const FIELD_LABELS: Record<Field, string> = {
  bankName: "Banco",
  phone: "Teléfono",
  idDocument: "Cédula / RIF",
  email: "Correo",
  wallet: "Wallet USDT (o correo)",
  holderName: "Titular",
  accountNumber: "Número de cuenta",
  note: "Notas",
};

const FIELD_PLACEHOLDERS: Partial<Record<Field, string>> = {
  bankName: "Ej: Banesco (0134)",
  phone: "Ej: 0424 123 4567",
  idDocument: "Ej: V-12.345.678 / J-12345678-9",
  email: "correo@ejemplo.com",
  wallet: "Dirección USDT o correo Binance",
  holderName: "Nombre del titular",
  accountNumber: "Ej: 0134 0000 00 0000000000",
  note: "Ej: solo efectivo en el local",
};

// Métodos configurables, con sus campos relevantes (Venezuela primero).
const METHODS: { method: string; label: string; fields: Field[] }[] = [
  { method: "PAGO_MOVIL", label: "Pago Móvil", fields: ["bankName", "phone", "idDocument", "holderName"] },
  { method: "BINANCE", label: "Binance / USDT", fields: ["email", "wallet"] },
  { method: "ZELLE", label: "Zelle", fields: ["email", "holderName", "note"] },
  { method: "ZINLI", label: "Zinli", fields: ["email", "holderName"] },
  { method: "EFECTIVO_USD", label: "Efectivo", fields: ["note"] },
  { method: "TRANSFERENCIA_VES", label: "Transferencia", fields: ["bankName", "accountNumber", "holderName"] },
  { method: "BANCOLOMBIA", label: "Bancolombia", fields: ["accountNumber", "holderName", "idDocument", "note"] },
];

type AccountState = {
  active: boolean;
  bankName: string;
  phone: string;
  idDocument: string;
  email: string;
  wallet: string;
  holderName: string;
  accountNumber: string;
  note: string;
};

const emptyAccount = (): AccountState => ({
  active: false,
  bankName: "",
  phone: "",
  idDocument: "",
  email: "",
  wallet: "",
  holderName: "",
  accountNumber: "",
  note: "",
});

export function PaymentAccountsSection() {
  const utils = api.useContext();
  const { data, isLoading } = api.settings.listPaymentAccounts.useQuery();
  const [state, setState] = useState<Record<string, AccountState>>({});
  const [savingMethod, setSavingMethod] = useState<string | null>(null);

  // Sembrar el estado local desde lo guardado.
  useEffect(() => {
    if (!data) return;
    const next: Record<string, AccountState> = {};
    for (const m of METHODS) {
      const acc = data.find((a) => a.method === m.method);
      next[m.method] = acc
        ? {
            active: acc.active,
            bankName: acc.bankName ?? "",
            phone: acc.phone ?? "",
            idDocument: acc.idDocument ?? "",
            email: acc.email ?? "",
            wallet: acc.wallet ?? "",
            holderName: acc.holderName ?? "",
            accountNumber: acc.accountNumber ?? "",
            note: acc.note ?? "",
          }
        : emptyAccount();
    }
    setState(next);
  }, [data]);

  const save = api.settings.savePaymentAccount.useMutation({
    onSuccess: () => {
      toast.success("Medio de pago guardado");
      utils.settings.listPaymentAccounts.invalidate();
      setSavingMethod(null);
    },
    onError: (e) => {
      toast.error(e.message || "No se pudo guardar");
      setSavingMethod(null);
    },
  });

  function update(method: string, patch: Partial<AccountState>) {
    setState((prev) => ({ ...prev, [method]: { ...prev[method], ...patch } }));
  }

  function handleSave(method: string) {
    const s = state[method];
    if (!s) return;
    setSavingMethod(method);
    save.mutate({ method: method as any, ...s });
  }

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-xl border p-6 flex justify-center text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Wallet className="w-5 h-5 text-slate-700" />
        <h2 className="text-lg font-semibold text-slate-900">Medios de pago / Datos de cobro</h2>
      </div>
      <p className="text-sm text-slate-500 -mt-2">
        Configura tus cuentas. Estos datos se le mostrarán al cliente al momento de pagar.
      </p>

      <div className="space-y-4">
        {METHODS.map((m) => {
          const s = state[m.method] ?? emptyAccount();
          const isSaving = savingMethod === m.method && save.isLoading;
          return (
            <div
              key={m.method}
              className={`rounded-xl border p-4 transition ${
                s.active ? "border-slate-200" : "border-slate-200 bg-slate-50/60"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-900">{m.label}</span>
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <span className="text-xs text-slate-500">{s.active ? "Activo" : "Inactivo"}</span>
                  <span className="relative">
                    <input
                      type="checkbox"
                      checked={s.active}
                      onChange={(e) => update(m.method, { active: e.target.checked })}
                      className="peer sr-only"
                    />
                    <span className="block h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-green-500" />
                    <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition peer-checked:translate-x-5" />
                  </span>
                </label>
              </div>

              {s.active && (
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {m.fields.map((f) => (
                    <div key={f} className={f === "note" ? "sm:col-span-2" : ""}>
                      <label className="mb-1 block text-xs font-medium text-slate-500">
                        {f === "email" && m.method === "BINANCE"
                          ? "Correo Binance"
                          : f === "email" && m.method === "ZELLE"
                          ? "Correo Zelle"
                          : FIELD_LABELS[f]}
                      </label>
                      <input
                        value={s[f]}
                        onChange={(e) => update(m.method, { [f]: e.target.value } as Partial<AccountState>)}
                        placeholder={FIELD_PLACEHOLDERS[f]}
                        inputMode={f === "phone" ? "tel" : undefined}
                        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900"
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => handleSave(m.method)}
                  disabled={isSaving}
                  className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
