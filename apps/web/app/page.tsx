import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-8 px-6 py-12 text-center">
      <div className="space-y-3">
        <span className="inline-block rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
          Hecho para riferos 🇻🇪
        </span>
        <h1 className="text-4xl font-bold tracking-tight">
          Rifa fácil. Cobra fácil.
        </h1>
        <p className="text-balance text-slate-600 dark:text-slate-400">
          Crea rifas, vende números, gestiona tus clientes y manda campañas de
          WhatsApp — todo desde el celular, en bolívares o dólares.
        </p>
      </div>

      <div className="flex w-full flex-col gap-3">
        <Link
          href="/dashboard"
          className="w-full rounded-xl bg-green-600 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-green-700"
        >
          Entrar al panel
        </Link>
        <Link
          href="/login"
          className="w-full rounded-xl border border-slate-300 px-6 py-3 font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
        >
          Iniciar sesión
        </Link>
      </div>

      <p className="text-xs text-slate-400">
        Pago Móvil · Binance · Zelle · efectivo USD/VES
      </p>
    </main>
  );
}
