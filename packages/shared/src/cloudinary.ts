// Subida de imágenes a Cloudinary — SOLO SERVIDOR (Server Actions, routers, workers).
//
// OJO: este módulo es deliberadamente independiente de "./receipt". receipt.ts
// importa satori + @resvg/resvg-js (binarios nativos) al tope, y un import
// top-level de eso tumbaba toda la API tRPC en prod (ver memoria
// trpc-native-binary-crash). cloudinary es JS puro, así que importar ESTE módulo
// es seguro. Reusa exactamente la misma config de Cloudinary que los recibos.
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * Sube una imagen (data URI base64 o URL remota) a Cloudinary y devuelve la
 * `secure_url`. Carpeta por defecto: "riffas/raffles".
 */
export async function uploadImage(
  source: string,
  opts?: { folder?: string; publicId?: string }
): Promise<string> {
  const uploaded = await cloudinary.uploader.upload(source, {
    folder: opts?.folder ?? "riffas/raffles",
    public_id: opts?.publicId,
    overwrite: true,
    resource_type: "image",
  });
  return uploaded.secure_url;
}
