import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Multi-tenant por dominio propio.
 *
 * - En hosts de la PLATAFORMA (rifacil.vip, *.vercel.app, localhost) → comportamiento normal:
 *   dashboard, login, /r/[id], /vendedor, etc.
 * - En el DOMINIO PROPIO de un rifero (ej. rifashermanospernia.com) → la home muestra SU tienda.
 *   Los links de rifa (/r/[id]) y todo lo demás siguen funcionando bajo su dominio sin cambios.
 *
 * Ajusta APP_HOSTS si cambias el dominio principal de la plataforma.
 */
const APP_HOSTS = new Set<string>([
  "rifacil.vip",
  "www.rifacil.vip",
  "riffas.app",
  "www.riffas.app",
]);

function isPlatformHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    APP_HOSTS.has(h) ||
    h.endsWith(".vercel.app") ||
    h.startsWith("localhost") ||
    h.startsWith("127.0.0.1")
  );
}

export const config = {
  // No corre sobre API, assets de Next, ni archivos con extensión (imágenes, etc.).
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const url = req.nextUrl;

  // Dominio de la plataforma → no tocar nada.
  if (isPlatformHost(host)) return NextResponse.next();

  // Dominio propio del rifero: solo la home se reescribe a su tienda.
  // El resto (/r/[id], /verificar, etc.) pasa tal cual.
  if (url.pathname === "/") {
    const rewritten = url.clone();
    rewritten.pathname = `/t/d/${encodeURIComponent(host.replace(/^www\./, ""))}`;
    return NextResponse.rewrite(rewritten);
  }

  return NextResponse.next();
}
