"use client";

import { useState } from "react";
import { api } from "@/lib/trpc";
import { toast } from "react-hot-toast";
import { WaMessageTemplatesSection } from "@/components/wa-message-templates-section";
import {
  MessageSquare,
  MessageSquareText,
  Link2,
  Send,
  Copy,
  ImagePlus,
  Loader2,
  X,
  Tag,
  Ticket,
  AlertCircle,
  UserX,
} from "lucide-react";

type Segment = "TAG" | "RAFFLE" | "DEBT" | "NON_BUYERS";

const SEGMENTS: { key: Segment; label: string; icon: any }[] = [
  { key: "TAG", label: "Por etiqueta", icon: Tag },
  { key: "RAFFLE", label: "Por rifa", icon: Ticket },
  { key: "DEBT", label: "Con deuda", icon: AlertCircle },
  { key: "NON_BUYERS", label: "No compradores", icon: UserX },
];

const DEBT_TEMPLATE =
  "Hola {nombre} 👋 Te recordamos que te queda {deuda} por pagar de la rifa {rifa}. ¿Coordinamos el pago? ¡Gracias! 🙌";
const PROMO_TEMPLATE =
  "Hola {nombre} 👋 ¡Tenemos una rifa que te va a encantar! Aparta tu número antes de que se agoten. 🎟️";

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const money = (v: number) =>
  `$${Number(v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CampaignsPage() {
  const { data: options } = api.campaign.options.useQuery();

  const [tab, setTab] = useState<"enlaces" | "mensajes">("enlaces");
  const [segment, setSegment] = useState<Segment>("DEBT");
  const [tag, setTag] = useState("");
  const [raffleId, setRaffleId] = useState("");
  const [message, setMessage] = useState(DEBT_TEMPLATE);
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [generated, setGenerated] = useState(false);

  const upload = api.raffle.uploadImage.useMutation();

  const built = api.campaign.buildLinks.useQuery(
    {
      segment,
      tag: tag || undefined,
      raffleId: raffleId || undefined,
      message,
      imageUrl: imageUrl || undefined,
    },
    { enabled: generated && message.trim().length > 0 }
  );

  async function handleImage(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Debe ser una imagen");
    if (file.size > 8 * 1024 * 1024) return toast.error("Máximo 8 MB");
    try {
      setUploading(true);
      const dataUri = await fileToDataUri(file);
      const { url } = await upload.mutateAsync({ dataUri });
      setImageUrl(url);
      toast.success("Imagen lista");
    } catch (e: any) {
      toast.error(e?.message || "No se pudo subir la imagen");
    } finally {
      setUploading(false);
    }
  }

  function generate() {
    if (!message.trim()) return toast.error("Escribe un mensaje");
    if (segment === "RAFFLE" && !raffleId) return toast.error("Elige una rifa");
    setGenerated(true);
    setTimeout(() => built.refetch(), 0);
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text);
    toast.success("Enlace copiado");
  }

  const recipients = built.data?.recipients ?? [];

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-6 w-6 text-slate-700" />
        <h1 className="text-2xl font-bold text-slate-900">WhatsApp gratis</h1>
      </div>

      <div className="flex gap-2 rounded-xl bg-slate-100 p-1">
        <button
          onClick={() => setTab("enlaces")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition ${
            tab === "enlaces" ? "bg-white shadow text-slate-900" : "text-slate-500"
          }`}
        >
          <Link2 className="h-4 w-4" /> Enlaces de campaña
        </button>
        <button
          onClick={() => setTab("mensajes")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition ${
            tab === "mensajes" ? "bg-white shadow text-slate-900" : "text-slate-500"
          }`}
        >
          <MessageSquareText className="h-4 w-4" /> Mensajes gratis
        </button>
      </div>

      {tab === "enlaces" && (
      <>
      <p className="-mt-3 text-sm text-slate-500">
        Genera enlaces de WhatsApp listos para enviar a un segmento de tu CRM. Sin costo: abres cada
        enlace y envías. (El envío masivo automático llega con WhatsApp Cloud API — ver WhatsApp pago.)
      </p>

      <div className="space-y-4 rounded-xl border bg-white p-5">
        {/* Segmento */}
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Segmento</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SEGMENTS.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.key}
                  onClick={() => {
                    setSegment(s.key);
                    setGenerated(false);
                    if (s.key === "DEBT") setMessage(DEBT_TEMPLATE);
                  }}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                    segment === s.key
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <Icon className="h-4 w-4" /> {s.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Filtro condicional */}
        {segment === "TAG" && (
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Etiqueta</label>
            <select
              value={tag}
              onChange={(e) => {
                setTag(e.target.value);
                setGenerated(false);
              }}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
            >
              <option value="">Todas las etiquetas</option>
              {options?.tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        )}
        {(segment === "RAFFLE" || segment === "DEBT") && (
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Rifa {segment === "DEBT" && "(opcional)"}
            </label>
            <select
              value={raffleId}
              onChange={(e) => {
                setRaffleId(e.target.value);
                setGenerated(false);
              }}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
            >
              <option value="">{segment === "DEBT" ? "Todas las rifas" : "Elige una rifa"}</option>
              {options?.raffles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Mensaje */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-sm font-medium text-slate-700">Mensaje</label>
            <div className="flex gap-2">
              <button onClick={() => setMessage(DEBT_TEMPLATE)} className="text-xs text-blue-600 hover:underline">
                Recordatorio de deuda
              </button>
              <button onClick={() => setMessage(PROMO_TEMPLATE)} className="text-xs text-blue-600 hover:underline">
                Promo
              </button>
            </div>
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
            placeholder="Hola {nombre}…"
          />
          <p className="mt-1 text-xs text-slate-400">
            Variables: <code>{"{nombre}"}</code>, <code>{"{deuda}"}</code>, <code>{"{rifa}"}</code>
          </p>
        </div>

        {/* Imagen */}
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Imagen (opcional)</label>
          {imageUrl ? (
            <div className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="adjunto" className="h-24 rounded-lg border object-cover" />
              <button
                onClick={() => setImageUrl("")}
                className="absolute -right-2 -top-2 rounded-full bg-black/60 p-1 text-white"
                aria-label="Quitar"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <label className="flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-2.5 text-sm text-slate-500">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
              {uploading ? "Subiendo…" : "Subir imagen"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={(e) => handleImage(e.target.files?.[0])}
              />
            </label>
          )}
          <p className="mt-1 text-xs text-slate-400">
            WhatsApp no adjunta imágenes por enlace: se anexa el link de la imagen al mensaje (muestra vista previa).
          </p>
        </div>

        <button
          onClick={generate}
          disabled={built.isFetching}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {built.isFetching ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          Generar enlaces
        </button>
      </div>

      {/* Resultados */}
      {generated && (
        <div className="rounded-xl border bg-white p-5">
          {built.isFetching ? (
            <div className="flex justify-center py-8 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : recipients.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">No hay contactos en este segmento.</p>
          ) : (
            <>
              <p className="mb-3 text-sm font-medium text-slate-700">
                {recipients.length} contacto(s) · abre cada enlace para enviar
              </p>
              <ul className="divide-y rounded-xl border">
                {recipients.map((r) => (
                  <li key={r.contactId} className="flex items-center justify-between gap-2 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{r.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {r.phone}
                        {r.debt > 0 ? ` · deuda ${money(r.debt)}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        onClick={() => copy(r.waLink)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        aria-label="Copiar enlace"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <a
                        href={r.waLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
                      >
                        <Send className="h-4 w-4" /> Enviar
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      </>
      )}

      {tab === "mensajes" && <WaMessageTemplatesSection />}
    </div>
  );
}
