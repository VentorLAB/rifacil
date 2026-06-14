"use client";

import { useState } from "react";
import { api } from "@/lib/trpc";
import { toast } from "react-hot-toast";
import { Plus, Trash2, ChevronUp, ChevronDown, ImagePlus, Loader2, X, Trophy } from "lucide-react";

export type PrizeDraft = {
  titulo: string;
  descripcion?: string;
  imagenUrl?: string;
};

const ORDINAL = (i: number) => `${i + 1}º`;

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function PrizesEditor({
  value,
  onChange,
}: {
  value: PrizeDraft[];
  onChange: (v: PrizeDraft[]) => void;
}) {
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const upload = api.raffle.uploadImage.useMutation();

  function setAt(idx: number, patch: Partial<PrizeDraft>) {
    onChange(value.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }
  function add() {
    onChange([...value, { titulo: "" }]);
  }
  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }
  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  }

  async function handleImage(idx: number, file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("El archivo debe ser una imagen");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("La imagen no puede superar 8 MB");
      return;
    }
    try {
      setUploadingIdx(idx);
      const dataUri = await fileToDataUri(file);
      const { url } = await upload.mutateAsync({ dataUri });
      setAt(idx, { imagenUrl: url });
    } catch (e: any) {
      toast.error(e?.message || "No se pudo subir la imagen");
    } finally {
      setUploadingIdx(null);
    }
  }

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="rounded-xl border border-dashed bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          Aún no hay premios. Añade el 1º, 2º, 3º…
        </p>
      )}

      {value.map((p, idx) => (
        <div key={idx} className="rounded-xl border border-slate-200 p-3">
          <div className="flex items-start gap-3">
            {/* Posición + reordenar */}
            <div className="flex flex-col items-center gap-1 pt-1">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700">
                {ORDINAL(idx)}
              </span>
              <button
                type="button"
                onClick={() => move(idx, -1)}
                disabled={idx === 0}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30"
                aria-label="Subir"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => move(idx, 1)}
                disabled={idx === value.length - 1}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30"
                aria-label="Bajar"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>

            {/* Campos */}
            <div className="min-w-0 flex-1 space-y-2">
              <input
                value={p.titulo}
                onChange={(e) => setAt(idx, { titulo: e.target.value })}
                placeholder={`Título del ${ORDINAL(idx)} premio (ej: Moto 0km)`}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-900"
              />
              <input
                value={p.descripcion ?? ""}
                onChange={(e) => setAt(idx, { descripcion: e.target.value })}
                placeholder="Descripción (opcional)"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900"
              />
            </div>

            {/* Imagen */}
            <div className="shrink-0">
              {p.imagenUrl ? (
                <div className="relative h-16 w-16 overflow-hidden rounded-lg border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.imagenUrl} alt={p.titulo} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setAt(idx, { imagenUrl: undefined })}
                    className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
                    aria-label="Quitar imagen"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-[10px] text-slate-500">
                  {uploadingIdx === idx ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ImagePlus className="h-4 w-4" />
                  )}
                  <span>{uploadingIdx === idx ? "…" : "Imagen"}</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploadingIdx === idx}
                    onChange={(e) => handleImage(idx, e.target.files?.[0])}
                  />
                </label>
              )}
            </div>

            {/* Quitar */}
            <button
              type="button"
              onClick={() => remove(idx)}
              className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
              aria-label="Quitar premio"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
      >
        <Plus className="h-4 w-4" /> Añadir premio
      </button>
    </div>
  );
}

// Lista de premios de solo lectura (para el detalle público / vista).
export function PrizesList({ prizes }: { prizes: { titulo: string; descripcion?: string | null; imagenUrl?: string | null }[] }) {
  if (!prizes || prizes.length === 0) return null;
  return (
    <ul className="space-y-2">
      {prizes.map((p, i) => (
        <li key={i} className="flex items-center gap-3 rounded-xl border bg-white p-3">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-bold text-violet-700">
            {ORDINAL(i)}
          </span>
          {p.imagenUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.imagenUrl} alt={p.titulo} className="h-12 w-12 shrink-0 rounded-lg object-cover" />
          )}
          <div className="min-w-0">
            <p className="font-medium text-slate-900">{p.titulo}</p>
            {p.descripcion && <p className="truncate text-sm text-slate-500">{p.descripcion}</p>}
          </div>
          <Trophy className="ml-auto h-4 w-4 shrink-0 text-amber-400" />
        </li>
      ))}
    </ul>
  );
}
