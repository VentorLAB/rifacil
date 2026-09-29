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
// fetch con timeout (defensivo: nunca colgar la venta por ImgBB/Cloudinary).
async function fetchWithTimeout(url: string, opts: any, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Baja una imagen http(s) a base64 (con 1 reintento + backoff). Lo hacemos NOSOTROS
// en el servidor en vez de pasarle la URL a ImgBB, porque cuando el recibo se acaba
// de subir a Cloudinary, ImgBB a veces no logra descargar la URL recién creada y la
// subida falla (→ caía al respaldo /rc con card chica). Con los bytes en mano, ImgBB
// no depende de descargar nada.
async function fetchImageBase64(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout(url, {}, 6_000);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 0) return buf.toString("base64");
      }
    } catch {
      // reintentamos
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

export async function uploadReceiptToImgBB(
  image: string,
  name?: string | null
): Promise<ImgbbResult | null> {
  const key = process.env.IMGBB_API_KEY;
  if (!key || !image) return null;

  // Resolver a base64. Si viene una URL http(s), la bajamos nosotros (fiable, con
  // reintento) y mandamos los BYTES. Si ya es data-URI/base64, se usa tal cual.
  let payload: string;
  if (/^https?:\/\//i.test(image)) {
    const b64 = await fetchImageBase64(image);
    if (!b64) {
      console.warn("[imgbb] no se pudo descargar la imagen del recibo para subir a ImgBB");
      return null;
    }
    payload = b64;
  } else {
    payload = image.startsWith("data:") ? image.replace(/^data:[^,]+,/, "") : image;
  }

  // Nombre saneado (solo lo permitido en un nombre de archivo simple).
  const safeName = (name || "recibo").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "recibo";

  // OJO: la key va como query param (así lo exige la API de ImgBB). NUNCA loguear
  // esta URL completa.
  const endpoint = `https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}&name=${encodeURIComponent(safeName)}`;
  const body = new URLSearchParams();
  body.set("image", payload);

  // Subida con 1 reintento (errores transitorios de ImgBB → no caer al respaldo).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout(endpoint, { method: "POST", body }, 8_000);
      if (!res.ok) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        console.warn("[imgbb] subida devolvió estado", res.status);
        return null;
      }
      const json: any = await res.json();
      const viewerUrl: string | undefined = json?.data?.url_viewer;
      const directUrl: string | undefined = json?.data?.url;
      if (viewerUrl && directUrl) return { viewerUrl, directUrl };
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      console.warn("[imgbb] respuesta sin url_viewer/url");
      return null;
    } catch (err) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      console.warn("[imgbb] subida falló:", (err as Error)?.message);
      return null;
    }
  }
  return null;
}
