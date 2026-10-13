/**
 * Build-time guard used by scripts/vercel-build.mjs when the database is behind
 * the VPS bridge (DB_WS_PROXY set). Exits 1 if the production database lacks a
 * migration that exists in the repo, which blocks the deploy.
 *
 * Read-only: one SELECT on _prisma_migrations. It never applies anything; to
 * apply, follow docs/MIGRACION-NEON-A-VPS.md ("Migraciones después del corte").
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createBridgePool } from "../src/bridge";
import { checkMigrations, type AppliedMigrationRow } from "../src/migrations-check";

async function main(): Promise<number> {
  const proxy = process.env.DB_WS_PROXY?.trim();
  if (!proxy) {
    console.error("[check-migrations] DB_WS_PROXY is not set; nothing to check through the bridge.");
    return 1;
  }

  const dir = resolve(__dirname, "../prisma/migrations");
  const local = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "migration.sql")))
    .map((d) => d.name);

  const pool = createBridgePool(proxy, process.env.DATABASE_URL ?? "");
  try {
    const { rows } = await pool.query<AppliedMigrationRow>(
      "SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations",
    );
    const result = checkMigrations(local, rows);

    console.log(
      `[check-migrations] ${local.length} migrations in repo, ${rows.length} rows in _prisma_migrations`,
    );
    if (result.unknown.length) {
      console.warn("[check-migrations] applied in DB but not in repo:", result.unknown.join(", "));
    }
    if (result.failed.length) {
      console.error("[check-migrations] FAILED migrations in DB:", result.failed.join(", "));
    }
    if (result.pending.length) {
      console.error("[check-migrations] PENDING migrations:", result.pending.join(", "));
    }
    if (!result.ok) {
      console.error(
        "[check-migrations] Deploy blocked: apply them on the VPS first " +
          "(docs/MIGRACION-NEON-A-VPS.md, 'Migraciones después del corte').",
      );
      return 1;
    }
    console.log("[check-migrations] schema is up to date.");
    return 0;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

// The WebSocket layer rejects with an ErrorEvent (not an Error), whose useful
// part is `.error` / `.message`; print something readable either way.
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  const e = err as { message?: unknown; error?: { message?: unknown }; type?: unknown };
  return String(e?.error?.message ?? e?.message ?? e?.type ?? err);
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error("[check-migrations] could not check migrations:", describeError(err));
    process.exit(1);
  },
);
