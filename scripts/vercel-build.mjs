// Build de Vercel con migración de prod incluida.
//
// Por qué existe: el deploy de Vercel NO aplica migraciones solo (el build es
// `turbo run build`). Antes había que correr `prisma migrate deploy` a mano
// contra prod en cada merge; olvidarlo dejó a prod sin una columna y tumbó la
// landing (ver memoria prod-migrations-manual). Esto lo automatiza, SOLO en
// producción.
//
// Reglas:
//  - Guard: solo migra cuando VERCEL_ENV === "production". En preview/develop
//    se saltea (esos builds no deben tocar el schema de prod, y DIRECT_URL solo
//    está seteada en Production).
//  - Corre desde packages/db (`--filter @riffas/db`); `prisma migrate deploy`
//    usa datasource.directUrl = env("DIRECT_URL") (conexión directa, no-pooler).
//  - Fail-safe: si la migración falla, execSync lanza → el proceso sale !=0 →
//    el build de Vercel falla → el deploy queda BLOQUEADO (no servimos código
//    nuevo contra un schema viejo).

import { execSync } from "node:child_process";

const env = process.env.VERCEL_ENV ?? "(unset)";
const run = (cmd) => execSync(cmd, { stdio: "inherit" });

//  - Puente al VPS (DB_WS_PROXY definida): la base NO es alcanzable por TCP
//    desde el build de Vercel, así que `migrate deploy` no puede correr aquí.
//    En su lugar se COMPRUEBA por el puente (solo lectura) que no falte
//    ninguna migración; si falta, el build falla igual que antes. Las
//    migraciones se aplican a mano: docs/MIGRACION-NEON-A-VPS.md.
const bridged = Boolean(process.env.DB_WS_PROXY?.trim());

if (env === "production" && bridged) {
  console.log("[vercel-build] VERCEL_ENV=production + DB_WS_PROXY → check de migraciones por el puente…");
  run("pnpm --filter @riffas/db exec tsx scripts/check-migrations.ts");
} else if (env === "production") {
  console.log("[vercel-build] VERCEL_ENV=production → prisma migrate deploy (packages/db, DIRECT_URL)…");
  run("pnpm --filter @riffas/db exec prisma migrate deploy");
} else {
  console.log(`[vercel-build] VERCEL_ENV=${env} → skip migraciones (solo producción).`);
}

console.log("[vercel-build] turbo run build…");
// Vía `pnpm exec` para resolver turbo desde node_modules/.bin sin depender del
// PATH ni del cwd (el buildCommand corre con cwd = apps/web, Root Directory del
// proyecto en Vercel; el script vive en la raíz del repo).
run("pnpm exec turbo run build");
