import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { type NextRequest } from "next/server";
import { appRouter } from "@riffas/api";
import { createTRPCContext } from "@riffas/api/src/trpc";

// El recibo usa @resvg/resvg-js (binario nativo) → runtime Node, NUNCA edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Render del recibo (satori → png) + upload a Cloudinary puede tardar unos segundos.
export const maxDuration = 30;

const handler = (req: NextRequest) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTRPCContext({ req } as any),
  });

export { handler as GET, handler as POST };
