/**
 * Pure logic for the build-time migration guard (scripts/check-migrations.ts).
 *
 * Behind the VPS bridge Vercel's build cannot run `prisma migrate deploy`:
 * the migrate engine needs a TCP connection and Postgres is not on the
 * internet. Migrations are applied by hand through an SSH tunnel instead, and
 * this guard keeps the old fail-safe: never ship code against an older schema.
 */

export interface AppliedMigrationRow {
  migration_name: string;
  finished_at: Date | string | null;
  rolled_back_at: Date | string | null;
}

export interface MigrationCheckResult {
  ok: boolean;
  /** In the repo but not applied in the database. */
  pending: string[];
  /** Started but never finished (and not rolled back): a broken migrate run. */
  failed: string[];
  /** Applied in the database but missing from the repo. Warning only, as in Prisma. */
  unknown: string[];
}

export function checkMigrations(
  localMigrations: string[],
  rows: AppliedMigrationRow[],
): MigrationCheckResult {
  const applied = new Set<string>();
  const failed = new Set<string>();
  for (const row of rows) {
    if (row.rolled_back_at) continue;
    if (row.finished_at) applied.add(row.migration_name);
    else failed.add(row.migration_name);
  }
  // A migration that failed and was later re-applied successfully is fine.
  for (const name of applied) failed.delete(name);

  const local = new Set(localMigrations);
  const pending = localMigrations.filter((m) => !applied.has(m)).sort();
  const unknown = [...applied].filter((m) => !local.has(m)).sort();
  const failedList = [...failed].sort();

  return {
    ok: pending.length === 0 && failedList.length === 0,
    pending,
    failed: failedList,
    unknown,
  };
}
