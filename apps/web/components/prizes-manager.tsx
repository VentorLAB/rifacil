"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/trpc";
import { toast } from "react-hot-toast";
import { Loader2, Save, Trophy } from "lucide-react";
import { PrizesEditor, type PrizeDraft } from "./prizes-editor";

// Sección "Premios" editable para el detalle de la rifa: carga, edita
// (añadir/quitar/reordenar) y persiste reemplazando todos los premios.
export function PrizesManager({ raffleId }: { raffleId: string }) {
  const utils = api.useContext();
  const { data, isLoading } = api.raffle.listPrizes.useQuery({ raffleId });
  const [prizes, setPrizes] = useState<PrizeDraft[]>([]);

  useEffect(() => {
    if (!data) return;
    setPrizes(
      data.map((p) => ({
        titulo: p.titulo,
        descripcion: p.descripcion ?? undefined,
        imagenUrl: p.imagenUrl ?? undefined,
      }))
    );
  }, [data]);

  const save = api.raffle.setPrizes.useMutation({
    onSuccess: () => {
      toast.success("Premios guardados");
      utils.raffle.listPrizes.invalidate({ raffleId });
    },
    onError: (e) => toast.error(e.message),
  });

  function handleSave() {
    const clean = prizes
      .filter((p) => p.titulo.trim())
      .map((p) => ({
        titulo: p.titulo.trim(),
        descripcion: p.descripcion?.trim() || undefined,
        imagenUrl: p.imagenUrl || undefined,
      }));
    save.mutate({ raffleId, prizes: clean });
  }

  return (
    <div className="rounded-xl border bg-white p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-2">
        <Trophy className="h-5 w-5 text-amber-500" />
        <h2 className="text-lg font-bold text-slate-900">Premios</h2>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          <PrizesEditor value={prizes} onChange={setPrizes} />
          <button
            onClick={handleSave}
            disabled={save.isLoading}
            className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {save.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar premios
          </button>
        </>
      )}
    </div>
  );
}
