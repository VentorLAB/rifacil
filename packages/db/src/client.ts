import { createPrismaClient } from "./create-client";

// Cliente extendido con lógica de negocio
export const createExtendedClient = () => {
  return createPrismaClient().$extends({
    model: {
      raffle: {
        async getAvailableNumbers(this: any, raffleId: string) {
          const numbers = await this.findUnique({
            where: { id: raffleId },
            include: { numbers: true },
          });
          return numbers?.numbers.filter((n: any) => n.status === "AVAILABLE") || [];
        },
        async getStats(this: any, raffleId: string) {
          const stats = await this.findUnique({
            where: { id: raffleId },
            include: {
              numbers: {
                select: { status: true },
              },
              _count: { select: { numbers: true } },
            },
          });

          const sold = stats?.numbers.filter((n: any) => n.status === "SOLD").length || 0;
          const reserved = stats?.numbers.filter((n: any) => n.status === "RESERVED").length || 0;
          const available = stats?.numbers.filter((n: any) => n.status === "AVAILABLE").length || 0;

          return {
            total: stats?._count.numbers || 0,
            sold,
            reserved,
            available,
            soldPercentage: stats?._count.numbers ? (sold / stats._count.numbers) * 100 : 0,
          };
        },
      },
      contact: {
        async getTotalSpent(this: any, contactId: string) {
          const result = await this.findUnique({
            where: { id: contactId },
            include: {
              sales: {
                where: { status: "PAID" },
                select: { finalAmount: true },
              },
            },
          });
          return result?.sales.reduce((sum: number, s: any) => sum + Number(s.finalAmount), 0) || 0;
        },
      },
    },
  });
};

export type ExtendedPrismaClient = ReturnType<typeof createExtendedClient>;
