"use client";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/trpc";
import { toast } from "react-hot-toast";
import { ArrowLeft, Loader2, Play, Pause, Trash2 } from "lucide-react";
import { NumberBoard } from "@/components/number-board";

export default function RaffleDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const utils = api.useContext();
  const id = params.id;
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: raffle, isLoading, refetch } = api.raffle.getById.useQuery(
    { id },
    { enabled: !!id }
  );
  const { data: stats } = api.raffle.getStats.useQuery({ id }, { enabled: !!id });

  const activate = api.raffle.activate.useMutation({
    onSuccess: () => {
      toast.success("Rifa activada");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const pause = api.raffle.pause.useMutation({
    onSuccess: () => {
      toast.success("Rifa pausada");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteRaffle = api.raffle.delete.useMutation({
    onSuccess: () => {
      toast.success("Rifa eliminada");
      setConfirmDelete(false);
      utils.raffle.list.invalidate();
      router.push("/dashboard/raffles");
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!raffle) {
    return (
      <div className="rounded-xl border border-dashed bg-white p-10 text-center text-slate-500">
        <p className="font-medium text-slate-700">Rifa no encontrada</p>
        <button
          onClick={() => router.push("/dashboard/raffles")}
          className="mt-3 text-blue-600 hover:underline"
        >
          Volver a mis rifas
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push("/dashboard/raffles")}
          className="p-2 hover:bg-slate-100 rounded-lg"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900">{raffle.title}</h1>
          <p className="text-sm text-slate-500">{raffle.prize}</p>
        </div>
        <span className="px-3 py-1 rounded-full bg-slate-100 text-xs font-medium text-slate-700">
          {raffle.status}
        </span>
      </div>

      <div className="flex gap-2">
        {raffle.status !== "ACTIVE" && (
          <button
            onClick={() => activate.mutate({ id })}
            disabled={activate.isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:opacity-50"
          >
            <Play className="w-4 h-4" /> Activar
          </button>
        )}
        {raffle.status === "ACTIVE" && (
          <button
            onClick={() => pause.mutate({ id })}
            disabled={pause.isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-xl hover:bg-amber-600 disabled:opacity-50"
          >
            <Pause className="w-4 h-4" /> Pausar
          </button>
        )}
        <button
          onClick={() => setConfirmDelete(true)}
          className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 rounded-xl hover:bg-red-50"
        >
          <Trash2 className="w-4 h-4" /> Eliminar
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Total números" value={stats?.total ?? raffle.totalNumbers} />
        <Stat label="Disponibles" value={stats?.available ?? "—"} />
        <Stat label="Vendidos" value={(stats ? stats.sold + stats.paid : "—") as any} />
        <Stat label="Recaudado" value={stats ? `$${stats.revenue}` : "—"} />
      </div>

      <div className="rounded-xl border bg-white p-6 space-y-2">
        <Row label="Precio por número" value={`$${Number(raffle.pricePerNumber)}`} />
        <Row label="Valor del premio" value={`$${Number(raffle.prizeValue)}`} />
        <Row label="Reservados" value={String(stats?.reserved ?? "—")} />
      </div>

      <NumberBoard
        raffleId={id}
        raffleStatus={raffle.status}
        pricePerNumber={Number(raffle.pricePerNumber)}
      />

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="w-full space-y-4 rounded-t-2xl border bg-white p-6 sm:max-w-md sm:rounded-2xl">
            <h2 className="text-lg font-bold text-slate-900">¿Eliminar esta rifa?</h2>
            <p className="text-sm text-slate-600">
              Vas a eliminar <span className="font-medium text-slate-900">{raffle.title}</span>. No se puede deshacer.
            </p>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleteRaffle.isLoading}
                className="flex-1 py-3 rounded-xl border border-slate-300 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => deleteRaffle.mutate({ id })}
                disabled={deleteRaffle.isLoading}
                className="flex-1 py-3 rounded-xl bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {deleteRaffle.isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border bg-white p-4 text-center">
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}
