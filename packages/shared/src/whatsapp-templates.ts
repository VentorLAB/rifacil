// Gestión de plantillas de la WABA (WhatsApp Business Account) desde rifacil:
// listar con estado, crear nuevas (quedan en revisión de Meta) y mostrar el
// motivo de rechazo. SOLO gestión: el envío de mensajes no cambia.
//
// Meta Cloud API: message_templates es un edge de la WABA (no del número), por
// eso se necesita el whatsappBusinessId (WABA ID) además del Phone Number ID.
// YCloud (BSP): su API propia lista/crea plantillas con la X-API-Key.
//
// JS puro (fetch), sin binarios nativos: seguro de importar en el top-level.

export type WhatsappTemplateProvider = "CLOUD_API" | "YCLOUD";

export interface TemplateCreds {
  provider: WhatsappTemplateProvider;
  apiToken: string;
  /** WABA / Business Account ID (obligatorio para CLOUD_API). */
  businessId?: string | null;
}

export interface TemplateSummary {
  name: string;
  category: string;
  language: string;
  /** APPROVED | PENDING | REJECTED | PAUSED | ... (crudo del proveedor). */
  status: string;
  /** Motivo de rechazo de Meta (código crudo), si aplica. */
  rejectedReason?: string | null;
  /** Texto del encabezado y del cuerpo, si la plantilla los trae. */
  headerText?: string | null;
  bodyText?: string | null;
}

export interface CreateTemplateInput {
  /** Solo minúsculas, números y guion bajo (regla de Meta). */
  name: string;
  category: "UTILITY" | "MARKETING";
  /** Código de idioma de Meta ("es", "es_LA", "en_US", ...). */
  language: string;
  /** Encabezado de texto, opcional (máx. 60, sin variables). */
  headerText?: string;
  /** Cuerpo con variables {{1}}, {{2}}... (máx. 1024). */
  bodyText: string;
  /** Pie, opcional (máx. 60, sin variables). */
  footerText?: string;
  /** Valores de ejemplo para las variables del cuerpo, en orden. */
  exampleValues?: string[];
}

export interface TemplateResult {
  ok: boolean;
  name?: string;
  status?: string;
  error?: string;
}

const GRAPH_VERSION = "v21.0";

// ── Helpers puros (testeables) ──

/** Meta exige: minúsculas, números y _ únicamente. */
export function slugifyTemplateName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // tildes/acentos (NFD los separa)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_")
    .slice(0, 512);
}

/**
 * Variables del cuerpo EN ORDEN de aparición. Meta las exige numeradas en
 * secuencia desde 1 sin huecos; devuelve null si la numeración es inválida.
 */
