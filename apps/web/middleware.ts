import { NextResponse, type NextRequest } from "next/server";

// ───────────────────────────────────────────────────────────────────────────
// Enrutado por DOMINIO (host). Mismo backend y misma DB; solo cambia QUÉ se
// muestra según el dominio. Tres capas, en orden:
//
//   1. LEGACY (hardcoded, temporal): hermanospernia2023.rifacil.vip → El Dubái.
//      Se chequea PRIMERO e intacto, para no romper el link que Orlando ya
//      comparte. NO tocar hasta migrarlo formalmente a customDomain.
//
//   2. HOSTS DEL SISTEMA: rifacil.vip, hp.rifacil.vip, *.vercel.app, localhost
//      → comportamiento normal (login + panel + storefront /r/[id]).
//
//   3. DINÁMICO (nuevo): cualquier OTRO host = dominio propio de un rifero.
//      "/" → rewrite a /d/<host> (la landing resuelve el rifero por su
//      customDomain server-side y lista sus rifas). Las rutas de sistema se
//      redirigen al "/" para no exponer el panel en el dominio de ventas.
//      Si el host no está vinculado a ningún rifero, /d/<host> responde 404
//      limpio — un host desconocido nunca rompe el sistema.
// ───────────────────────────────────────────────────────────────────────────

// ── Capa 1: legacy hardcoded (no tocar) ──
const SALES_HOST = "hermanospernia2023.rifacil.vip";
const EL_DUBAI_PATH = "/r/cmqh43bxj0001xm2teh6gdnel"; // rifa El Dubái (import)

// ── Capa 2: hosts del sistema (login + panel) ──
// Todo el dominio rifacil.vip y CUALQUIER subdominio (*.rifacil.vip) es sistema:
// www.rifacil.vip, hp.rifacil.vip, app.rifacil.vip, etc. → login + panel.
// El único subdominio que NO es sistema es el legacy hermanospernia2023.rifacil.vip,
// pero ese ya se resolvió en la Capa 1 (return antes de llegar acá).
// localhost y *.vercel.app (previews) también son sistema.
function isSystemHost(host: string): boolean {
  return (
    host === "rifacil.vip" ||
    host.endsWith(".rifacil.vip") ||
    host === "localhost" ||
    host.endsWith(".vercel.app")
  );
}

// Rutas del "sistema" que NO deben verse en un dominio de ventas.
const SYSTEM_PREFIXES = ["/login", "/register", "/dashboard", "/vendedor", "/admin"];

function isSystemRoute(pathname: string): boolean {
  return SYSTEM_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") || "").toLowerCase().split(":")[0];
  const { pathname } = req.nextUrl;

  // ── Capa 1: LEGACY hermanospernia2023.rifacil.vip (TAL CUAL) ──
  if (host === SALES_HOST) {
    // "/" → storefront de El Dubái (rewrite: la URL queda en "/")
    if (pathname === "/") {
      const url = req.nextUrl.clone();
      url.pathname = EL_DUBAI_PATH;
      return NextResponse.rewrite(url);
    }
    // El dominio de ventas NO expone el sistema → al storefront.
    if (isSystemRoute(pathname)) {
      const url = req.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // ── Capa 2: hosts del sistema → comportamiento normal ──
  if (isSystemHost(host)) {
    return NextResponse.next();
  }

  // ── Capa 3: DINÁMICO — cualquier otro host = dominio propio de rifero ──
  // "/" → landing de marca (/d/<host>). La resolución del rifero es server-side.
  if (pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = `/d/${host}`;
    return NextResponse.rewrite(url);
  }
  // No exponer el panel en el dominio del rifero.
  if (isSystemRoute(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  // /r/[id], /d/[host], assets, etc. pasan sin cambios.
  return NextResponse.next();
}

export const config = {
  // No interferir con la API (backend compartido), assets de Next, ni archivos.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
