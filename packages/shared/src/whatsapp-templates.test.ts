// Tests de los helpers de plantillas WABA (lo de red es un wrapper delgado).
import { describe, it, expect } from "vitest";
import {
  slugifyTemplateName,
  extractBodyVariables,
  buildTemplateComponents,
  templateStatusInfo,
  rejectedReasonLabel,
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
