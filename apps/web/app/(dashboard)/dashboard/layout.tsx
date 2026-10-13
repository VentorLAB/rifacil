"use client";

import Link from "next/link";
import { api } from "@/lib/trpc";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  Ticket,
  Receipt,
  Users,
  UserCog,
  MessageSquare,
  MessageCircle,
  Settings,
  LogOut,
  ClipboardCheck,
} from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Inicio", icon: LayoutDashboard },
  { href: "/dashboard/raffles", label: "Rifas", icon: Ticket },
  { href: "/dashboard/pending", label: "Por confirmar", icon: ClipboardCheck },
  { href: "/dashboard/sales", label: "Ventas", icon: Receipt },
  { href: "/dashboard/contacts", label: "Contactos", icon: Users },
  { href: "/dashboard/vendors", label: "Vendedores", icon: UserCog },
  { href: "/dashboard/campaigns", label: "WhatsApp gratis", icon: MessageSquare },
  { href: "/dashboard/whatsapp", label: "WhatsApp pago", icon: MessageCircle },
  { href: "/dashboard/settings", label: "Ajustes", icon: Settings },
];

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Badge con el conteo de pagos por confirmar (se refresca solo cada 30s).
  const { data: pendingData } = api.sale.listPending.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const pendingCount = pendingData?.sales?.length ?? 0;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/dashboard" className="shrink-0">
            {/* Badge blanco: el wordmark es navy y debe leerse también en modo oscuro. */}
            <span className="inline-flex rounded-lg bg-white px-2 py-1 shadow-sm">
              <Image
                src="/rafacillogo.png"
                alt="Rifácil"
                width={130}
                height={39}
                priority
                className="h-7 w-auto"
              />
            </span>
          </Link>

          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-red-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Cerrar sesión</span>
          </button>
        </div>

        {/* Nav horizontal scrolleable (mobile-first, se opera con el pulgar). */}
        <nav className="mx-auto max-w-6xl overflow-x-auto px-2 pb-2">
          <ul className="flex w-max gap-1">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
                      active
                        ? "bg-blue-600 text-white"
                        : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                    {href === "/dashboard/pending" && pendingCount > 0 && (
                      <span
                        className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                          active ? "bg-white text-red-600" : "bg-red-600 text-white"
                        }`}
                      >
                        {pendingCount > 99 ? "99+" : pendingCount}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
