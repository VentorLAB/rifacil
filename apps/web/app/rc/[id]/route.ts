// Página-preview del comprobante (nuestro equivalente a la página de imagen de
// ImgBB que usa la v1). WhatsApp NO genera miniatura de una URL de imagen "pelada",
// pero SÍ scrapea una página HTML con og:image → así el recibo se ve como foto en
// el chat, también en WhatsApp Web. Es un route handler ULTRA liviano (edge, sin
// DB, cacheable) para que el crawler responda al instante y siempre pinte la
// miniatura. `id` = receiptNumber; la URL de Cloudinary es determinística (el
// public_id ES el receiptNumber), así que no hace falta tocar la base de datos.
//
// Ruta /rc/ (recibo-comprobante): /r/[id] YA es el storefront público de la rifa.
import { NextRequest } from "next/server";

export const runtime = "edge";

// El cloud_name NO es secreto (aparece en toda URL pública de recibo). Env con
// respaldo por si el runtime edge no lo inyecta.
const CLOUD = process.env.CLOUDINARY_CLOUD_NAME || "dbi6monrl";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Aceptamos "<id>" o "<id>.png". Sanitizamos: solo el juego de chars de un
  // receiptNumber (R-<digits>-<code>) → seguro para URL y HTML.
  const id = decodeURIComponent(params.id || "").replace(/\.png$/i, "");
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(id)) {
    return new Response("Comprobante no encontrado", { status: 404 });
  }

  const upload = `https://res.cloudinary.com/${CLOUD}/image/upload`;
  const path = `/riffas/receipts/${id}.png`;
  // og:image VERTICAL con el recibo COMPLETO (c_pad a 4:5, fondo del marco del
  // recibo). Aspecto tipo FOTO (no banner 1.91:1) → WhatsApp muestra la card
  // GRANDE y legible, no el thumbnail chico. Dimensiones fijas y conocidas.
  const card = `${upload}/c_pad,w_1080,h_1350,b_rgb:e6e7eb,q_auto:good,f_jpg${path}`;
  // Recibo COMPLETO (natural) para quien toca el enlace.
  const full = `${upload}/f_jpg,q_auto:good,w_1080${path}`;

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tu comprobante</title>
<meta name="robots" content="noindex,nofollow">
<meta property="og:type" content="website">
<meta property="og:title" content="Tu comprobante 🧾">
<meta property="og:description" content="Mirá tu comprobante de la rifa.">
<meta property="og:image" content="${esc(card)}">
<meta property="og:image:width" content="1080">
<meta property="og:image:height" content="1350">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(card)}">
<style>html,body{margin:0;background:#0f1115;color:#e6e7eb;font-family:system-ui,-apple-system,sans-serif}
.wrap{max-width:520px;margin:0 auto;padding:16px;text-align:center}
img{width:100%;height:auto;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.4)}
p{font-size:13px;color:#98a1ad;margin:14px 0 0}</style>
</head><body><div class="wrap">
<img src="${esc(full)}" alt="Comprobante de la rifa">
<p>🧾 Tu comprobante · guardá esta imagen</p>
</div></body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Cacheable en el edge → el crawler de WhatsApp responde al instante.
      "cache-control": "public, max-age=300, s-maxage=86400",
      "x-content-type-options": "nosniff",
    },
  });
}
