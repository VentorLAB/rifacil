/**
 * riffas.info → rifacil importer.
 *
 * SAFE BY DEFAULT. Without --confirm it is a DRY-RUN: it plans every raffle,
 * then READS the target database (never writes) to report what would happen
 * and which blockers stop it. A real run needs ALL of:
 *   --confirm MIGRAR --user-id <cuid> --expect-host <host of DATABASE_URL>
 * and zero blockers.
 *
 *   # dry-run (reads the DB, writes nothing; report JSON goes to the dump dir)
 *   npx tsx scripts/migracion/import-riffas-info.ts --dump <dir> --user-id <cuid>
 *   # real run (one transaction per raffle)
 *   npx tsx scripts/migracion/import-riffas-info.ts --dump <dir> --user-id <cuid> \
 *       --expect-host <host> --confirm MIGRAR
 *   # rollback of what this tool imported (dry-run unless --confirm MIGRAR)
 *   npx tsx scripts/migracion/import-riffas-info.ts --dump <dir> --rollback [--expect-host <host> --confirm MIGRAR]
 *
 * Options: --raffle-id <ext> (only that raffle) · --map <ext=raffleId|new,...>
 * (explicit target; otherwise matched by title) · --drawn <ext,...> (force DRAWN)
 * · --skip-raffle <ext,ext>
 * (default 96: El Dubai is reconciled by packages/api/scripts/import-eldubai-v1.ts)
 * · --cash-method EFECTIVO_USD|EFECTIVO_VES|CASH · --offline (plan only, no DB).
 *
 * DATABASE_URL must be set in the shell. This script does NOT load the repo
 * .env on purpose (it points at the DEV database).
 *
 * Behaviour (see docs/MIGRACION-RIFFAS-INFO.md for the mapping):
 *  - A raffle that already exists in rifacil with the same title is ADOPTED:
 *    its id, banners, prizes, winner and visibility are kept; only numbers and
 *    sales are filled in. A past draw ends up DRAWN (closed to sales).
 *  - Sales made in rifacil itself (not from this import) are never touched: if
 *    a target raffle has any, the raffle is blocked and they are listed.
 *  - Re-running replaces only what this tool imported (receipts IMP<ext>-…).
 *  - id-map.json records raffles, contacts and vendors created, so --rollback
 *    can remove exactly that.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient, type Prisma } from "../../src/generated";
// Relative on purpose: @riffas/db must not depend on @riffas/shared (the other
// way around exists). phone.ts only needs libphonenumber-js.
import { countryFromE164, normalizePhone } from "../../../shared/src/phone";
import { planRaffle, titleKey, type PaymentMethodName, type RafflePlan } from "./lib/plan";
import {
  assertExpectedHost,
  countByStatus,
  hostOf,
  recomputeContactMetrics,
  recomputeRaffleStats,
} from "./lib/db-helpers";

// ── args ──
const args = process.argv.slice(2);
const getArg = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] ?? null : null;
};
const has = (k: string) => args.includes(k);
const CONFIRM = getArg("--confirm") === "MIGRAR";
const ROLLBACK = has("--rollback");
const OFFLINE = has("--offline");
const USER_ID = getArg("--user-id");
const EXPECT_HOST = getArg("--expect-host") ?? process.env.EXPECT_HOST ?? null;
const DUMP_ARG = getArg("--dump");
const CASH_METHOD = (getArg("--cash-method") ?? "EFECTIVO_USD") as PaymentMethodName;
const ONLY = getArg("--raffle-id");
const SKIP = new Set((getArg("--skip-raffle") ?? "96").split(",").map((s) => s.trim()).filter(Boolean));
// --drawn 79,73,112 : force DRAWN (closed to sales) regardless of riffas.info's date.
const FORCE_DRAWN = new Set((getArg("--drawn") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
// --map 73=<rifacil raffle id>,117=new : explicit target per riffas.info raffle.
const MAP = new Map(
  (getArg("--map") ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((kv) => {
    const [k, v] = kv.split("=").map((x) => x.trim());
    return [k, v] as const;
  }),
);
const TX_TIMEOUT_MS = 30 * 60_000;

if (!DUMP_ARG) {
  console.error("Missing --dump <dir> (the folder with riffas-info-dump.json; keep it OUTSIDE the repo)");
  process.exit(1);
}
if (!["EFECTIVO_USD", "EFECTIVO_VES", "CASH"].includes(CASH_METHOD)) {
  console.error(`--cash-method must be EFECTIVO_USD, EFECTIVO_VES or CASH (got ${CASH_METHOD})`);
  process.exit(1);
}
const DUMP_DIR = resolve(DUMP_ARG);
const ID_MAP_PATH = resolve(DUMP_DIR, "id-map.json");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

// ── id-map (v2). Legacy v1 entries were plain raffle ids from the old importer. ──
interface IdMapEntry {
  raffleId: string;
  mode: "create" | "adopt";
  contactIds: string[];
  vendorIds: string[];
  importedAt: string;
}
type IdMap = Record<string, IdMapEntry>;

function loadIdMap(): IdMap {
  if (!existsSync(ID_MAP_PATH)) return {};
  const raw = JSON.parse(readFileSync(ID_MAP_PATH, "utf8")) as Record<string, unknown>;
  const out: IdMap = {};
  for (const [ext, v] of Object.entries(raw)) {
    out[ext] =
      typeof v === "string"
        ? { raffleId: v, mode: "create", contactIds: [], vendorIds: [], importedAt: "legacy" }
        : (v as IdMapEntry);
  }
  return out;
}
const saveIdMap = (m: IdMap) => writeFileSync(ID_MAP_PATH, JSON.stringify(m, null, 2));

const receiptPrefix = (ext: string) => `IMP${ext}-`;

// ── preflight (READ-ONLY) ──
interface Preflight {
  ext: string;
  mode: "create" | "adopt" | "reimport";
  raffleId: string | null;
  existing: { title: string; status: string; isPublic: boolean } | null;
  existingNumbers: number;
  importedSalesToReplace: number;
  protectedSales: Array<{ receiptNumber: string; source: string | null; contact: string; numbers: string[]; amountPaid: number }>;
  contactsReused: number;
  contactsNew: number;
  vendorsReused: number;
  vendorsNew: number;
  blockers: string[];
}

async function preflight(prisma: PrismaClient, plan: RafflePlan, userId: string | null, idMap: IdMap): Promise<Preflight> {
  const pf: Preflight = {
    ext: plan.ext, mode: "create", raffleId: null, existing: null, existingNumbers: 0,
    importedSalesToReplace: 0, protectedSales: [], contactsReused: 0, contactsNew: 0,
    vendorsReused: 0, vendorsNew: 0, blockers: [],
  };
  if (!userId) {
    pf.blockers.push("no --user-id: cannot check the target account");
    return pf;
  }

  // Which raffle does this land on?
  const mapped = idMap[plan.ext];
  const sel = { id: true, title: true, status: true, isPublic: true, totalNumbers: true, pricePerNumber: true } as const;
  let target: { id: string; title: string; status: string; isPublic: boolean; totalNumbers: number; pricePerNumber: unknown } | null = null;
  if (mapped) {
    target = await prisma.raffle.findFirst({ where: { id: mapped.raffleId, userId }, select: sel });
    if (!target) pf.blockers.push(`id-map points to raffle ${mapped.raffleId}, which is not in this account (wrong database or deleted)`);
    pf.mode = "reimport";
  } else if (MAP.get(plan.ext) === "new") {
    pf.mode = "create";
  } else if (MAP.has(plan.ext)) {
    target = await prisma.raffle.findFirst({ where: { id: MAP.get(plan.ext)!, userId }, select: sel });
    if (!target) pf.blockers.push(`--map ${plan.ext}=${MAP.get(plan.ext)}: no such raffle in this account`);
    pf.mode = "adopt";
  } else {
    // riffas.info titles carry a brand prefix ("Rifas Hermanos Pernía - El Marino")
    // while rifacil has "El Marino": match on containment, not equality.
    const all = await prisma.raffle.findMany({ where: { userId }, select: sel });
    const mine = titleKey(plan.title);
    const same = all.filter((r) => {
      const k = titleKey(r.title);
      return k === mine || (Math.min(k.length, mine.length) >= 5 && (mine.includes(k) || k.includes(mine)));
    });
    if (same.length > 1) {
      pf.blockers.push(`${same.length} raffles match "${plan.title}": ${same.map((r) => `${r.title} (${r.id})`).join(", ")} — choose with --map ${plan.ext}=<id>`);
    }
    if (same.length === 1) {
      target = same[0];
      pf.mode = "adopt";
    }
  }

  if (target) {
    pf.raffleId = target.id;
    pf.existing = { title: target.title, status: target.status, isPublic: target.isPublic };
    if (target.totalNumbers !== plan.totalNumbers) {
      pf.blockers.push(`"${target.title}" has ${target.totalNumbers} numbers in rifacil vs ${plan.totalNumbers} in riffas.info`);
    }
    // Adoption keeps rifacil's price; a different price would make receipts disagree with the sales.
    if (Math.abs(Number(target.pricePerNumber) - plan.pricePerNumber) > 0.005) {
      pf.blockers.push(`"${target.title}" costs $${Number(target.pricePerNumber)} per number in rifacil vs $${plan.pricePerNumber} in riffas.info`);
    }
    if (target.status === "DRAWN" && plan.status === "ACTIVE") {
      pf.blockers.push(`"${target.title}" is DRAWN in rifacil but its riffas.info draw date is in the future — confirm which is right`);
    }
    const numbers = await prisma.raffleNumber.findMany({ where: { raffleId: target.id }, select: { number: true } });
    pf.existingNumbers = numbers.length;
    const universe = new Set(plan.universe);
    const foreign = numbers.filter((n) => !universe.has(n.number));
    if (foreign.length) {
      pf.blockers.push(`${foreign.length} existing numbers do not match the riffas.info numbering (e.g. ${foreign.slice(0, 5).map((n) => n.number).join(", ")})`);
    }
    const strayOccupied = await prisma.raffleNumber.count({
      where: {
        raffleId: target.id,
        status: { not: "AVAILABLE" },
        OR: [{ saleId: null }, { sale: { NOT: { source: "import", receiptNumber: { startsWith: receiptPrefix(plan.ext) } } } }],
      },
    });
    if (strayOccupied) pf.blockers.push(`${strayOccupied} numbers already occupied in rifacil by something other than this import`);
    const sales = await prisma.sale.findMany({
      where: { raffleId: target.id },
      select: { receiptNumber: true, source: true, numbers: true, amountPaid: true, contact: { select: { name: true, phone: true } } },
    });
    for (const s of sales) {
      if (s.source === "import" && s.receiptNumber.startsWith(receiptPrefix(plan.ext))) pf.importedSalesToReplace++;
      else {
        pf.protectedSales.push({
          receiptNumber: s.receiptNumber, source: s.source, contact: `${s.contact.name} · ${s.contact.phone}`,
          numbers: s.numbers, amountPaid: Number(s.amountPaid),
        });
      }
    }
    if (pf.protectedSales.length) {
      pf.blockers.push(`${pf.protectedSales.length} sales in this raffle were NOT made by this import (protected): review the list`);
    }
  }

  // Receipt numbers must not exist in another raffle.
  const receipts = plan.sales.map((s) => s.receiptNumber);
  const clash = await prisma.sale.findMany({
    where: { receiptNumber: { in: receipts }, ...(target ? { raffleId: { not: target.id } } : {}) },
    select: { receiptNumber: true, raffleId: true },
  });
  if (clash.length) pf.blockers.push(`${clash.length} receipt numbers already used in another raffle (e.g. ${clash[0].receiptNumber})`);

  // Contacts reused (by normalized phone) vs new.
  const phones = [...new Set(plan.sales.map((s) => s.contact.phone))];
  const known = await prisma.contact.count({ where: { userId, phone: { in: phones } } });
  pf.contactsReused = known;
  pf.contactsNew = phones.length - known;

  // Vendors reused vs new.
  for (const v of plan.vendors) {
    const found = await findVendor(prisma, userId, v);
    if (found) pf.vendorsReused++;
    else pf.vendorsNew++;
  }
  return pf;
}

async function findVendor(db: PrismaClient | Prisma.TransactionClient, userId: string, v: RafflePlan["vendors"][number]) {
  const byCode = await db.vendor.findUnique({ where: { code: v.code }, select: { id: true, userId: true } });
  if (byCode) return byCode.userId === userId ? byCode : null;
  if (v.idDocument) {
    const all = await db.vendor.findMany({ where: { userId, idDocument: { not: null } }, select: { id: true, idDocument: true } });
    const hit = all.find((x) => (x.idDocument ?? "").replace(/[^\dA-Za-z]/g, "") === v.idDocument);
    if (hit) return hit;
  }
  if (v.phone) {
    const hit = await db.vendor.findFirst({ where: { userId, phone: v.phone }, select: { id: true } });
    if (hit) return hit;
  }
  return null;
}

// ── real import of ONE raffle, atomically ──
async function importRaffle(prisma: PrismaClient, plan: RafflePlan, pf: Preflight, userId: string): Promise<IdMapEntry> {
  return prisma.$transaction(
    async (tx) => {
      // 1) Vendors (reuse by code / document / phone).
      const vendorIdByExt = new Map<string, string>();
      const createdVendors: string[] = [];
      for (const v of plan.vendors) {
        let found = await findVendor(tx, userId, v);
        if (!found) {
          found = await tx.vendor.create({
            data: { userId, name: v.name, lastName: v.lastName, idDocument: v.idDocument, phone: v.phone, code: v.code, role: v.role },
            select: { id: true },
          });
          createdVendors.push(found.id);
        }
        vendorIdByExt.set(v.extUserId, found.id);
      }

      // 2) Target raffle.
      let raffleId: string;
      if (pf.raffleId) {
        raffleId = pf.raffleId;
        // Replace only what this tool imported before; protected sales were a blocker.
        const old = await tx.sale.findMany({
          where: { raffleId, source: "import", receiptNumber: { startsWith: receiptPrefix(plan.ext) } },
          select: { id: true },
        });
        if (old.length) {
          const ids = old.map((s) => s.id);
          await tx.raffleNumber.updateMany({
            where: { raffleId, saleId: { in: ids } },
            data: { status: "AVAILABLE", contactId: null, saleId: null, vendorId: null, soldAt: null, paidAt: null, receiptNumber: null, paymentMethod: null },
          });
          await tx.sale.deleteMany({ where: { id: { in: ids } } }); // payments cascade
        }
        // Never re-open a raffle: only close it when the draw date passed.
        if (plan.status === "DRAWN") await tx.raffle.update({ where: { id: raffleId }, data: { status: "DRAWN" } });
      } else {
        const created = await tx.raffle.create({
          data: {
            userId, title: plan.title, description: plan.description, prize: plan.prize, prizeValue: "0",
            representanteLegal: plan.representanteLegal, representanteCedula: plan.representanteCedula,
            loteria: plan.loteria, contactWhatsapp: plan.contactWhatsapp, color: plan.color,
            bannerUrl: plan.bannerUrl, bannerMobileUrl: plan.bannerMobileUrl,
            pricePerNumber: String(plan.pricePerNumber), totalNumbers: plan.totalNumbers,
            numberFormat: "0".repeat(plan.numberWidth),
            startDate: plan.startDate ?? plan.drawDate ?? new Date(), drawDate: plan.drawDate,
            status: plan.status, isPublic: plan.status === "ACTIVE",
          },
          select: { id: true },
        });
        raffleId = created.id;
      }

      // 3) Every number exists (AVAILABLE unless sold below).
      await tx.raffleNumber.createMany({
        data: plan.universe.map((number) => ({ raffleId, number })),
        skipDuplicates: true,
      });
      const occupiedBefore = await tx.raffleNumber.count({ where: { raffleId, status: { not: "AVAILABLE" } } });
      if (occupiedBefore) throw new Error(`raffle ${raffleId} still has ${occupiedBefore} occupied numbers not from this import`);

      // 4) Contacts: create missing (names of existing contacts are NOT overwritten).
      const phones = [...new Set(plan.sales.map((s) => s.contact.phone))];
      const before = new Set(
        (await tx.contact.findMany({ where: { userId, phone: { in: phones } }, select: { phone: true } })).map((c) => c.phone),
      );
      const firstByPhone = new Map<string, RafflePlan["sales"][number]["contact"]>();
      for (const s of plan.sales) if (!firstByPhone.has(s.contact.phone)) firstByPhone.set(s.contact.phone, s.contact);
      const now = new Date();
      await tx.contact.createMany({
        data: [...firstByPhone.values()]
          .filter((c) => !before.has(c.phone))
          .map((c) => ({
            userId, name: c.name, phone: c.phone, city: c.city, country: c.country,
            source: "import", importedFrom: `riffas.info #${plan.ext}`, importedAt: now,
          })),
        skipDuplicates: true,
      });
      const contactRows = await tx.contact.findMany({ where: { userId, phone: { in: phones } }, select: { id: true, phone: true } });
      const contactIdByPhone = new Map(contactRows.map((c) => [c.phone, c.id]));
      const createdContacts = contactRows.filter((c) => !before.has(c.phone)).map((c) => c.id);

      // 5) Sales + payments + numbers.
      for (const s of plan.sales) {
        const contactId = contactIdByPhone.get(s.contact.phone);
        if (!contactId) throw new Error(`contact for ${s.receiptNumber} was not created`);
        const vendorId = s.vendorExtUserId ? vendorIdByExt.get(s.vendorExtUserId) ?? null : null;
        const sale = await tx.sale.create({
          data: {
            raffleId, contactId, userId, vendorId,
            numbers: s.numbers.map((n) => n.number), totalNumbers: s.numbers.length,
            totalAmount: String(s.totalAmount), finalAmount: String(s.totalAmount), amountPaid: String(s.amountPaid),
            status: s.status, paidAt: s.paidAt, receiptNumber: s.receiptNumber, source: "import",
            ...(s.createdAt ? { createdAt: s.createdAt } : {}),
            ...(s.payments.length
              ? {
                  payments: {
                    createMany: {
                      data: s.payments.map((p) => ({
                        amount: String(p.amount), method: p.method, status: "CONFIRMED" as const,
                        ...(p.createdAt ? { createdAt: p.createdAt } : {}),
                      })),
                    },
                  },
                }
              : {}),
          },
          select: { id: true },
        });
        const soldAt = s.createdAt ?? now;
        for (const status of ["PAID", "SOLD", "RESERVED"] as const) {
          const nums = s.numbers.filter((n) => n.status === status).map((n) => n.number);
          if (!nums.length) continue;
          const res = await tx.raffleNumber.updateMany({
            where: { raffleId, number: { in: nums }, status: "AVAILABLE" },
            data: {
              status, contactId, saleId: sale.id, vendorId, soldAt, receiptNumber: s.receiptNumber,
              paidAt: status === "PAID" ? s.paidAt ?? soldAt : null,
            },
          });
          // A number that did not exist or was already taken aborts the whole raffle.
          if (res.count !== nums.length) {
            throw new Error(`${s.receiptNumber}: expected to fill ${nums.length} numbers, filled ${res.count}`);
          }
        }
      }

      // 6) Denormalized stats.
      await recomputeRaffleStats(tx, raffleId);
      await recomputeContactMetrics(tx, contactRows.map((c) => c.id));

      const prev = pf.mode === "reimport" ? loadIdMap()[plan.ext] : undefined;
      return {
        raffleId,
        mode: pf.mode === "create" ? "create" : prev?.mode ?? "adopt",
        contactIds: [...new Set([...(prev?.contactIds ?? []), ...createdContacts])],
        vendorIds: [...new Set([...(prev?.vendorIds ?? []), ...createdVendors])],
        importedAt: new Date().toISOString(),
      };
    },
    { timeout: TX_TIMEOUT_MS, maxWait: 30_000 },
  );
}

// ── rollback of what this tool imported ──
async function rollback(prisma: PrismaClient, idMap: IdMap): Promise<void> {
  const entries = Object.entries(idMap).filter(([ext]) => !ONLY || ext === ONLY);
  if (!entries.length) {
    console.log("id-map.json is empty: nothing to roll back.");
    return;
  }
  const eligible: Array<[string, IdMapEntry, boolean]> = [];
  for (const [ext, e] of entries) {
    const raffle = await prisma.raffle.findUnique({ where: { id: e.raffleId }, select: { id: true, title: true } });
    const foreign = raffle
      ? await prisma.sale.count({
          where: { raffleId: e.raffleId, NOT: { source: "import", receiptNumber: { startsWith: receiptPrefix(ext) } } },
        })
      : 0;
    console.log(
      `\n[${ext}] ${raffle?.title ?? "(raffle not found)"} id=${e.raffleId} mode=${e.mode} ` +
        `contacts created=${e.contactIds.length} vendors created=${e.vendorIds.length} sales made in rifacil=${foreign}`,
    );
    if (raffle && foreign && e.mode === "create") {
      console.log("   ✖ has sales made in rifacil after the import: NOT deleting the raffle. Resolve by hand.");
      continue;
    }
    if (foreign) console.log(`   🛡 ${foreign} sales made in rifacil stay; only this import's sales are removed`);
    eligible.push([ext, e, !!raffle]);
  }
  if (!CONFIRM) {
    console.log("\n(DRY-RUN) Nothing deleted. Add --expect-host <host> --confirm MIGRAR to roll back.");
    return;
  }
  if (!eligible.length) return;

  // One transaction for everything: raffles first, then the contacts/vendors
  // they created (a contact created by one raffle may be used by another).
  await prisma.$transaction(
    async (tx) => {
      const affectedContacts = new Set<string>();
      for (const [ext, e, exists] of eligible) {
        if (!exists) continue;
        const old = await tx.sale.findMany({
          where: { raffleId: e.raffleId, source: "import", receiptNumber: { startsWith: receiptPrefix(ext) } },
          select: { id: true, contactId: true },
        });
        for (const s of old) affectedContacts.add(s.contactId);
        if (e.mode === "create") {
          await tx.raffle.delete({ where: { id: e.raffleId } }); // numbers, sales, payments cascade
        } else {
          const ids = old.map((s) => s.id);
          await tx.raffleNumber.updateMany({
            where: { raffleId: e.raffleId, saleId: { in: ids } },
            data: { status: "AVAILABLE", contactId: null, saleId: null, vendorId: null, soldAt: null, paidAt: null, receiptNumber: null },
          });
          await tx.sale.deleteMany({ where: { id: { in: ids } } });
          await recomputeRaffleStats(tx, e.raffleId);
        }
      }
      // Contacts / vendors this import created, only if nothing else uses them now.
      const createdContacts = [...new Set(eligible.flatMap(([, e]) => e.contactIds))];
      const unused = await tx.contact.findMany({
        where: { id: { in: createdContacts }, sales: { none: {} }, numbers: { none: {} } },
        select: { id: true },
      });
      const unusedIds = new Set(unused.map((c) => c.id));
      await tx.contact.deleteMany({ where: { id: { in: [...unusedIds] } } });
      // Pre-existing contacts that lost imported sales: metrics back to their real sales.
      await recomputeContactMetrics(tx, [...affectedContacts, ...createdContacts].filter((id) => !unusedIds.has(id)));
      const createdVendors = [...new Set(eligible.flatMap(([, e]) => e.vendorIds))];
      const vendors = await tx.vendor.findMany({
        where: { id: { in: createdVendors }, sales: { none: {} }, numbers: { none: {} } },
        select: { id: true },
      });
      await tx.vendor.deleteMany({ where: { id: { in: vendors.map((v) => v.id) } } });
      console.log(
        `\n✔ rolled back ${eligible.length} raffle(s); contacts deleted ${unusedIds.size}/${createdContacts.length}, ` +
          `vendors deleted ${vendors.length}/${createdVendors.length} (the rest are used by other sales)`,
      );
    },
    { timeout: TX_TIMEOUT_MS, maxWait: 30_000 },
  );
  const m = loadIdMap();
  for (const [ext] of eligible) delete m[ext];
  saveIdMap(m);
}

// ── main ──
function printPlan(p: RafflePlan, pf: Preflight | null) {
  const s = p.stats;
  console.log(`\n━━ [${p.ext}] ${p.title}  →  ${pf ? pf.mode.toUpperCase() : "OFFLINE"}${pf?.raffleId ? ` (${pf.raffleId})` : ""}`);
  console.log(`   status=${p.status} drawDate=${p.drawDate?.toISOString().slice(0, 10) ?? "?"} price=$${p.pricePerNumber} numbers=${p.totalNumbers}`);
  console.log(`   board occupied=${s.boardOccupied}  planned occupied=${s.plannedOccupied}  (client sales=${s.clientSales}, board-only=${s.boardOnlySales})`);
  console.log(`   PAID=${s.byStatus.PAID} SOLD=${s.byStatus.SOLD} RESERVED=${s.byStatus.RESERVED}  revenue=$${s.expectedRevenue.toFixed(2)} debt=$${s.expectedDebt.toFixed(2)}`);
  console.log(`   revenue check: abonos as listed=$${s.ledgerRevenue.toFixed(2)}${s.appRevenue != null ? `  riffas.info app=$${s.appRevenue.toFixed(2)}` : ""}`);
  console.log(`   methods: ${Object.entries(s.methods).map(([k, v]) => `${k}=${v}`).join(", ") || "-"}`);
  if (pf) {
    console.log(`   target: ${pf.existing ? `"${pf.existing.title}" ${pf.existing.status} public=${pf.existing.isPublic}, ${pf.existingNumbers} numbers` : "new raffle"}; previous import sales to replace=${pf.importedSalesToReplace}`);
    console.log(`   contacts: reuse ${pf.contactsReused}, new ${pf.contactsNew} · vendors: reuse ${pf.vendorsReused}, new ${pf.vendorsNew}`);
    for (const ps of pf.protectedSales) {
      console.log(`   🛡  PROTECTED ${ps.receiptNumber} src=${ps.source ?? "null"} ${ps.contact} #${ps.numbers.join(",")} paid=$${ps.amountPaid}`);
    }
  }
  for (const w of p.warnings) console.log(`   ⚠  ${w}`);
  for (const b of [...p.blockers, ...(pf?.blockers ?? [])]) console.log(`   ✖  ${b}`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  console.log(`[host] ${OFFLINE ? "(offline, no DB)" : hostOf(url)}  |  mode: ${ROLLBACK ? "ROLLBACK " : ""}${CONFIRM ? "REAL (writes)" : "DRY-RUN (no writes)"}`);
  if (CONFIRM) assertExpectedHost(EXPECT_HOST, url);
  if (!OFFLINE && !url) throw new Error("DATABASE_URL is not set in this shell (use --offline to only plan)");

  const prisma = OFFLINE ? null : new PrismaClient();
  try {
    const idMap = loadIdMap();
    if (ROLLBACK) {
      if (!prisma) throw new Error("--rollback needs the database");
      await rollback(prisma, idMap);
      return;
    }

    const dump = JSON.parse(readFileSync(resolve(DUMP_DIR, "riffas-info-dump.json"), "utf8"));
    console.log(`[dump] ${DUMP_DIR} exportedAt=${dump.exportedAt ?? "?"}`);

    let target: { id: string; name: string | null; email: string | null } | null = null;
    if (prisma && USER_ID) {
      const u = await prisma.user.findUnique({ where: { id: USER_ID }, select: { id: true, name: true, email: true, businessOwnerId: true } });
      if (!u) throw new Error(`user ${USER_ID} does not exist in ${hostOf(url)}`);
      if (u.businessOwnerId) throw new Error(`user ${USER_ID} is a team member of ${u.businessOwnerId}: import into the business ROOT account`);
      target = u;
      console.log(`[user] ${u.name ?? "?"} <${u.email ?? "?"}> ${u.id}`);
    } else if (CONFIRM) {
      throw new Error("real run needs --user-id");
    }

    const now = new Date();
    const plans = (dump.raffles as any[])
      .map((r) => String(r.id))
      .filter((ext) => (ONLY ? ext === ONLY : !SKIP.has(ext)))
      .map((ext) => {
        const plan = planRaffle(dump, ext, {
          now,
          cashMethod: CASH_METHOD,
          normalizePhone: (raw) => normalizePhone(raw, "VE"),
          countryOf: (e164) => {
            const c = countryFromE164(e164);
            return c === "XX" ? null : c;
          },
        });
        if (FORCE_DRAWN.has(ext) && plan.status !== "DRAWN") {
          plan.status = "DRAWN";
          plan.warnings.push("forced DRAWN by --drawn (riffas.info's draw date is not in the past)");
        }
        return plan;
      });
    if (SKIP.size && !ONLY) console.log(`[skip] ${[...SKIP].join(", ")} (El Dubai = import-eldubai-v1.ts)`);

    const pfs = new Map<string, Preflight>();
    for (const p of plans) {
      const pf = prisma ? await preflight(prisma, p, target?.id ?? null, idMap) : null;
      if (pf) pfs.set(p.ext, pf);
      printPlan(p, pf);
    }

    const blocked = plans.filter((p) => p.blockers.length || (pfs.get(p.ext)?.blockers.length ?? 0));
    const reportPath = resolve(DUMP_DIR, `report-${CONFIRM ? "real" : "dryrun"}-${STAMP}.json`);
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          host: hostOf(url), mode: CONFIRM ? "real" : "dry-run", user: target,
          raffles: plans.map((p) => ({ ext: p.ext, title: p.title, status: p.status, stats: p.stats, warnings: p.warnings, blockers: p.blockers, preflight: pfs.get(p.ext) ?? null })),
        },
        null,
        2,
      ),
    );
    console.log(`\n📄 report: ${reportPath}`);
    console.log(blocked.length ? `✖ NOT READY: ${blocked.length} raffle(s) with blockers (${blocked.map((p) => p.ext).join(", ")})` : "✔ no blockers");

    if (!CONFIRM) {
      console.log("(DRY-RUN) Nothing was written.");
      if (blocked.length) process.exitCode = 2;
      return;
    }
    if (blocked.length) throw new Error("refusing to write while there are blockers");

    for (const p of plans) {
      const pf = pfs.get(p.ext)!;
      console.log(`\n⚙  importing [${p.ext}] ${p.title} (${pf.mode})…`);
      const entry = await importRaffle(prisma!, p, pf, target!.id);
      const m = loadIdMap();
      m[p.ext] = entry;
      saveIdMap(m); // right after the commit: a later failure never orphans this raffle
      const after = await countByStatus(prisma!, entry.raffleId);
      const occ = after.PAID + after.SOLD + after.RESERVED;
      const ok = occ === p.stats.plannedOccupied && after.PAID === p.stats.byStatus.PAID && after.RESERVED === p.stats.byStatus.RESERVED && after.SOLD === p.stats.byStatus.SOLD;
      console.log(`   ${ok ? "✔" : "✖ MISMATCH"} ${entry.raffleId}: PAID=${after.PAID} SOLD=${after.SOLD} RESERVED=${after.RESERVED} AVAILABLE=${after.AVAILABLE}`);
      if (!ok) throw new Error(`post-import counts differ from the plan for raffle ${p.ext}: stop and review (rollback available)`);
    }
    console.log("\n✅ import finished. id-map.json updated.");
  } finally {
    await prisma?.$disconnect();
  }
}

main().catch((e) => {
  console.error("❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
