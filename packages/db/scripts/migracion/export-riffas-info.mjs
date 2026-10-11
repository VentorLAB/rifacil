#!/usr/bin/env node
/**
 * Exporta TODA la data de riffas.info (API solo-lectura) a JSON local.
 * Uso:
 *   RIFFAS_TOKEN=<jwt> node packages/db/scripts/migracion/export-riffas-info.mjs [salida-dir]
 * El token sale de localStorage.AUTH_TOKEN tras iniciar sesión en riffas.info.
 * NO escribe en rifacil ni en riffas.info: solo GETs. Secuencial y con pausa
 * para no golpear el backend del cliente.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.RIFFAS_BASE || "https://riffaspernbackend-production.up.railway.app";
const TOKEN = process.env.RIFFAS_TOKEN;
const OUT = resolve(process.argv[2] || "migration-dump");
if (!TOKEN) { console.error("Falta RIFFAS_TOKEN"); process.exit(1); }

const H = { Authorization: `Bearer ${TOKEN}`, Origin: "https://www.riffas.info", Referer: "https://www.riffas.info/" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  const r = await fetch(`${BASE}/api${path}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return r.json();
}

async function getPaged(pathFn, pick) {
  const all = [];
  let page = 1, total = Infinity;
  while (all.length < total) {
    const j = await get(pathFn(page));
    const items = pick(j);
    total = j.total ?? items.length;
    all.push(...items);
    if (!items.length) break;
    page++;
    await sleep(250);
  }
  return all;
}

const dump = { exportedAt: new Date().toISOString(), base: BASE };

dump.raffles = await getPaged((p) => `/raffles?search=&page=${p}&limit=100`, (j) => j.raffles || j.data || j);
console.log(`rifas: ${dump.raffles.length}`);

dump.raffleDetails = {};
for (const r of dump.raffles) {
  const [detail, vendors, paymethods, recaudo] = await Promise.all([
    get(`/raffles/${r.id}`),
    get(`/raffles/${r.id}/assing-user`).catch(() => []),
    get(`/raffle-payment-methods/${r.id}/payment-methods`).catch(() => []),
    get(`/raffles/${r.id}/recaudo`).catch(() => null),
  ]);
  dump.raffleDetails[r.id] = { detail, vendors, paymethods, recaudo };
  console.log(`  rifa ${r.id} ${r.name}: ok`);
  await sleep(250);
}

// Clientes: cada uno trae sus raffleNumbers con payments (monto + método) = fuente rica.
dump.clients = await getPaged((p) => `/clients?page=${p}&limit=100`, (j) => j.clients || []);
console.log(`clientes: ${dump.clients.length}`);

// Tablero de números por rifa (estado por número; los payments aquí no traen monto).
dump.numbers = {};
for (const r of dump.raffles) {
  dump.numbers[r.id] = await getPaged(
    (p) => `/raffles-numbers/${r.id}?page=${p}&limit=200&search=&amount=&userId=`,
    (j) => j.raffleNumbers || []
  );
  console.log(`  números rifa ${r.id}: ${dump.numbers[r.id].length}`);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, "riffas-info-dump.json"), JSON.stringify(dump, null, 2));
console.log(`\nDump en ${OUT}/riffas-info-dump.json`);
