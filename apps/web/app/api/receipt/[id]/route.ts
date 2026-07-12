// Proxy same-origin de la imagen del recibo (Cloudinary → nuestro dominio).
// Lo usan: el botón "Guardar mi recibo" de /c/[id] (?download=1 fuerza descarga
// con nombre de archivo legible) y el botón "Enviar como imagen" del panel
// (fetch same-origin → File → navigator.share, sin pelear con CORS de Cloudinary).
import { prisma } from "@riffas/db";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const sale = await prisma.sale.findUnique({
    where: { id: params.id },
    select: { receiptUrl: true, receiptNumber: true, status: true },
  });

  // Solo ventas confirmadas (RESERVED/PAID): un recibo de venta PENDING lleva
  // montos auto-reportados por el comprador y no debe servirse como oficial.
  if (
    !sale?.receiptUrl ||
    (sale.status !== "RESERVED" && sale.status !== "PAID")
  ) {
    return new NextResponse("Comprobante no encontrado", { status: 404 });
  }

  // Solo se proxea la URL que NOSOTROS guardamos y solo si apunta a Cloudinary
  // por https (guardia anti-SSRF: nunca seguir una URL arbitraria).
  let url: URL;
  try {
    url = new URL(sale.receiptUrl);
  } catch {
    return new NextResponse("Comprobante no disponible", { status: 404 });
  }
  if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com") {
    return new NextResponse("Comprobante no disponible", { status: 404 });
  }

  // redirect:"error": la validación anti-SSRF es sobre la URL inicial; un 30x
  // de Cloudinary podría sacarnos del host permitido, así que no se sigue.
  let upstream: Response;
  try {
    upstream = await fetch(url, { cache: "no-store", redirect: "error" });
  } catch {
    return new NextResponse("Comprobante no disponible", { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new NextResponse("Comprobante no disponible", { status: 502 });
  }

  // Solo MIME de imagen rasterizada: nunca reexponer bajo nuestro dominio un
  // text/html o svg que devuelva el upstream (los recibos son PNG).
  const upstreamType = upstream.headers.get("content-type") ?? "";
  const contentType = ["image/png", "image/jpeg", "image/webp"].some((t) =>
    upstreamType.startsWith(t)
  )
    ? upstreamType
    : "image/png";

  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
  });
  if (req.nextUrl.searchParams.get("download") === "1") {
    // Nombre legible; si no hay receiptNumber, un sufijo del id. Solo chars
    // seguros para el header (nada de comillas/CR-LF).
    const label = (sale.receiptNumber || params.id.slice(-8)).replace(
      /[^a-zA-Z0-9._-]/g,
      "-"
    );
    headers.set("Content-Disposition", `attachment; filename="recibo-${label}.png"`);
  }
  return new NextResponse(upstream.body, { headers });
}
