"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/trpc";
import { GettingStarted } from "@/components/getting-started";
import {
  Ticket,
  Wallet,
  Clock,
  Users,
  Receipt,
  Plus,
  ArrowRight,
} from "lucide-react";

const money = (v: unknown) =>
  `$${Number(v ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const STATS = [
  {
    key: "activeRaffles" as const,
    label: "Rifas activas",
    icon: Ticket,
    accent: "text-blue-600 bg-blue-100 dark:bg-blue-900/40 dark:text-blue-300",
    format: (v: number) => String(v),
  },
  {
    key: "collected" as const,
    label: "Recaudado",
    icon: Wallet,
    accent: "text-green-600 bg-green-100 dark:bg-green-900/40 dark:text-green-300",
    format: money,
  },
  {
    key: "pending" as const,
    label: "Por cobrar",
    icon: Clock,
    accent: "text-amber-600 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300",
    format: money,
  },
  {
    key: "contactsCount" as const,
    label: "Contactos",
    icon: Users,
    accent: "text-purple-600 bg-purple-100 dark:bg-purple-900/40 dark:text-purple-300",
    format: (v: number) => String(v),
  },
];

const QUICK_ACTIONS = [
  {
    href: "/dashboard/raffles",
    label: "Vender",
    description: "Abrí una rifa y vendé números",
    icon: Ticket,
  },
  {
    href: "/dashboard/contacts",
    label: "Contactos",
    description: "Gestioná tus clientes",
    icon: Users,
  },
  {
    href: "/dashboard/sales",
    label: "Ventas",
    description: "Recibos, abonos y deudas",
    icon: Receipt,
  },
];

// Saludo por hora del día (hora local del dispositivo del rifero).
function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "¡A esta hora vendiendo! 🌙";
  if (h < 12) return "¡Buenos días! ☀️";
  if (h < 19) return "¡Buenas tardes! 👋";
  return "¡Buenas noches! 🌆";
}

export default function DashboardHomePage() {
  const { data, isLoading } = api.analytics.summary.useQuery();

  // El saludo se resuelve tras montar: la hora del servidor (UTC de Vercel) no
  // es la del rifero y en SSR provocaría un mismatch de hidratación.
  const [greet, setGreet] = useState("¡Hola! 👋");
  useEffect(() => setGreet(greeting()), []);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{greet}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Tu resumen de hoy. Rifá fácil, cobrá fácil.
          </p>
        </div>
        <Link
          href="/dashboard/raffles/new"
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700"
        >
          <Plus className="h-5 w-5" /> Nueva rifa
        </Link>
      </div>

      {/* Primeros pasos (solo mientras falte algo por completar) */}
      <GettingStarted />

      {/* Métricas */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STATS.map(({ key, label, icon: Icon, accent, format }) => (
          <div
            key={key}
            className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className={`mb-3 inline-flex rounded-xl p-2 ${accent}`}>
              <Icon className="h-5 w-5" />
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
            {isLoading ? (
              <div className="mt-1 h-7 w-20 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
            ) : (
              <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
                {format((data?.[key] ?? 0) as number)}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Accesos rápidos */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Accesos rápidos
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {QUICK_ACTIONS.map(({ href, label, description, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-blue-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-blue-700"
            >
              <div className="flex items-center gap-3">
                <span className="inline-flex rounded-xl bg-blue-100 p-3 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
                  <Icon className="h-6 w-6" />
                </span>
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">{label}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>
                </div>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-blue-600 dark:text-slate-600" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
