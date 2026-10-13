"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/trpc";
import { toast } from "react-hot-toast";
import { LayoutTemplate, Loader2, Plus, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import {
  slugifyTemplateName,
  extractBodyVariables,
  templateStatusInfo,
  rejectedReasonLabel,
} from "@riffas/shared";

// Plantillas de la WABA (WhatsApp Business): listar con estado, crear nuevas
// (van a revisión de Meta) y ver por qué Meta rechazó alguna. El ENVÍO de
// mensajes no cambia: sigue por wa.me + la plantilla recibo_compra de siempre.
export function WhatsappTemplatesSection() {
  const utils = api.useContext();
  const list = api.whatsappTemplate.list.useQuery(undefined, { retry: false });
  const create = api.whatsappTemplate.create.useMutation({
    onSuccess: (r) => {
      toast.success(`Plantilla "${r.name}" enviada a revisión de Meta`);
      utils.whatsappTemplate.list.invalidate();
      resetForm();
    },
    onError: (e) => toast.error(e.message),
  });

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"UTILITY" | "MARKETING">("UTILITY");
  const [language, setLanguage] = useState("es");
  const [headerType, setHeaderType] = useState<"NONE" | "TEXT" | "IMAGE">("NONE");
  const [headerText, setHeaderText] = useState("");
  const [headerImage, setHeaderImage] = useState<{ base64: string; type: string; name: string } | null>(null);
  const [bodyText, setBodyText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [examples, setExamples] = useState<string[]>([]);

  const slug = useMemo(() => slugifyTemplateName(name), [name]);
  const vars = useMemo(() => extractBodyVariables(bodyText), [bodyText]);

  function resetForm() {
    setName(""); setCategory("UTILITY"); setLanguage("es");
    setHeaderType("NONE"); setHeaderText(""); setHeaderImage(null);
    setBodyText(""); setFooterText(""); setExamples([]);
    setShowForm(false);
  }

  function handleCreate() {
    if (vars === null) {
      toast.error("Las variables deben ser {{1}}, {{2}}... en secuencia, sin saltos");
      return;
    }
    if (headerType === "IMAGE" && !headerImage) {
      toast.error("Sube la imagen de muestra del encabezado");
      return;
    }
    create.mutate({
      name,
      category,
      language,
      headerType,
      headerText: headerType === "TEXT" ? headerText || undefined : undefined,
      headerImageBase64: headerType === "IMAGE" ? headerImage?.base64 : undefined,
      headerImageType: headerType === "IMAGE" ? headerImage?.type : undefined,
      bodyText,
      footerText: footerText || undefined,
      exampleValues: vars.length ? vars.map((_, i) => examples[i] ?? "") : undefined,
    });
  }

  const toneClasses: Record<string, string> = {
    ok: "bg-green-100 text-green-700",
    warn: "bg-amber-100 text-amber-700",
    bad: "bg-red-100 text-red-700",
    muted: "bg-slate-100 text-slate-600",
  };

  const templates = list.data;
  const notConnected = list.error?.data?.code === "PRECONDITION_FAILED";

  return (
    <div className="space-y-4 rounded-xl border bg-white p-6 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutTemplate className="h-5 w-5 text-slate-700" />
          <h2 className="text-lg font-semibold text-slate-900">Plantillas de WhatsApp</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => list.refetch()}
            disabled={list.isFetching || notConnected}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
            title="Recargar"
          >
            <RefreshCw className={`h-4 w-4 ${list.isFetching ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            disabled={notConnected}
            className="flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> Nueva
          </button>
        </div>
      </div>
      <p className="text-sm text-slate-500">
        Las plantillas aprobadas por Meta son las que puede mandar tu WhatsApp API fuera de la
        ventana de 24 horas (como el recibo automático). Aquí las ves con su estado y creas
        nuevas: quedan <b>en revisión de Meta</b> (minutos a horas). El envío sigue igual que siempre.
      </p>

      {notConnected && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {list.error?.message}
        </div>
      )}

      {list.isLoading && (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      )}

      {list.error && !notConnected && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{list.error.message}</div>
      )}

      {templates && templates.length === 0 && (
        <p className="py-4 text-center text-sm text-slate-400">Tu WABA todavía no tiene plantillas.</p>
      )}

      {templates && templates.length > 0 && (
        <div className="divide-y rounded-xl border">
          {templates.map((t) => {
            const st = templateStatusInfo(t.status);
            return (
              <TemplateRow
                key={`${t.name}:${t.language}`}
                name={t.name}
                category={t.category}
                language={t.language}
                statusLabel={st.label}
                statusClass={toneClasses[st.tone]}
                rejectedReason={t.rejectedReason ? rejectedReasonLabel(t.rejectedReason) : null}
                headerText={t.headerText}
                bodyText={t.bodyText}
              />
            );
          })}
        </div>
      )}

      {showForm && (
        <div className="space-y-3 rounded-xl border border-dashed border-slate-300 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">Nombre</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Recordatorio de pago"
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
              />
              {slug && <p className="mt-1 text-xs text-slate-400">Se guarda como: <code>{slug}</code></p>}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Categoría</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as typeof category)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
              >
                <option value="UTILITY">Utilidad (recibos, avisos)</option>
                <option value="MARKETING">Marketing (promos)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Idioma</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
            >
              <option value="es">Español (es)</option>
              <option value="es_LA">Español LATAM (es_LA)</option>
              <option value="es_ES">Español España (es_ES)</option>
              <option value="en_US">Inglés US (en_US)</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Encabezado</label>
            <select
              value={headerType}
              onChange={(e) => setHeaderType(e.target.value as "NONE" | "TEXT" | "IMAGE")}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
            >
              <option value="NONE">Sin encabezado</option>
              <option value="TEXT">Texto (sin variables)</option>
              <option value="IMAGE">Imagen (el afiche: vende más)</option>
            </select>
          </div>
          {headerType === "TEXT" && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Texto del encabezado (máx. 60)</label>
              <input
                value={headerText}
                onChange={(e) => setHeaderText(e.target.value)}
                maxLength={60}
                placeholder="Tu recibo de rifa"
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
              />
            </div>
          )}
          {headerType === "IMAGE" && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Imagen de muestra (JPG o PNG, máx. 5 MB) — Meta la exige para revisar
              </label>
              <input
                type="file"
                accept="image/jpeg,image/png"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return setHeaderImage(null);
                  if (f.size > 5 * 1024 * 1024) {
                    toast.error("La imagen no puede pasar de 5 MB");
                    e.target.value = "";
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () =>
                    setHeaderImage({
                      base64: String(reader.result).split(",")[1] ?? "",
                      type: f.type,
                      name: f.name,
                    });
                  reader.readAsDataURL(f);
                }}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              {headerImage && (
                <p className="mt-1 text-xs text-green-600">✓ {headerImage.name} lista para subir a Meta</p>
              )}
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Cuerpo (variables como {"{{1}}"}, {"{{2}}"}…)
            </label>
            <textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              rows={4}
              maxLength={1024}
              placeholder={"Hola {{1}}, tu apartado en {{2}} vence mañana. Completa tu pago de {{3}} para asegurar tus números."}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            />
            {vars === null && (
              <p className="mt-1 text-xs text-red-600">Las variables deben ir en secuencia: {"{{1}}"}, {"{{2}}"}, {"{{3}}"}… sin saltos.</p>
            )}
          </div>
          {vars && vars.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {vars.map((v, i) => (
                <div key={v}>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Ejemplo para {"{{" + v + "}}"}</label>
                  <input
                    value={examples[i] ?? ""}
                    onChange={(e) => setExamples((prev) => { const n = [...prev]; n[i] = e.target.value; return n; })}
                    placeholder={["María", "El Dubai", "$25"][i] ?? `ejemplo${v}`}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              ))}
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Pie (opcional, sin variables)</label>
            <input
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
              maxLength={60}
              placeholder="Todo juega hasta tener ganador."
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={create.isPending || !slug || !bodyText.trim() || vars === null}
              className="flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-40"
            >
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Enviar a revisión de Meta
            </button>
            <button onClick={resetForm} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TemplateRow(props: {
  name: string;
  category: string;
  language: string;
  statusLabel: string;
  statusClass: string;
  rejectedReason: string | null;
  headerText: string | null | undefined;
  bodyText: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-4 py-3">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <div>
          <span className="font-mono text-sm font-medium text-slate-800">{props.name}</span>
          <span className="ml-2 text-xs text-slate-400">{props.category} · {props.language}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${props.statusClass}`}>{props.statusLabel}</span>
          {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </div>
      </button>
      {props.rejectedReason && (
        <p className="mt-1 text-xs text-red-600">Motivo de rechazo: {props.rejectedReason}</p>
      )}
      {open && (
        <div className="mt-2 space-y-1 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          {props.headerText && <p><b>Encabezado:</b> {props.headerText}</p>}
          {props.bodyText && <p className="whitespace-pre-wrap"><b>Cuerpo:</b> {props.bodyText}</p>}
          {!props.headerText && !props.bodyText && <p className="text-slate-400">Sin contenido de texto (puede ser de imagen).</p>}
        </div>
      )}
    </div>
  );
}
