// Subida del recibo a ImgBB para que WhatsApp muestre la card GRANDE y legible
// dentro del mensaje (sin abrir enlace) — exactamente como lo hace la app de
// referencia (riffas.info): sube la imagen a ImgBB y comparte el link `ibb.co`.
//
// Por qué ImgBB y no nuestra propia página /rc: WhatsApp escanea la página del
// enlace y pinta su og:image. La página de ImgBB (ibb.co) sirve un PNG estático
// desde un CDN de imágenes puro y WhatsApp la renderiza de forma FIABLE como card
// grande. Nuestra página en Cloudinary caía a la miniatura chica.
//
// DOS vías de subida (experimento 13-oct, sin garantías — la decisión
// grande/chico la toma la app del que ENVÍA y WhatsApp no la documenta):
//   1. PRIMARIA — INVITADO (sin cuenta): endpoint web de ibb.co, igual que un
//      usuario anónimo del sitio. La página viewer sale "hosted on ImgBB" SIN
//      álbum — BYTE A BYTE como la referencia de riffas.info (la API oficial
//      con key deja la imagen en el perfil de la cuenta y la página sale
//      "in the X's images album", la única diferencia restante detectada).
//   2. RESPALDO — API oficial (api.imgbb.com con IMGBB_API_KEY): si el
//      endpoint web falla o cambia. Cae en el perfil/álbum de la cuenta.
// Falla suave: si ambas fallan, devuelve null y el llamador cae a /rc.
//
// La API key va SOLO en env de servidor (IMGBB_API_KEY). NUNCA hardcodear.

// Nombre "bonito" de la imagen del recibo en ImgBB → se convierte en el
// og:title de la página visor ("<nombre> hosted at ImgBB"), o sea el TÍTULO
// que WhatsApp pinta en el preview del mensaje. Antes se subía el receiptNumber
// ("R 1792009879091 X9ST") y el preview salía con ese código feo (14-oct).
// OJO: ImgBB NO muestra guiones/separadores en el título (los quita) — el
// título sale como frase corrida de palabras.
export function receiptShareName(parts: {
  raffleTitle?: string | null;
  brandName?: string | null;
  receiptNumber?: string | null;
}): string {
  const bits = ["Tu recibo"];
  if (parts.raffleTitle) bits.push(parts.raffleTitle);
  if (parts.brandName) bits.push(parts.brandName);
  if (bits.length === 1 && parts.receiptNumber) bits.push(parts.receiptNumber);
  return bits.join(" - ");
}

export interface ImgbbResult {
  /** Página del visor (https://ibb.co/XXXX) — este es el link que se manda por WhatsApp. */
  viewerUrl: string;
  /** Imagen directa (https://i.ibb.co/XXXX/nombre.png). */
  directUrl: string;
}

