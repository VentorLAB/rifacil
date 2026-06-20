import { z } from "zod";

// Forma de User.storefrontConfig (Json). Datos "de marketing" flexibles de la
// landing de marca (/d/[host]): tagline, stats, faqs, redes, contactos.
// Lo estructurado (marca, rifas, PaymentAccount) NO va acá: vive en columnas/modelos.
// Se valida con este schema al ESCRIBIR (seed/mutation) y se parsea al LEER.

export const storefrontStatSchema = z.object({
  value: z.number(),
  prefix: z.string().max(4).optional().default(""),
  suffix: z.string().max(4).optional().default(""),
  label: z.string().min(1).max(60),
});

export const storefrontFaqSchema = z.object({
  q: z.string().min(1).max(200),
  a: z.string().min(1).max(1000),
});

export const storefrontContactSchema = z.object({
  name: z.string().min(1).max(60),
  phone: z.string().min(7).max(20), // dígitos país+número sin +, para wa.me
});

export const storefrontConfigSchema = z.object({
  tagline: z.string().max(60).optional(),
  whatsappText: z.string().max(280).optional(),
  whatsapp: z.string().max(20).optional(), // número principal (wa.me)
  instagram: z.string().url().max(200).optional(),
  instagramHandle: z.string().max(60).optional(),
  email: z.string().email().max(120).optional(),
  location: z.string().max(80).optional(),
  nit: z.string().max(40).optional(),
  organizer: z.string().max(120).optional(),
  contacts: z.array(storefrontContactSchema).max(10).optional(),
  stats: z.array(storefrontStatSchema).max(6).optional(),
  faqs: z.array(storefrontFaqSchema).max(20).optional(),
});

export type StorefrontConfig = z.infer<typeof storefrontConfigSchema>;

// Parseo tolerante para LECTURA: si el JSON guardado no valida (datos viejos o
// corruptos), devolvemos null en vez de tumbar la landing.
export function parseStorefrontConfig(raw: unknown): StorefrontConfig | null {
  if (raw == null) return null;
  const parsed = storefrontConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
