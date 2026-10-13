"use client";

import { LayoutTemplate } from "lucide-react";
import { WhatsappTemplatesSection } from "@/components/whatsapp-templates-section";
import { WhatsappUsageCard } from "@/components/whatsapp-usage-card";

// WhatsApp PAGO: canal de Meta (Cloud API). Los textos gratis (wa.me) viven en
// "WhatsApp gratis" (menú). Aquí: plantillas de la WABA y su estado.
export default function WhatsappPagoPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center gap-2">
        <LayoutTemplate className="h-6 w-6 text-slate-700 dark:text-slate-300" />
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">WhatsApp pago</h1>
      </div>
      <p className="-mt-3 text-sm text-slate-500">
        Plantillas de Meta para envíos automáticos (recibos y campañas). Estos mensajes tienen costo
        por conversación.
      </p>
      <WhatsappUsageCard />
      <WhatsappTemplatesSection />
    </div>
  );
}
