import { describe, expect, it } from "vitest";
import { checkMigrations } from "./migrations-check";

const done = (name: string) => ({ migration_name: name, finished_at: new Date(), rolled_back_at: null });

describe("checkMigrations", () => {
  it("passes when every repo migration is applied", () => {
    const r = checkMigrations(["001_a", "002_b"], [done("001_a"), done("002_b")]);
    expect(r).toEqual({ ok: true, pending: [], failed: [], unknown: [] });
  });

  it("blocks when a repo migration is missing in the database", () => {
    const r = checkMigrations(["001_a", "002_b"], [done("001_a")]);
    expect(r.ok).toBe(false);
    expect(r.pending).toEqual(["002_b"]);
  });

  it("blocks on a migration that started but never finished", () => {
    const r = checkMigrations(["001_a"], [
      done("001_a"),
      { migration_name: "002_b", finished_at: null, rolled_back_at: null },
    ]);
    expect(r.ok).toBe(false);
    expect(r.failed).toEqual(["002_b"]);
  });

  it("ignores rolled-back attempts and accepts a later successful re-apply", () => {
    const r = checkMigrations(["001_a"], [
      { migration_name: "001_a", finished_at: null, rolled_back_at: new Date() },
      done("001_a"),
    ]);
    expect(r).toEqual({ ok: true, pending: [], failed: [], unknown: [] });
  });

  it("a rolled-back row alone does not count as applied", () => {
    const r = checkMigrations(["001_a"], [
      { migration_name: "001_a", finished_at: new Date(), rolled_back_at: new Date() },
    ]);
    expect(r.pending).toEqual(["001_a"]);
  });

  it("only warns about migrations applied in the DB but absent from the repo", () => {
    const r = checkMigrations(["001_a"], [done("001_a"), done("000_old")]);
    expect(r.ok).toBe(true);
    expect(r.unknown).toEqual(["000_old"]);
  });
});