export function extractBodyVariables(body: string): number[] | null {
  const found = [...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  const unique = [...new Set(found)].sort((a, b) => a - b);
  if (!unique.length) return [];
  for (let i = 0; i < unique.length; i++) if (unique[i] !== i + 1) return null;
  return unique;
}

/** Arma el array `components` del payload de Meta/YCloud. */
export function buildTemplateComponents(input: CreateTemplateInput): Array<Record<string, unknown>> {
  const components: Array<Record<string, unknown>> = [];
  if (input.headerText?.trim()) {
    components.push({ type: "HEADER", format: "TEXT", text: input.headerText.trim() });
  }
  const vars = extractBodyVariables(input.bodyText);
  const body: Record<string, unknown> = { type: "BODY", text: input.bodyText.trim() };
  if (vars && vars.length > 0) {
    body.example = { body_text: [vars.map((_, i) => input.exampleValues?.[i] ?? `ejemplo${i + 1}`)] };
  }
  components.push(body);
  if (input.footerText?.trim()) {
    components.push({ type: "FOOTER", text: input.footerText.trim() });
  }
  return components;
}

/** Estado crudo → etiqueta y tono para la tabla. */
export function templateStatusInfo(status: string): { label: string; tone: "ok" | "warn" | "bad" | "muted" } {
  switch (status) {
    case "APPROVED":
      return { label: "Aprobada", tone: "ok" };
    case "PENDING":
    case "IN_APPEAL":
      return { label: "En revisión", tone: "warn" };
    case "REJECTED":
      return { label: "Rechazada", tone: "bad" };
    case "PAUSED":
      return { label: "Pausada", tone: "warn" };
    case "DISABLED":
      return { label: "Deshabilitada", tone: "muted" };
    default:
      return { label: status, tone: "muted" };
  }
}

/** Motivos de rechazo conocidos de Meta → español; lo desconocido pasa crudo. */
export function rejectedReasonLabel(code: string): string {
  const map: Record<string, string> = {
    ABUSIVE_CONTENT: "Contenido abusivo o no permitido",
    INCORRECT_CATEGORY: "Categoría incorrecta (Meta la reclasificó)",
    INVALID_FORMAT: "Formato inválido (variables, largo o caracteres)",
    PROMOTIONAL: "Contenido promocional en plantilla de utilidad",
    TAG_CONTENT_MISMATCH: "El contenido no coincide con la categoría",
    SCAM: "Posible fraude o engaño",
    NONE: "Sin motivo especificado",
  };
  return map[code] ?? code;
}

// ── API ──

interface RawTemplate {
  name?: string;
  category?: string;
  language?: string;
  status?: string;
  rejected_reason?: string;
  components?: Array<{ type?: string; format?: string; text?: string }>;
}

function toSummary(t: RawTemplate): TemplateSummary {
  const comp = (type: string) => t.components?.find((c) => c.type === type)?.text ?? null;
  return {
    name: t.name ?? "?",
    category: t.category ?? "?",
    language: t.language ?? "?",
    status: t.status ?? "?",
    rejectedReason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
    headerText: comp("HEADER"),
    bodyText: comp("BODY"),
  };
}

async function graphGet(creds: TemplateCreds, path: string): Promise<any> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
    headers: { Authorization: `Bearer ${creds.apiToken}` },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
  return json;
}

async function graphPost(creds: TemplateCreds, path: string, body: unknown): Promise<any> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
  return json;
}

/** Lista las plantillas de la WABA con estado y motivo de rechazo. */
export async function listTemplates(creds: TemplateCreds): Promise<TemplateSummary[]> {
  if (creds.provider === "CLOUD_API") {
    if (!creds.businessId) throw new Error("Falta el WABA ID (whatsappBusinessId) en Ajustes → WhatsApp");
    const json = await graphGet(
      creds,
      `${creds.businessId}/message_templates?fields=name,category,language,status,components,rejected_reason&limit=100`
    );
    return (json?.data ?? []).map(toSummary);
  }
  // YCloud (BSP): lista propia; la API key alcanza.
  const res = await fetch("https://api.ycloud.com/v2/whatsapp/templates?limit=100", {
    headers: { "X-API-Key": creds.apiToken },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
  return (json?.items ?? []).map((t: any) =>
    toSummary({
      name: t.name,
      category: t.category,
      language: t.language,
      status: t.status,
      rejected_reason: t.rejectedReason ?? t.rejected_reason,
      components: t.components,
    })
  );
}

/** Crea una plantilla (queda EN REVISIÓN de Meta; no la aprueba). */
export async function createTemplate(creds: TemplateCreds, input: CreateTemplateInput): Promise<TemplateResult> {
  const vars = extractBodyVariables(input.bodyText);
  if (vars === null) {
    return { ok: false, error: "Las variables del cuerpo deben ser {{1}}, {{2}}... en secuencia, sin saltos" };
  }
  const payload = {
    name: input.name,
    category: input.category,
    language: input.language,
    components: buildTemplateComponents(input),
  };
  try {
    if (creds.provider === "CLOUD_API") {
      if (!creds.businessId) throw new Error("Falta el WABA ID (whatsappBusinessId) en Ajustes → WhatsApp");
      const json = await graphPost(creds, `${creds.businessId}/message_templates`, payload);
      return { ok: true, name: input.name, status: json?.status ?? "PENDING" };
    }
    const res = await fetch("https://api.ycloud.com/v2/whatsapp/templates", {
      method: "POST",
      headers: { "X-API-Key": creds.apiToken, "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, wabaId: creds.businessId ?? undefined }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json?.message || `HTTP ${res.status}` };
    return { ok: true, name: input.name, status: json?.status ?? "PENDING" };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
