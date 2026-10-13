"use client";

import { useState } from "react";
import { MessageSquareText, LayoutTemplate } from "lucide-react";
import { WaMessageTemplatesSection } from "@/components/wa-message-templates-section";
import { WhatsappTemplatesSection } from "@/components/whatsapp-templates-section";

// Todo lo de WhatsApp en un solo lugar (Marco: botón propio, NO en Ajustes):
//  1. "Mensajes gratis" — los textos wa.me editables (canal manual, sin costo).
//  2. "Plantillas Meta" — gestión de plantillas de la WABA (Cloud API, pago).
export default function WhatsappHubPage() {
  const [tab, setTab] = useState<"gratis" | "meta">("gratis");

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">WhatsApp</h1>
      <div className="flex gap-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
        <button
          onClick={() => setTab("gratis")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition ${
            tab === "gratis" ? "bg-white shadow text-slate-900 dark:bg-slate-900 dark:text-white" : "text-slate-500"
          }`}
        >
          <MessageSquareText className="h-4 w-4" /> Mensajes gratis
        </button>
        <button
          onClick={() => setTab("meta")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition ${
            tab === "meta" ? "bg-white shadow text-slate-900 dark:bg-slate-900 dark:text-white" : "text-slate-500"
          }`}
        >
          <LayoutTemplate className="h-4 w-4" /> Plantillas Meta
        </button>
      </div>
      {tab === "gratis" ? <WaMessageTemplatesSection /> : <WhatsappTemplatesSection />}
    </div>
  );
}
