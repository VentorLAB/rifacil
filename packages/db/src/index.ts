import { PrismaClient } from "./generated";
import { createPrismaClient } from "./create-client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export { createPrismaClient };
export * from "./generated";
