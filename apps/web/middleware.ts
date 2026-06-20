import { NextResponse, type NextRequest } from "next/server";

// ───────────────────────────────────────────────────────────────────────────
// Enrutado por DOMINIO (host). Mismo backend y misma DB; solo cambia QUÉ se
// muestra según el dominio:
//   - hermanospernia2023.rifacil.vip → storefront de venta de El Dubái ("/" => /r/<id>),
//     SIN exponer login/panel (las rutas del sistema redirigen al storefront).
//   - hp.rifacil.vip y rifacil.vip → comportamiento actual (login + sistema).
// Se usa REWRITE para "/" (URL limpia: el dominio muestra la rifa sin cambiar
// la barra de direcciones).
// ───────────────────────────────────────────────────────────────────────────

const SALES_HOST = "hermanospernia2023.rifacil.vip";
const EL_DUBAI_PATH = "/r/cmqh43bxj0001xm2teh6gdnel"; // rifa El Dubái (import)

// Rutas del "sistema" que NO deben verse en el dominio de ventas.
const SYSTEM_PREFIXES = ["/login", "/register", "/dashboard", "/vendedor", "/admin"];

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") || "").toLowerCase().split(":")[0];

  if (host === SALES_HOST) {
    const { pathname } = req.nextUrl;

    // "/" → storefront de El Dubái (rewrite: la URL queda en "/")
    if (pathname === "/") {
      const url = req.nextUrl.clone();
      url.pathname = EL_DUBAI_PATH;
      return NextResponse.rewrite(url);
    }

    // El dominio de ventas NO expone el sistema → al storefront.
    if (SYSTEM_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
      const url = req.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  // hp.rifacil.vip / rifacil.vip / cualquier otro → sin cambios.
  return NextResponse.next();
}

export const config = {
  // No interferir con la API (backend compartido), assets de Next, ni archivos.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
