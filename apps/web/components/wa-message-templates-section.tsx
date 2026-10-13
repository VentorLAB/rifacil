"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/trpc";
import { toast } from "react-hot-toast";
import { MessageSquareText, Loader2, RotateCcw, Eye } from "lucide-react";
import {
  buildReceiptMessage,
  DEFAULT_WA_TEMPLATES,
  WA_TEMPLATE_VARIABLES,
  type WaTemplateKey,
} from "@riffas/shared";

// Mensajes de WhatsApp EDITABLES (wa.me, canal manual/gratis): el rifero
// reescribe los textos del recibo — apartado y compra pagada por separado —
// con variables {{nombre}}, {{numeros}}, {{total}}… Sin plantilla propia se
// usa el texto de siempre (visible como punto de partida). No toca el envío
// automático por Cloud API (eso son las plantillas Meta, sección de arriba).
export function WaMessageTemplatesSection() {
  const utils = api.useContext();
  const { data, isLoading } = api.settings.getWaTemplates.useQuery();
  const save = api.settings.saveWaTemplates.useMutation({
    onSuccess: () => {
      toast.success("Mensajes guardados");
      utils.settings.getWaTemplates.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const [tab, setTab] = useState<WaTemplateKey>("apartado");
  const [apartado, setApartado] = useState("");
  const [pagado, setPagado] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!data || loaded) return;
    setApartado(data.templates.apartado ?? data.defaults.apartado);
    setPagado(data.templates.pagado ?? data.defaults.pagado);
    setLoaded(true);
  }, [data, loaded]);

  // Vista previa con datos de ejemplo: usa el MISMO builder del wa.me, así lo
  // que ves es lo que sale en WhatsApp (formato, montos, fechas).
  const preview = useMemo(() => {
    const tpl = tab === "apartado" ? { apartado } : { pagado };
    const sample =
      tab === "apartado"
        ? { paid: 10, status: "RESERVED", total: 20 }
        : { paid: 20, status: "PAID", total: 20 };
    return buildReceiptMessage(
      {
        phone: "04241234567",
        contactName: "María",
        brandName: "Tu Marca",
        raffleTitle: "Toyota Agya 2026",
        numbers: ["045", "102"],
        pricePerNumber: 10,
        drawDate: new Date("2026-12-20T23:00:00Z"),
        reservedAt: new Date(),
        receiptShareUrl: "https://ibb.co/ejemplo",
        brandUrl: "tumarca.com",
        ...sample,
      },
      tpl
    );
  }, [tab, apartado, pagado]);

  const current = tab === "apartado" ? apartado : pagado;
  const setCurrent = tab === "apartado" ? setApartado : setPagado;
  const dirty =
    loaded &&
    ((apartado !== (data?.templates.apartado ?? data?.defaults.apartado)) ||
      (pagado !== (data?.templates.pagado ?? data?.defaults.pagado)));

  return (
    <div className="space-y-4 rounded-xl border bg-white p-6 dark:bg-slate-900">
      <div className="flex items-center gap-2">
        <MessageSquareText className="h-5 w-5 text-slate-700" />
        <h2 className="text-lg font-semibold text-slate-900">Mensajes de WhatsApp (wa.me)</h2>
      </div>
      <p className="text-sm text-slate-500">
        Los textos del mensaje que se abre en tu WhatsApp al enviar el recibo (el gratis de
        siempre). Edítalos a tu estilo con variables como <code>{"{{nombre}}"}</code> y{" "}
        <code>{"{{numeros}}"}</code>. Si una variable no tiene valor, su línea se omite sola.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : (
        <>
          {/* Tabs apartado / pagada */}
          <div className="flex gap-2 rounded-xl bg-slate-100 p-1">
            {(["apartado", "pagado"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
                  tab === k ? "bg-white shadow text-slate-900" : "text-slate-500"
                }`}
              >
                {k === "apartado" ? "🍀 Apartado / abono" : "🎉 Compra pagada"}
              </button>
            ))}
          </div>

          <textarea
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            rows={14}
            spellCheck={false}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono text-sm text-slate-900"
          />

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                save.mutate({
                  apartado: apartado === data?.defaults.apartado ? null : apartado,
                  pagado: pagado === data?.defaults.pagado ? null : pagado,
                })
              }
              disabled={save.isPending || !dirty}
              className="flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-40"
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar mensajes
            </button>
            <button
              onClick={() => setCurrent(data?.defaults[tab] ?? DEFAULT_WA_TEMPLATES[tab])}
              className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              <RotateCcw className="h-4 w-4" /> Restaurar texto original
            </button>
          </div>

          {/* Vista previa */}
          <div>
            <p className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-500">
              <Eye className="h-3.5 w-3.5" /> Vista previa (datos de ejemplo)
            </p>
            <pre className="whitespace-pre-wrap rounded-xl border bg-slate-50 p-4 text-sm text-slate-700">{preview}</pre>
          </div>

          {/* Variables disponibles */}
          <details className="rounded-xl border border-slate-200 px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-slate-600">
              Variables disponibles ({WA_TEMPLATE_VARIABLES.length})
            </summary>
            <ul className="mt-2 space-y-1 text-xs text-slate-500">
              {WA_TEMPLATE_VARIABLES.map((v) => (
                <li key={v.key}>
                  <code className="rounded bg-slate-100 px-1">{`{{${v.key}}}`}</code> — {v.label}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
