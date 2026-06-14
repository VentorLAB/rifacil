"use client";
import { api } from "@/lib/trpc";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { PaymentAccountsSection } from "@/components/payment-accounts-section";

export default function SettingsPage() {
  const { data: settings, refetch } = api.settings.get.useQuery();
  const updateSettings = api.settings.update.useMutation({
    onSuccess: () => {
      toast.success("Configuración actualizada");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  // El resaltado sigue al valor guardado; `override` aplica el clic al instante.
  const [override, setOverride] = useState<string | null>(null);
  const theme = override ?? settings?.theme ?? "system";

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Configuracion</h1>
      <div className="bg-white dark:bg-slate-900 rounded-xl border p-6 space-y-4">
        <h2 className="text-lg font-semibold">Apariencia</h2>
        <div>
          <label className="block text-sm font-medium mb-2">Tema</label>
          <div className="flex gap-2">
            {["light", "dark", "system"].map((t) => (
              <button key={t} onClick={() => { setOverride(t); updateSettings.mutate({ theme: t as any }); }}
                className={`px-4 py-2 rounded-lg border ${theme === t ? "bg-blue-600 text-white border-blue-600" : "hover:bg-slate-50"}`}>
                {t === "light" ? "Claro" : t === "dark" ? "Oscuro" : "Sistema"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <PaymentAccountsSection />
    </div>
  );
}
