import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import {
  listTemplates,
  createTemplate,
  uploadHeaderImage,
  slugifyTemplateName,
  type TemplateCreds,
  type WhatsappTemplateProvider,
} from "@riffas/shared";

// Gestión de plantillas de la WABA (listar/crear/motivo de rechazo). SOLO
// gestión: el envío de mensajes sigue por los caminos de siempre (wa.me +
// recibo_compra). Las credenciales salen de userSettings del tenant (regla #6).
async function templateCreds(prisma: any, businessId: string): Promise<TemplateCreds> {
  const cfg = await prisma.userSettings.findUnique({
    where: { userId: businessId },
    select: {
      whatsappConnected: true,
      whatsappProvider: true,
      whatsappApiToken: true,
      whatsappBusinessId: true,
    },
  });
  if (!cfg?.whatsappConnected || !cfg.whatsappApiToken || !cfg.whatsappProvider || cfg.whatsappProvider === "NONE") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Conecta tu WhatsApp API en Ajustes → WhatsApp para gestionar plantillas.",
    });
  }
  if (cfg.whatsappProvider === "CLOUD_API" && !cfg.whatsappBusinessId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Falta el WABA ID (Business Account ID) en Ajustes → WhatsApp.",
    });
  }
  return {
    provider: cfg.whatsappProvider as WhatsappTemplateProvider,
    apiToken: cfg.whatsappApiToken,
    businessId: cfg.whatsappBusinessId,
  };
}

export const whatsappTemplateRouter = createTRPCRouter({
  // Lista las plantillas de la WABA con estado y motivo de rechazo.
  list: protectedProcedure.query(async ({ ctx }) => {
    const creds = await templateCreds(ctx.prisma, ctx.businessId);
    return listTemplates(creds);
  }),

  // Crea una plantilla y la envía a revisión de Meta. NO la aprueba: Meta tarda
  // de minutos a horas; el estado se ve en la lista.
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(2).max(100),
        category: z.enum(["UTILITY", "MARKETING"]),
        language: z.string().min(2).max(10).default("es"),
        headerType: z.enum(["NONE", "TEXT", "IMAGE"]).default("NONE"),
        headerText: z.string().max(60).optional(),
        // Imagen de muestra del encabezado (base64, máx. 5 MB) que Meta exige.
        headerImageBase64: z.string().max(7_000_000).optional(),
        headerImageType: z.string().max(50).optional(),
        bodyText: z.string().min(1).max(1024),
        footerText: z.string().max(60).optional(),
        exampleValues: z.array(z.string().max(100)).max(20).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const creds = await templateCreds(ctx.prisma, ctx.businessId);
      const name = slugifyTemplateName(input.name);
      if (!name) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "El nombre debe tener letras o números." });
      }

      // Encabezado de IMAGEN: subir primero la muestra a Meta (Resumable
      // Upload API) y pasar su handle en el ejemplo del HEADER.
      let headerHandle: string | undefined;
      if (input.headerType === "IMAGE") {
        if (!input.headerImageBase64) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Sube la imagen de muestra del encabezado." });
        }
        const contentType = /^image\/(jpeg|png)$/.test(input.headerImageType ?? "")
          ? input.headerImageType!
          : "image/jpeg";
        const bytes = Buffer.from(input.headerImageBase64, "base64");
        if (bytes.length > 5 * 1024 * 1024) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "La imagen no puede pasar de 5 MB." });
        }
        const up = await uploadHeaderImage(creds, { bytes, contentType, fileName: "encabezado.jpg" });
        if (!up.ok || !up.handle) {
          throw new TRPCError({ code: "BAD_REQUEST", message: up.error ?? "Meta rechazó la imagen" });
        }
        headerHandle = up.handle;
      }

      const result = await createTemplate(creds, { ...input, name, headerHandle });
      if (!result.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.error ?? "Meta rechazó la creación" });
      }
      return result;
    }),
});