/**
 * Sube una imagen (por URL, base64 o data-URI) a ImgBB. Devuelve el link del visor
 * (ibb.co) + la imagen directa, o `null` si ambas vías de subida fallan.
 * No requiere API key para la vía primaria (invitado); la key es solo respaldo.
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
  if (!image) return null;

  // Resolver a BYTES. Si viene una URL http(s), la bajamos nosotros (fiable, con
  // reintento). Si ya es data-URI/base64, se usa tal cual.
  let bytes: Buffer | null = null;
  if (/^https?:\/\//i.test(image)) {
    const b64 = await fetchImageBase64(image);
    if (!b64) {
      console.warn("[imgbb] no se pudo descargar la imagen del recibo para subir a ImgBB");
      return null;
    }
    bytes = Buffer.from(b64, "base64");
  } else {
    const b64 = image.startsWith("data:") ? image.replace(/^data:[^,]+,/, "") : image;
    try {
      bytes = Buffer.from(b64, "base64");
    } catch {
      bytes = null;
    }
  }
  if (!bytes || bytes.length === 0) return null;

  // Nombre saneado: letras Unicode (con acentos), dígitos, espacios, guion y
  // underscore. Verificado 14-oct contra el endpoint real de ibb.co: el nombre
  // llega INTACTO (espacios y acentos incluidos) al og:title de la página visor
  // → es el TÍTULO del preview de WhatsApp ("<nombre> hosted at ImgBB").
  const safeName = (name || "recibo")
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .trim() || "recibo";

  // 1) PRIMARIA: subida de INVITADO (sin cuenta) — viewer "hosted on ImgBB".
  const guest = await uploadGuest(bytes, safeName);
  if (guest) {
    await warmUp(guest);
    return guest;
  }

  // 2) RESPALDO: API oficial con key (cae en el perfil/álbum de la cuenta).
  const key = process.env.IMGBB_API_KEY;
  if (!key) return null;
  const api = await uploadWithApiKey(bytes, safeName, key);
  if (api) {
    await warmUp(api);
    return api;
  }
  return null;
}

// Subida de INVITADO al endpoint web de ImgBB (https://ibb.co/json) — el mismo
// que usa el sitio para usuarios anónimos. NO usa API key y la imagen NO queda
// ligada a ninguna cuenta/álbum: la página viewer sale "Image X hosted on
// ImgBB", idéntica a la de la referencia riffas.info. Endpoint NO documentado:
// por eso es la vía primaria pero con respaldo automático en la API oficial.
async function uploadGuest(png: Buffer, safeName: string): Promise<ImgbbResult | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const form = new FormData();
      form.set("action", "upload");
      form.set("type", "file");
      form.set("source", new Blob([new Uint8Array(png)], { type: "image/png" }), `${safeName}.png`);
      const res = await fetchWithTimeout(
        "https://ibb.co/json",
        { method: "POST", headers: { accept: "application/json" }, body: form },
        10_000
      );
      if (!res.ok) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        console.warn("[imgbb] subida invitado devolvió estado", res.status);
        return null;
      }
      const json: any = await res.json();
      const viewerUrl: string | undefined = json?.image?.url_viewer;
      const directUrl: string | undefined = json?.image?.url;
      if (json?.status_code === 200 && viewerUrl && directUrl) {
        return { viewerUrl, directUrl };
      }
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      console.warn("[imgbb] respuesta invitado sin url_viewer/url");
      return null;
    } catch (err) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      console.warn("[imgbb] subida invitado falló:", (err as Error)?.message);
      return null;
    }
  }
  return null;
}

// Subida por la API OFICIAL de ImgBB (api.imgbb.com/1/upload?key=...). La imagen
// queda ligada al perfil de la cuenta dueña de la key (su página viewer sale
// "in the X's images album"). Se usa solo como respaldo de la vía invitado.
async function uploadWithApiKey(
  png: Buffer,
  safeName: string,
  key: string
): Promise<ImgbbResult | null> {
  // OJO: la key va como query param (así lo exige la API de ImgBB). NUNCA loguear
  // esta URL completa.
  const endpoint = `https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}&name=${encodeURIComponent(safeName)}`;
  const body = new URLSearchParams();
  body.set("image", png.toString("base64"));

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
      if (viewerUrl && directUrl) {
        return { viewerUrl, directUrl };
      }
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

// WARM-UP: el crawler de WhatsApp scrapea el link SEGUNDOS después del envío;
// si la imagen aún no está caliente en el CDN de ImgBB, la preview cae a la
// miniatura chica (le pasó al reenvío de una venta vieja, 13-oct). Pegamos un
// fetch a la página y a la imagen directa ANTES de devolver el link, para que
// el primer scrape real ya la encuentre servida. Best-effort: si falla, el
// link igual funciona.
async function warmUp(result: ImgbbResult): Promise<void> {
  await Promise.all([
    fetchWithTimeout(result.viewerUrl, {}, 4_000).catch(() => null),
    fetchWithTimeout(result.directUrl, {}, 4_000).catch(() => null),
  ]);
}
