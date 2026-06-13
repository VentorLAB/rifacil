/**
 * Carga el .env de la raíz del repo como EFECTO SECUNDARIO, al importarse.
 * Debe importarse ANTES que cualquier módulo que lea process.env en su tope
 * (receipt.ts hace cloudinary.config() al cargarse vía el sale router).
 *
 * No carga CLOUDINARY_URL: en el .env trae <placeholders> y el SDK de
 * Cloudinary lo auto-parsearía mal. receipt.ts usa las 3 vars discretas.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const raw = readFileSync(resolve(__dirname, "../../../.env"), "utf8");
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m || m[1] === "CLOUDINARY_URL") continue;
  const val = m[2].trim().replace(/^["']|["']$/g, "");
  if (process.env[m[1]] === undefined) process.env[m[1]] = val;
}
