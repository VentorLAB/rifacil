"use client";

// Checklist "Primeros pasos" del panel — estilo Canva: guía al rifero nuevo hasta
// su primer recibo enviado (el "aha moment"), celebra cada avance y desaparece
// solo cuando ya lo logró todo. Cero fricción: cada paso es un link directo.
import { useEffect, useMemo } from "react";
import Link from "next/link";
import { api } from "@/lib/trpc";
import { celebrateBig } from "@/lib/celebrate";
import { CheckCircle2, Circle, ArrowRight, Sparkles } from "lucide-react";

const CELEBRATED_KEY = "rifacil_onboarding_celebrated";
const SEEN_KEY = "rifacil_onboarding_seen";

export function GettingStarted() {
  const { data, isLoading } = api.analytics.onboarding.useQuery(undefined, {
    staleTime: 30_000,
  });

  const steps = useMemo(
    () =>
      data
        ? [
            {
              done: data.hasBrand,
              label: "Ponle tu marca",
              hint: "Nombre y logo en cada recibo",
              href: "/dashboard/settings",
            },
            {
              done: data.hasRaffle,
              label: "Crea tu primera rifa",
              hint: "Premio, números y precio",
              href: "/dashboard/raffles/new",
            },
            {
              done: data.hasSale,
              label: "Vende tu primer número",
              hint: "Toca un número y regístralo",
              href: "/dashboard/raffles",
            },
            {
              done: data.hasReceipt,
              label: "Envía tu primer recibo",
              hint: "Le llega bello por WhatsApp",
              href: "/dashboard/sales",
            },
          ]
        : [],
    [data]
  );

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = steps.length > 0 && doneCount === steps.length;

  // Al completar TODO: una sola gran celebración (marcada en localStorage).
  // Solo si este navegador VIO el checklist incompleto: un rifero veterano que
  // ya lo tenía todo no debe recibir confetti por algo que nunca le faltó.
  useEffect(() => {
    if (steps.length === 0) return;
    if (!allDone) {
      localStorage.setItem(SEEN_KEY, "1");
      return;
    }
    if (!localStorage.getItem(SEEN_KEY)) return;
    if (localStorage.getItem(CELEBRATED_KEY)) return;
    localStorage.setItem(CELEBRATED_KEY, "1");
    celebrateBig();
  }, [allDone, steps.length]);

  if (isLoading || !data || allDone) return null;

  return (
    <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-blue-50 p-5 dark:border-violet-900 dark:from-violet-950/40 dark:to-blue-950/40">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-violet-600 dark:text-violet-300" />
          <h2 className="font-bold text-slate-900 dark:text-white">
            Primeros pasos
          </h2>
        </div>
        <span className="text-sm font-semibold text-violet-700 dark:text-violet-300">
          {doneCount} de {steps.length}
        </span>
      </div>

      <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-white/70 dark:bg-slate-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500 transition-all duration-700"
          style={{ width: `${(doneCount / steps.length) * 100}%` }}
        />
      </div>

      <ul className="space-y-1.5">
        {steps.map((s) => (
          <li key={s.label}>
            {s.done ? (
              <div className="flex items-center gap-3 rounded-xl px-3 py-2.5">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
                <span className="text-sm font-medium text-slate-400 line-through dark:text-slate-500">
                  {s.label}
                </span>
              </div>
            ) : (
              <Link
                href={s.href}
                className="group flex items-center gap-3 rounded-xl bg-white/80 px-3 py-2.5 shadow-sm transition hover:shadow-md dark:bg-slate-900/60"
              >
                <Circle className="h-5 w-5 shrink-0 text-slate-300 dark:text-slate-600" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900 dark:text-white">
                    {s.label}
                  </span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {s.hint}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-violet-500 transition group-hover:translate-x-1" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
