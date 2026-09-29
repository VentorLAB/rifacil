// Subida del recibo a ImgBB para que WhatsApp muestre la card GRANDE y legible
// dentro del mensaje (sin abrir enlace) — exactamente como lo hace la app de
// referencia (riffas.info): sube la imagen a ImgBB y comparte el link `ibb.co`.
//
// Por qué ImgBB y no nuestra propia página /rc: WhatsApp escanea la página del
// enlace y pinta su og:image. La página de ImgBB (ibb.co) sirve un PNG estático
// desde un CDN de imágenes puro y WhatsApp la renderiza de forma FIABLE como card
// grande. Nuestra página en Cloudinary caía a la miniatura chica.
//
// La API acepta `image` como URL, base64 o binario → le pasamos la URL de
// Cloudinary del recibo (ya generado). Falla suave: si no hay API key o la subida
// falla, devuelve null y el llamador cae al comportamiento anterior (/rc).
//
// La API key va SOLO en env de servidor (IMGBB_API_KEY). NUNCA hardcodear.

export interface ImgbbResult {
  /** Página del visor (https://ibb.co/XXXX) — este es el link que se manda por WhatsApp. */
  viewerUrl: string;
  /** Imagen directa (https://i.ibb.co/XXXX/nombre.png). */
  directUrl: string;
}

/**
 * Sube una imagen (por URL, base64 o data-URI) a ImgBB. Devuelve el link del visor
 * (ibb.co) + la imagen directa, o `null` si no hay API key o la subida falla.
 *
 * @param image  URL http(s), base64 puro, o data-URI de la imagen del recibo.
 * @param name   Nombre del archivo en ImgBB (p.ej. el receiptNumber). Se sanea.
 */
export async function uploadReceiptToImgBB(
  image: string,
  name?: string | null
): Promise<ImgbbResult | null> {
  const key = process.env.IMGBB_API_KEY;
  if (!key || !image) return null;

  // ImgBB quiere la imagen SIN el prefijo data-URI cuando es base64.
  const value = image.startsWith("data:") ? image.replace(/^data:[^,]+,/, "") : image;

  // Nombre saneado (solo lo permitido en un nombre de archivo simple).
  const safeName = (name || "recibo").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "recibo";

  const endpoint = `https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}&name=${encodeURIComponent(safeName)}`;
  const body = new URLSearchParams();
  body.set("image", value);

  try {
    // Timeout defensivo: nunca bloquear la venta por ImgBB.
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(endpoint, { method: "POST", body, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const json: any = await res.json();
    const viewerUrl: string | undefined = json?.data?.url_viewer;
    const directUrl: string | undefined = json?.data?.url;
    if (!viewerUrl || !directUrl) return null;
    return { viewerUrl, directUrl };
  } catch {
    // red caída, timeout, JSON inválido → falla suave.
    return null;
  }
}
