"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/trpc";
import { toast } from "react-hot-toast";
import { MessageCircle, Loader2 } from "lucide-react";

// Conexión de WhatsApp API del rifero: habilita el RECIBO AUTOMÁTICO al vender
// (utility template con imagen). Compatible con coexistencia (misma línea en la
// app Business + API) y con número dedicado. Si no hay conexión, todo sigue por
// wa.me como siempre.
export function WhatsappSection() {
  const utils = api.useContext();
  const { data: settings, isLoading } = api.settings.get.useQuery();
  const { data: usage } = api.analytics.whatsappUsage.useQuery({});

  const [provider, setProvider] = useState<"NONE" | "CLOUD_API" | "YCLOUD">("NONE");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [chatbot, setChatbot] = useState(false);
  const [chatbotInstructions, setChatbotInstructions] = useState("");

  useEffect(() => {
    if (!settings) return;
    setProvider((settings.whatsappProvider as "NONE" | "CLOUD_API" | "YCLOUD") ?? "NONE");
    setPhoneNumber(settings.whatsappPhoneNumber ?? "");
    setPhoneNumberId(settings.whatsappPhoneNumberId ?? "");
    setBusinessId(settings.whatsappBusinessId ?? "");
    setToken(settings.whatsappApiToken ?? "");
    setConnected(!!settings.whatsappConnected);
    setChatbot(!!(settings as any).chatbotEnabled);
    setChatbotInstructions((settings as any).chatbotInstructions ?? "");
  }, [settings]);

  const save = api.settings.update.useMutation({
    onSuccess: () => {
      toast.success("Conexión guardada");
      utils.settings.get.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  function handleSave() {
    save.mutate({
      whatsappProvider: provider,
      whatsappPhoneNumber: phoneNumber || null,
      whatsappPhoneNumberId: phoneNumberId || null,
      whatsappBusinessId: businessId || null,
      whatsappApiToken: token || null,
      whatsappConnected: connected && provider !== "NONE",
      chatbotEnabled: chatbot && connected && provider !== "NONE",
      chatbotInstructions: chatbotInstructions || null,
    } as any);
  }

  const webhookUrl = typeof window !== "undefined" ? `${window.location.origin}/api/webhooks/whatsapp` : "/api/webhooks/whatsapp";

  return (
    <div className="space-y-4 rounded-xl border bg-white p-6 dark:bg-slate-900">
      <div className="flex items-center gap-2">
        <MessageCircle className="h-5 w-5 text-slate-700" />
        <h2 className="text-lg font-semibold text-slate-900">WhatsApp API (recibo automático)</h2>
      </div>
      <div className="rounded-xl bg-green-50 px-4 py-3 text-sm text-green-800">
        Conecta tu WhatsApp API y <b>el recibo le llega solo al comprador</b> cada vez que
        confirmes una venta o un abono, con tu plantilla aprobada. Sin conexión, rifacil sigue
        funcionando con los enlaces wa.me de siempre.
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : (
        <>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Proveedor</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as typeof provider)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
            >
              <option value="NONE">Sin conexión (usar wa.me)</option>
              <option value="CLOUD_API">Meta Cloud API (directo)</option>
              <option value="YCLOUD">YCloud</option>
            </select>
          </div>

          {provider === "CLOUD_API" && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                De tu app en developers.facebook.com: token permanente (System User), Phone Number ID y WABA ID.
              </p>
              <input value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} placeholder="Phone Number ID" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
              <input value={businessId} onChange={(e) => setBusinessId(e.target.value)} placeholder="WhatsApp Business Account ID" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
              <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Token de acceso permanente" type="password" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
            </div>
          )}

          {provider === "YCLOUD" && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                De tu panel de YCloud: la X-API-Key y tu número de WhatsApp con formato internacional.
              </p>
              <input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="Número (ej: +584247376999)" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
              <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="X-API-Key de YCloud" type="password" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
            </div>
          )}

          {provider !== "NONE" && (
            <>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={connected} onChange={(e) => setConnected(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                Activar recibo automático al vender
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={chatbot} onChange={(e) => setChatbot(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                Chatbot con IA: responde mensajes de compradores (con memoria por conversación)
              </label>
              {chatbot && (
                <textarea
                  value={chatbotInstructions}
                  onChange={(e) => setChatbotInstructions(e.target.value)}
                  rows={3}
                  placeholder="Instrucciones extra para tu chatbot (opcional): tono, promociones, respuestas frecuentes…"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
                />
              )}
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
                <p className="mb-1 font-medium text-slate-700">Para estados de entrega (opcional):</p>
                <p>URL de webhook en Meta/YCloud: <code className="break-all">{webhookUrl}</code></p>
                <p>Token de verificación: el valor de WHATSAPP_WEBHOOK_VERIFY_TOKEN del servidor.</p>
              </div>
            </>
          )}

          {usage && (
            <p className="text-xs text-slate-500">
              Mensajes este mes: <b>{usage.totalMessages}</b>
              {usage.byStatus ? ` (entregados: ${usage.byStatus.DELIVERED ?? 0}, leídos: ${usage.byStatus.READ ?? 0}, fallidos: ${usage.byStatus.FAILED ?? 0})` : ""}
            </p>
          )}

          <button
            onClick={handleSave}
            disabled={save.isLoading}
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {save.isLoading ? "Guardando…" : "Guardar conexión"}
          </button>
        </>
      )}
    </div>
  );
}
