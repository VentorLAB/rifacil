// Plantillas EDITABLES de los mensajes wa.me (canal manual/gratis, NO Meta).
//
// El rifero puede reescribir los textos del recibo wa.me desde Ajustes. Cada
// negocio guarda las suyas; si no ha editado nada, se usan los textos DEFAULT
// (los de siempre, formato riffas.info). Hay DOS plantillas: "apartado" (cubre
// apartado nuevo y abono registrado: toda venta no pagada completa) y "pagado".
//
// Modelo de plantilla: texto plano con variables {{nombre}}. Hay dos familias:
//   1. Variables SIMPLES: se sustituyen por su valor ({{nombre}}, {{numeros}}…).
//   2. Variables DE LÍNEA/BLOQUE (computadas): líneas o bloques enteros con
//      lógica de negocio (resumen según abono, línea de estado, bloque de
//      vista previa). Si no aplican (p.ej. rifa sin fecha de sorteo), quedan
//      vacías y la LÍNEA completa de la plantilla se omite.
// Regla de render: tras sustituir, una línea que contenía SOLO variables y
// quedó vacía se elimina; nunca quedan 2 líneas en blanco seguidas.
//
// Almacenamiento: JSON {"apartado": "...", "pagado": "..."} en la columna TEXT
// UserSettings.whatsappSaleTemplate (columna legada sin uso, pensada para esto;
// así no hace falta migración). Parse tolerante: contenido inválido → defaults.

export type WaTemplateKey = "apartado" | "pagado";

export interface WaMessageTemplates {
  apartado?: string;
  pagado?: string;
}

// Variables disponibles en el editor (documentadas para la UI). "example" se
// usa en la vista previa de Ajustes.
export const WA_TEMPLATE_VARIABLES: { key: string; label: string; example: string }[] = [
  { key: "saludo", label: 'Saludo con nombre ("¡Hola María! ") o vacío', example: "¡Hola María! " },
  { key: "resumen", label: "Resumen del pago (2 líneas, según abonos)", example: 'Has realizado abonos por un total de $10\npara la rifa "Toyota Agya" 💎' },
  { key: "numeros", label: "Números de la venta", example: "045, 102" },
  { key: "lineaValorRifa", label: "Línea 💎 Valor de la rifa (o vacía)", example: "💎 Valor de la rifa: $10" },
  { key: "lineaEstado", label: "Línea de estado/deuda/abonado", example: "💎 Deuda actual: $10" },
  { key: "lineaFechaSorteo", label: "Línea 💎 Fecha del sorteo (o vacía)", example: "💎 Fecha del sorteo: 20 dic 2026, 19:00" },
  { key: "lineaReservado", label: "Línea 💎 Reservado (o vacía)", example: "💎 Reservado: 13 oct 2026, 19:24" },
  { key: "lineaCuandoCompletes", label: 'Línea "Cuando completes el pago…" (o vacía)', example: "Cuando completes el pago confirmamos tu apartado. 🤝" },
  { key: "bloqueVistaPrevia", label: "Bloque completo vista previa del recibo", example: "\n💎 Vista previa del recibo:\nhttps://ejemplo.com/recibo.jpg" },
  { key: "bloqueCtaRifas", label: "Bloque completo 'mira nuestras rifas'", example: "\n🎉 Mira todas nuestras rifas:\nhttps://tumarca.com" },
  { key: "marca", label: "Nombre del negocio", example: "Rifas Hermanos" },
  { key: "nombre", label: "Nombre del cliente", example: "María" },
  { key: "rifa", label: "Título de la rifa", example: "Toyota Agya 2026" },
  { key: "total", label: "Total de la venta", example: "$20" },
  { key: "abonado", label: "Total abonado", example: "$10" },
  { key: "deuda", label: "Deuda restante", example: "$10" },
  { key: "valorRifa", label: "Precio por número", example: "$10" },
  { key: "fechaSorteo", label: "Fecha del sorteo (hora VZLA)", example: "20 dic 2026, 19:00" },
  { key: "reservado", label: "Fecha del apartado (hora VZLA)", example: "13 oct 2026, 19:24" },
];

// Textos DEFAULT = exactamente lo que arma hoy buildReceiptMessage (formato
// riffas.info). El editor los muestra como punto de partida.
export const DEFAULT_WA_TEMPLATES: Record<WaTemplateKey, string> = {
  apartado: `{{saludo}}Tu apartado quedó registrado. 🍀

{{resumen}}
Números reservados: *{{numeros}}*
{{lineaValorRifa}}
{{lineaEstado}}
{{lineaFechaSorteo}}
{{lineaReservado}}
{{lineaCuandoCompletes}}
{{bloqueVistaPrevia}}
{{bloqueCtaRifas}}

🏆 Todo juega hasta tener ganador.
— {{marca}}`,
  pagado: `{{saludo}}Tu compra quedó registrada. 🎉

{{resumen}}
Números: *{{numeros}}*
{{lineaValorRifa}}
{{lineaEstado}}
{{lineaFechaSorteo}}
{{lineaReservado}}
{{bloqueVistaPrevia}}
{{bloqueCtaRifas}}

🏆 Todo juega hasta tener ganador.
— {{marca}}`,
};

const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Renderiza una plantilla con sus variables:
 *  - sustituye {{var}} por su valor (variables desconocidas se quedan escritas,
 *    para que el rifero note el typo en la vista previa);
 *  - una línea que solo tenía variables y quedó vacía se elimina;
 *  - colapsa 2+ líneas en blanco en una y recorta bordes.
 */
export function renderWaTemplate(template: string, vars: Record<string, string>): string {
  const substituted = template.split("\n").map((line) => {
    const hadVar = line.includes("{{");
    const out = line.replace(VAR_RE, (m, key: string) =>
      Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : m
    );
    // Línea de SOLO variable(s) que quedó vacía → se omite (regla de línea).
    if (hadVar && out.trim() === "") return null;
    return out;
  });
  // Colapsar blancos consecutivos (una variable de bloque puede traer \n inicial).
  const out: string[] = [];
  for (const line of substituted) {
    if (line === null) continue;
    for (const sub of line.split("\n")) {
      if (sub.trim() === "" && (out.length === 0 || out[out.length - 1].trim() === "")) continue;
      out.push(sub);
    }
  }
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  return out.join("\n");
}

/** Parse tolerante del JSON guardado en whatsappSaleTemplate. Inválido → {}. */
export function parseWaMessageTemplates(raw: string | null | undefined): WaMessageTemplates {
  if (!raw) return {};
  try {
    const j = JSON.parse(raw);
    const out: WaMessageTemplates = {};
    if (typeof j?.apartado === "string" && j.apartado.trim()) out.apartado = j.apartado;
    if (typeof j?.pagado === "string" && j.pagado.trim()) out.pagado = j.pagado;
    return out;
  } catch {
    return {};
  }
}

/** Serializa para guardar; sin claves → null (volver a defaults). */
export function serializeWaMessageTemplates(t: WaMessageTemplates): string | null {
  const clean: WaMessageTemplates = {};
  if (t.apartado?.trim()) clean.apartado = t.apartado;
  if (t.pagado?.trim()) clean.pagado = t.pagado;
  return clean.apartado || clean.pagado ? JSON.stringify(clean) : null;
}
