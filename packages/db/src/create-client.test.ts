import { beforeEach, describe, expect, it, vi } from "vitest";

const constructed: unknown[][] = [];
vi.mock("./generated", () => ({
  PrismaClient: class {
    constructor(...args: unknown[]) {
      constructed.push(args);
    }
  },
}));

import { createPrismaClient } from "./create-client";

const URL = "postgresql://rifacil_service:secret@pg-apps:5432/rifacil";

describe("createPrismaClient", () => {
  beforeEach(() => {
    constructed.length = 0;
  });

  it("without DB_WS_PROXY builds the plain client (native engine, no options)", () => {
    createPrismaClient({ DATABASE_URL: URL } as NodeJS.ProcessEnv);
    expect(constructed).toEqual([[]]);
  });

  it("treats a blank DB_WS_PROXY as unset", () => {
    createPrismaClient({ DATABASE_URL: URL, DB_WS_PROXY: "   " } as NodeJS.ProcessEnv);
    expect(constructed).toEqual([[]]);
  });

  it("with DB_WS_PROXY passes the Neon driver adapter", async () => {
    createPrismaClient({ DATABASE_URL: URL, DB_WS_PROXY: "api.example.com/abc123/v1" } as NodeJS.ProcessEnv);
    expect(constructed).toHaveLength(1);
    const [options] = constructed[0] as [{ adapter: { provider: string; adapterName: string; close: () => Promise<unknown> } }];
    expect(options.adapter.provider).toBe("postgres");
    expect(options.adapter.adapterName).toMatch(/neon/);
    await options.adapter.close();
  });

  it("with DB_WS_PROXY but no DATABASE_URL fails loudly instead of connecting nowhere", () => {
    expect(() =>
      createPrismaClient({ DB_WS_PROXY: "api.example.com/abc123/v1" } as NodeJS.ProcessEnv),
    ).toThrow(/DATABASE_URL/);
  });
});
