import { PrismaClient } from "./generated";
import { createBridgePool } from "./bridge";

/**
 * Builds the Prisma client, with or without the VPS bridge (see ./bridge.ts).
 *
 * WITHOUT `DB_WS_PROXY` nothing changes: the usual client with the usual
 * native engine and TCP connection (Neon, local Postgres, SSH tunnel...).
 */
export function createPrismaClient(env: NodeJS.ProcessEnv = process.env): PrismaClient {
  const proxy = env.DB_WS_PROXY?.trim();
  if (!proxy) return new PrismaClient();

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaNeon }: typeof import("@prisma/adapter-neon") = require("@prisma/adapter-neon");
  const pool = createBridgePool(proxy, env.DATABASE_URL ?? "");
  return new PrismaClient({ adapter: new PrismaNeon(pool) });
}
