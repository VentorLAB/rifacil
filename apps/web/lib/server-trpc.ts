import "server-only";
import { appRouter } from "@riffas/api";
import { prisma } from "@riffas/db";

// Caller tRPC server-side para PROCEDURES PÚBLICOS (sin sesión).
// Úsalo en server components que necesitan datos públicos sin pasar por el
// cliente react-query. NO sirve para procedures protegidos (session = null).
// req/res no existen en un server component; los procedures públicos no los usan.
export function getPublicCaller() {
  return appRouter.createCaller({
    prisma,
    session: null,
    req: undefined as never,
    res: undefined as never,
  });
}
