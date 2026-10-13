#!/usr/bin/env node
/**
 * Exporta TODA la data de riffas.info (API solo-lectura) a JSON local.
 * Uso (PowerShell; el token NO pasa por ningún chat):
 *   $env:RIFFAS_TOKEN = "<jwt>"
 *   node packages/db/scripts/migracion/export-riffas-info.mjs C:\dev\migracion-riffas-info\<fecha>
 *   Remove-Item Env:RIFFAS_TOKEN
 * El token sale de localStorage.AUTH_TOKEN tras iniciar sesión en riffas.info.
 * NO escribe en rifacil ni en riffas.info: solo GETs. Secuencial y con pausa
 * para no golpear el backend del cliente.
 *
 * El dump trae datos personales (~1.150 clientes): la carpeta de salida debe
 * quedar FUERA del repo. El script se niega a escribir dentro de él.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.RIFFAS_BASE || "https://riffaspernbackend-production.up.railway.app";
const TOKEN = process.env.RIFFAS_TOKEN;
const OUT = process.argv[2] ? resolve(process.argv[2]) : null;
if (!TOKEN) { console.error("Falta RIFFAS_TOKEN"); process.exit(1); }
if (!OUT) { console.error("Falta la carpeta de salida (fuera del repo), p. ej. C:\\dev\\migracion-riffas-info\\2026-10-14"); process.exit(1); }

// Refuse to write personal data inside the git repository.
const here = dirname(fileURLToPath(import.meta.url));
let repoRoot = here;
while (repoRoot !== dirname(repoRoot) && !existsSync(resolve(repoRoot, ".git"))) repoRoot = dirname(repoRoot);
const rel = relative(repoRoot.toLowerCase(), OUT.toLowerCase());
const insideRepo = existsSync(resolve(repoRoot, ".git")) && !rel.startsWith("..") && !isAbsolute(rel);
if (insideRepo) {
  console.error(`La salida ${OUT} está dentro del repo (${repoRoot}). Usa una carpeta fuera, p. ej. C:\\dev\\migracion-riffas-info\\<fecha>`);
  process.exit(1);
}

const H = { Authorization: `Bearer ${TOKEN}`, Origin: "https://www.riffas.info", Referer: "https://www.riffas.info/" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

async function get(path) {
  const r = await fetch(`${BASE}/api${path}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return r.json();
}

/**
 * Pages until the API says we have everything. Without a `total` it keeps going
 * until an empty page (a missing `total` used to stop after page 1 and silently
 * truncate the export). Fails loudly on a short count or a repeating page.
 */
async function getPaged(label, pathFn, pick) {
  const all = [];
  let total = null;
  let lastFirstId;
  for (let page = 1; ; page++) {
    if (page > 2000) throw new Error(`${label}: too many pages`);
    const j = await get(pathFn(page));
    const items = pick(j);
    if (!Array.isArray(items)) throw new Error(`${label}: unexpected response shape on page ${page}`);
    if (typeof j.total === "number") total = j.total;
    if (!items.length) break;
    const firstId = items[0]?.id;
    if (firstId !== undefined && firstId === lastFirstId) throw new Error(`${label}: page ${page} repeats the previous page (API ignores paging?)`);
    lastFirstId = firstId;
    all.push(...items);
    if (total !== null && all.length >= total) break;
    await sleep(250);
  }
  if (total !== null && all.length !== total) throw new Error(`${label}: got ${all.length} of ${total}`);
  return all;
}

const soft = (label, p, fallback) =>
  p.catch((e) => {
    errors.push(`${label}: ${e.message}`);
    return fallback;
  });

const dump = { exportedAt: new Date().toISOString(), base: BASE };

dump.raffles = await getPaged("rifas", (p) => `/raffles?search=&page=${p}&limit=100`, (j) => j.raffles || j.data || j);
console.log(`rifas: ${dump.raffles.length}`);

dump.raffleDetails = {};
for (const r of dump.raffles) {
  const [detail, vendors, paymethods, recaudo] = await Promise.all([
    get(`/raffles/${r.id}`),
    soft(`vendedores rifa ${r.id}`, get(`/raffles/${r.id}/assing-user`), []),
    // Without payment methods every abono would map to CASH: fail loudly.
    get(`/raffle-payment-methods/${r.id}/payment-methods`),
    soft(`recaudo rifa ${r.id}`, get(`/raffles/${r.id}/recaudo`), null),
  ]);
  dump.raffleDetails[r.id] = { detail, vendors, paymethods, recaudo };
  console.log(`  rifa ${r.id} ${r.name}: ok (${paymethods.length} métodos de pago)`);
  await sleep(250);
}

// Clientes: cada uno trae sus raffleNumbers con payments (monto + método) = fuente rica.
dump.clients = await getPaged("clientes", (p) => `/clients?page=${p}&limit=100`, (j) => j.clients || []);
console.log(`clientes: ${dump.clients.length}`);

// Tablero de números por rifa (estado por número; los payments aquí no traen monto).
dump.numbers = {};
for (const r of dump.raffles) {
  dump.numbers[r.id] = await getPaged(
    `números rifa ${r.id}`,
    (p) => `/raffles-numbers/${r.id}?page=${p}&limit=200&search=&amount=&userId=`,
    (j) => j.raffleNumbers || [],
  );
  console.log(`  números rifa ${r.id}: ${dump.numbers[r.id].length}`);
}

dump.errors = errors;
mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, "riffas-info-dump.json"), JSON.stringify(dump, null, 2));
console.log(`\nDump en ${OUT}\\riffas-info-dump.json`);
if (errors.length) {
  console.log(`\n⚠ ${errors.length} llamadas opcionales fallaron (quedan en dump.errors):`);
  for (const e of errors) console.log(`  - ${e}`);
}
