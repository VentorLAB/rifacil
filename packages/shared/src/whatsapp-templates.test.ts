// Tests de los helpers de plantillas WABA (lo de red es un wrapper delgado).
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  slugifyTemplateName,
  extractBodyVariables,
  buildTemplateComponents,
  templateStatusInfo,
  rejectedReasonLabel,
  uploadHeaderImage,
} from "./whatsapp-templates";

describe("slugifyTemplateName", () => {
  it("minúsculas, números y _ (regla de Meta)", () => {
    expect(slugifyTemplateName("Recibo Compra!")).toBe("recibo_compra");
    expect(slugifyTemplateName("  Pago Móvil VES  ")).toBe("pago_movil_ves");
    expect(slugifyTemplateName("Rifa Niño Jesús 2")).toBe("rifa_nino_jesus_2");
    expect(slugifyTemplateName("__raro--nombre__")).toBe("raro_nombre");
  });
});

describe("extractBodyVariables", () => {
  it("sin variables → []", () => {
    expect(extractBodyVariables("Hola, tu número es 0424")).toEqual([]);
  });
  it("secuencia desde 1 → la lista", () => {
    expect(extractBodyVariables("Hola {{1}}, tu rifa {{2}} vence {{3}}")).toEqual([1, 2, 3]);
  });
  it("repetida cuenta una vez", () => {
    expect(extractBodyVariables("{{1}} y otra vez {{1}}")).toEqual([1]);
  });
  it("huecos en la numeración → null (Meta la rechaza)", () => {
    expect(extractBodyVariables("Hola {{1}} y {{3}}")).toBeNull();
    expect(extractBodyVariables("Hola {{2}}")).toBeNull();
  });
});

describe("buildTemplateComponents", () => {
  it("solo cuerpo sin variables ni ejemplo", () => {
    const c = buildTemplateComponents({ name: "x", category: "UTILITY", language: "es", bodyText: "Hola" });
    expect(c).toEqual([{ type: "BODY", text: "Hola" }]);
  });
  it("con header, variables con ejemplo y footer", () => {
    const c = buildTemplateComponents({
      name: "x",
      category: "UTILITY",
      language: "es",
      headerText: "Tu recibo",
      bodyText: "Hola {{1}}, total {{2}}",
      footerText: "Gracias",
      exampleValues: ["María", "$10"],
    });
    expect(c).toEqual([
      { type: "HEADER", format: "TEXT", text: "Tu recibo" },
      { type: "BODY", text: "Hola {{1}}, total {{2}}", example: { body_text: [["María", "$10"]] } },
      { type: "FOOTER", text: "Gracias" },
    ]);
  });
  it("ejemplos faltantes se rellenan con ejemploN", () => {
    const c = buildTemplateComponents({
      name: "x", category: "UTILITY", language: "es", bodyText: "{{1}} y {{2}}",
    });
    expect((c[0] as any).example.body_text[0]).toEqual(["ejemplo1", "ejemplo2"]);
  });
});

describe("buildTemplateComponents con header de imagen", () => {
  it("IMAGE + handle → HEADER format IMAGE con example.header_handle", () => {
    const comps = buildTemplateComponents({
      name: "x",
      category: "MARKETING",
      language: "es",
      headerType: "IMAGE",
      headerHandle: "4::abc",
      bodyText: "Hola {{1}}",
      exampleValues: ["Carlos"],
    });
    expect(comps[0]).toEqual({ type: "HEADER", format: "IMAGE", example: { header_handle: ["4::abc"] } });
  });

  it("headerType IMAGE sin handle no agrega header (guard)", () => {
    const comps = buildTemplateComponents({
      name: "x", category: "MARKETING", language: "es", headerType: "IMAGE", bodyText: "Hola",
    });
    expect(comps.find((c) => c.type === "HEADER")).toBeUndefined();
  });

  it("headerType TEXT usa el texto como antes", () => {
    const comps = buildTemplateComponents({
      name: "x", category: "UTILITY", language: "es", headerType: "TEXT", headerText: "Tu recibo", bodyText: "Hola",
    });
    expect(comps[0]).toEqual({ type: "HEADER", format: "TEXT", text: "Tu recibo" });
  });
});

describe("uploadHeaderImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("flujo feliz: debug_token → sesión → bytes → handle", async () => {
    const calls: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, opts: any) => {
      calls.push({ url, opts });
      if (url.includes("debug_token")) return new Response(JSON.stringify({ data: { app_id: "123" } }), { status: 200 });
      if (url.includes("/123/uploads")) return new Response(JSON.stringify({ id: "upload:xyz" }), { status: 200 });
      return new Response(JSON.stringify({ h: "4::handle" }), { status: 200 });
    }));
    const r = await uploadHeaderImage(
      { provider: "CLOUD_API", apiToken: "tok", businessId: "waba" },
      { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg", fileName: "a.jpg" },
    );
    expect(r).toEqual({ ok: true, handle: "4::handle" });
    expect(calls[0].url).toContain("debug_token");
    expect(calls[1].url).toContain("/123/uploads?file_length=3&file_type=image%2Fjpeg");
    expect(calls[2].opts.headers.Authorization).toBe("OAuth tok");
    expect(calls[2].opts.headers.file_offset).toBe("0");
  });

  it("YCLOUD → error claro, sin llamadas", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const r = await uploadHeaderImage(
      { provider: "YCLOUD", apiToken: "tok" },
      { bytes: new Uint8Array([1]), contentType: "image/jpeg", fileName: "a.jpg" },
    );
    expect(r.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("Meta falla en la sesión → error propagado", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("debug_token")) return new Response(JSON.stringify({ data: { app_id: "123" } }), { status: 200 });
      return new Response(JSON.stringify({ error: { message: "_permiso denegado_" } }), { status: 403 });
    }));
    const r = await uploadHeaderImage(
      { provider: "CLOUD_API", apiToken: "tok" },
      { bytes: new Uint8Array([1]), contentType: "image/png", fileName: "a.png" },
    );
    expect(r).toEqual({ ok: false, error: "_permiso denegado_" });
  });
});

describe("templateStatusInfo / rejectedReasonLabel", () => {
  it("estados en español con tono", () => {
    expect(templateStatusInfo("APPROVED")).toEqual({ label: "Aprobada", tone: "ok" });
    expect(templateStatusInfo("PENDING")).toEqual({ label: "En revisión", tone: "warn" });
    expect(templateStatusInfo("REJECTED")).toEqual({ label: "Rechazada", tone: "bad" });
  });
  it("motivos conocidos en español; desconocidos pasan crudos", () => {
    expect(rejectedReasonLabel("INCORRECT_CATEGORY")).toContain("Categoría");
    expect(rejectedReasonLabel("OTRO_RARO")).toBe("OTRO_RARO");
  });
});
