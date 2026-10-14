import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { v2 as cloudinary } from "cloudinary";
import { COURIER_PRIME_REGULAR_TTF_BASE64, COURIER_PRIME_BOLD_TTF_BASE64 } from "./courier-prime-font";
import { RECEIPT_CARD_TRANSFORM } from "./receipt-card";

/**
 * Generación de recibos DEL LADO DEL SERVIDOR.
 *
 * Por qué existe: la v1 usaba html2canvas + canvas.toDataURL() en el navegador,
 * que se ROMPE en iOS Safari (límites de memoria de canvas). Ese es el bug de
 * "no genera recibos/números en iPhone". Aquí el recibo se dibuja en el servidor
 * (Satori -> SVG -> PNG con resvg) y se sube a Cloudinary FIRMADO. El iPhone solo
 * recibe una imagen ya hecha: imposible que falle por el navegador.
 *
 * Diseño: BOLETO minimalista y compacto — tarjeta blanca legible, borde troquelado
 * (perforación + muescas), encabezado de marca (color del rifero), chip de estado
 * grande y claro, números en dorado, datos y montos ordenados, una línea persuasiva
 * y pie de confianza. Data-driven: usa brandColor/brandName/brandLogo del rifero.
 */

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Neutros del boleto (el color de MARCA sale de input.brandColor, por rifero).
const C = {
  frame: "#E6E7EB", // marco suave (y color de las muescas del troquel)
  card: "#FFFFFF",
  ink: "#12141A", // texto principal
  sub: "#5B6472", // etiquetas / secundario
  faint: "#99A1AD", // terciario
  dash: "#C7CCD4", // línea de perforación
  gold: "#F4B400",
  goldInk: "#5A4200", // texto sobre dorado
  goldEdge: "#E0A400",
  green: "#0F9D58",
  amber: "#B4791A",
  moneyBg: "#F5F6F8",
  footer: "#0F1115",
};

// Texto legible (negro/blanco) sobre un color de marca arbitrario (YIQ).
function readableOn(hex?: string | null): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const yiq = ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
  return yiq >= 150 ? "#12141A" : "#ffffff";
}

// --- Fuentes para Satori (se cachean entre invocaciones del worker) ---
// Courier Prime (regular + bold) EMBEBIDA en base64 (./courier-prime-font). No
// se lee del filesystem a propósito: en serverless (Vercel) este paquete se
// transpila/bundlea y import.meta.url/__dirname no apuntan al archivo en disco
// — un readFileSync crashearía en prod. Embebida = cero filesystem y cero red.
// Courier Prime = el look "máquina de escribir" de la referencia (riffas.info),
// con trazo GRUESO que se lee hasta en la miniatura de WhatsApp.
let fontCache: { regular: Buffer; bold: Buffer } | null = null;
function getFonts(): { regular: Buffer; bold: Buffer } {
  if (fontCache) return fontCache;
  fontCache = {
    regular: Buffer.from(COURIER_PRIME_REGULAR_TTF_BASE64, "base64"),
    bold: Buffer.from(COURIER_PRIME_BOLD_TTF_BASE64, "base64"),
  };
  return fontCache;
}

// Helper para construir el árbol sin JSX (shared no tiene React/JSX configurado).
function el(type: string, style: Record<string, any>, children?: any): any {
  return { type, props: { style, children } };
}
function img(src: string, style: Record<string, any>): any {
  return { type: "img", props: { src, style } };
}

const money = (v: unknown) => {
  const n = Number(v ?? 0);
  return `$${(Number.isFinite(n) ? n : 0).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
};

const MONTHS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
const MONTHS_LONG = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

// "11 JUL 2026, 10:10 PM" (fecha del sorteo). SIEMPRE en hora de Caracas: el
// servidor (Vercel) corre en UTC y sin timeZone el sorteo salía 4h corrido
// (hasta un día después) en el recibo. La base es ~80% Venezuela.
const VE_TZ = "America/Caracas";
function fmtDraw(d?: Date | string | null): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("es-VE", {
    timeZone: VE_TZ,
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(d));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return cleanSpaces(`${get("day")} ${MONTHS[Number(get("month")) - 1]} ${get("year")}, ${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`);
}

// "3 de octubre de 2026, 22:10" — formato LARGO de la fecha del sorteo, como el
// encabezado de la referencia (riffas.info). 24h, hora de Caracas.
function fmtDrawLong(d?: Date | string | null): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("es-VE", {
    timeZone: VE_TZ,
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(d));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return cleanSpaces(`${get("day")} de ${MONTHS_LONG[Number(get("month")) - 1]} de ${get("year")}, ${get("hour")}:${get("minute")}`);
}

// El CLDR es-VE mete U+202F (narrow no-break space) dentro del dayPeriod
// ("p.\u202Fm.") y a veces U+00A0: la Inter embebida NO tiene esos glifos y
// resvg dibuja un TOFU (▯) en "Sorteo ... 10:18 P.▯M.". Normalizamos a espacio
// normal en TODA fecha que va al recibo.
const cleanSpaces = (s: string) => s.replace(/[\u00A0\u202F]/g, " ").replace(/\s{2,}/g, " ").trim();

// Fecha de reserva/compra (corta, es-VE, 24h como la referencia riffas.info:
// "5 sept 2026, 14:54"). 24h a propósito: elimina el dayPeriod ("p. m.") y su
// U+202F de raíz.
function fmtReserva(d?: Date | string | null): string {
  if (!d) return "";
  return cleanSpaces(new Date(d).toLocaleString("es-VE", {
    timeZone: VE_TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }));
}

// --- Imágenes: Satori NO baja URLs remotas de forma confiable; las traemos y
// las embebemos como data-URI. Falla suave: si una imagen no carga, se omite y
// el recibo igual se renderiza. ---
async function fetchDataUri(url?: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get("content-type") || "image/png";
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// --- Emojis: Satori sin cargador de emojis los dibuja vacíos. Resolvemos cada
// grafema con un SVG de Twemoji (cacheado entre invocaciones). Falla suave. ---
const emojiCache = new Map<string, string>();
function emojiCodePoint(str: string): string {
  const out: string[] = [];
  let prev = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (prev) {
      out.push((0x10000 + ((prev - 0xd800) << 10) + (c - 0xdc00)).toString(16));
      prev = 0;
    } else if (c >= 0xd800 && c <= 0xdbff) {
      prev = c;
    } else {
      out.push(c.toString(16));
    }
  }
  return out.join("-");
}
async function loadEmoji(segment: string): Promise<string> {
  const cp = emojiCodePoint(segment.replace(/️/g, ""));
  if (emojiCache.has(cp)) return emojiCache.get(cp)!;
  try {
    const res = await fetch(
      `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${cp}.svg`
    );
    if (!res.ok) {
      emojiCache.set(cp, "");
      return "";
    }
    const svg = await res.text();
    const uri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    emojiCache.set(cp, uri);
    return uri;
  } catch {
    return "";
  }
}

export interface GenerateReceiptInput {
  sale: {
    receiptNumber: string;
    numbers: string[];
    totalNumbers: number;
    totalAmount?: unknown;
    finalAmount: unknown;
    amountPaid?: unknown; // monto realmente abonado (suma de Payments CONFIRMED)
    rateUsed?: unknown; // VES por USD al momento de la venta (para equivalente en Bs)
    paymentMethod?: string | null;
    paidAt?: Date | string | null;
    createdAt?: Date | string | null;
  };
  raffle: {
    title: string;
    lottery?: string | null;
    drawDate?: Date | string | null;
    prizes?: { titulo: string }[] | null;
    prize?: string | null; // texto del premio (respaldo si no hay prizes[])
    prizeTagline?: string | null; // copy del subtítulo (override de marketing)
    bannerUrl?: string | null; // (ya no se usa en el boleto minimalista)
    totalNumbers?: number | null;
    remaining?: number | null;
    pricePerNumber?: number | null;
    discountPackages?: { qty: number; discountPercent: number }[] | null;
  };
  contact: { name: string; phone: string; city?: string | null };
  brandName?: string | null;
  brandLogo?: string | null;
  brandColor?: string | null;
  brandInstagram?: string | null;
  brandWebsite?: string | null;
}

// Render puro (sin Cloudinary): árbol Satori -> SVG. Separado de la subida
// para poder probar el layout localmente sin credenciales de Cloudinary.
export async function renderReceiptSvg(input: GenerateReceiptInput): Promise<string> {
  const { sale, raffle, contact } = input;
  const brandName = (input.brandName || "").trim() || "Tu rifa";

  // Montos: total a cobrar vs. lo efectivamente abonado. La deuda es el resto.
  // num() neutraliza NaN (un monto no numérico jamás debe salir como "$NaN").
  const num = (v: unknown) => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  const totalValue = num(sale.totalAmount ?? sale.finalAmount);
  const paidValue = num(sale.amountPaid ?? sale.finalAmount);
  const debtValue = Math.max(0, Number((totalValue - paidValue).toFixed(2)));

  // ── DISEÑO "TICKET riffas.info" (v3) ───────────────────────────────────
  // Espejo 1:1 del recibo de la app de referencia (decisión de Marco, 14-oct
  // "haslo como la referencia"): ticket blanco, TODO en Courier Prime (look
  // máquina de escribir, trazo grueso → se lee hasta en la miniatura chica de
  // WhatsApp), separadores punteados, icono de ticket con $, campos en UNA
  // columna y "¡Gracias por su compra!" al final. SIN chip de estado, SIN
  // premio, SIN footer web: exactamente los campos de la referencia.
  // Montos ENTEROS (regla de Marco para rifacil) aunque la referencia usa 2
  // decimales.

  // Fila etiqueta:valor (UNA columna, como la referencia). Label regular,
  // valor NEGRITA grande: legible en miniatura (exigencia de Marco).
  const row = (label: string, value: string, size = 27, valueWeight = 700) =>
    el("div", { display: "flex", flexDirection: "row", alignItems: "flex-start", marginBottom: 8 }, [
      el("div", { display: "flex", color: C.ink, fontSize: size, fontWeight: 400, width: 235 }, label),
      el(
        "div",
        { display: "flex", color: C.ink, fontSize: size, fontWeight: valueWeight, flexGrow: 1, flexBasis: 0 },
        value
      ),
    ]);

  // Separador punteado (como las líneas troqueladas de la referencia).
  const sep = () =>
    el("div", { display: "flex", width: "100%", height: 0, borderTop: `2px dashed ${C.dash}`, margin: "12px 0" });

  // Icono del ticket: cuadrito de borde punteado con un ticket azul y el $.
  // Hecho con divs de Satori (cero assets externos, cero fuentes del sistema).
  const ticketIcon = el(
    "div",
    {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: 74,
      height: 74,
      border: `2px dashed ${C.dash}`,
      borderRadius: 10,
      marginRight: 18,
      flexShrink: 0,
    },
    el(
      "div",
      {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 48,
        height: 34,
        backgroundColor: "#2D9CDB",
        borderRadius: 7,
      },
      el("div", { display: "flex", color: "#FFFFFF", fontSize: 24, fontWeight: 700, fontFamily: "Courier Prime" }, "$")
    )
  );

  // Sorteo (formato largo, como la referencia) + lotería en crudo.
  const drawLong = fmtDrawLong(raffle.drawDate);
  const lotLine = raffle.lottery ? `Lotería: ${raffle.lottery.trim()}` : "";

  // Números: todos, en una línea que envuelve. ESCALADO por cantidad: un
  // comprador mayorista (50-80 números, común en VE) no debe romper el ticket.
  const numCount = (sale.numbers || []).length;
  const numbersText = (sale.numbers || []).join(", ") || "—";
  const numbersFontSize =
    numCount <= 8 ? 32 : numCount <= 16 ? 28 : numCount <= 30 ? 24 : numCount <= 60 ? 19 : numCount <= 100 ? 16 : 14;

  const card = el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      width: "100%",
      backgroundColor: C.card,
      fontFamily: "Courier Prime",
      padding: "30px 40px",
    },
    [
      // 1) Encabezado: icono ticket + (título / organizador / sorteo / lotería)
      //    centrados, como la referencia.
      el("div", { display: "flex", flexDirection: "row", alignItems: "center" }, [
        ticketIcon,
        el("div", { display: "flex", flexDirection: "column", alignItems: "center", flexGrow: 1, flexBasis: 0 }, [
          el("div", { display: "flex", color: C.ink, fontSize: 32, fontWeight: 700, textAlign: "center" }, raffle.title || "Rifa"),
          el("div", { display: "flex", color: C.ink, fontSize: 22, marginTop: 4, textAlign: "center" }, brandName),
          drawLong
            ? el("div", { display: "flex", color: C.sub, fontSize: 19, marginTop: 4, textAlign: "center" }, drawLong)
            : el("div", {}),
          lotLine
            ? el("div", { display: "flex", color: C.faint, fontSize: 17, marginTop: 3, textAlign: "center" }, lotLine)
            : el("div", {}),
        ]),
      ]),

      sep(),

      // 2) Números + datos del comprador (etiqueta:valor, una sola columna).
      row("Números:", numbersText, numbersFontSize),
      row("Comprador:", contact.name || "—", 27),
      contact.phone ? row("Teléfono:", contact.phone, 27) : el("div", {}),
      sale.createdAt ? row("Reservado:", fmtReserva(sale.createdAt), 27) : el("div", {}),

      sep(),

      // 3) Montos + fecha (todos en negrita, enteros, como manda rifacil).
      row("Valor total:", money(totalValue), 28),
      row("Abonado:", money(paidValue), 28),
      row("Deuda:", money(debtValue), 28),
      row("Fecha:", fmtReserva(sale.paidAt || sale.createdAt), 27),

      sep(),

      // 4) Cierre de la referencia.
      el(
        "div",
        { display: "flex", justifyContent: "center", marginTop: 2 },
        el("div", { display: "flex", color: C.ink, fontSize: 26, fontWeight: 700 }, "¡Gracias por su compra!")
      ),
    ]
  );

  // Marco exterior (da el aire alrededor del ticket).
  const tree = el(
    "div",
    {
      display: "flex",
      width: "100%",
      padding: 16,
      backgroundColor: C.frame,
      fontFamily: "Courier Prime",
    },
    card
  );

  const fonts = getFonts();
  return satori(tree as any, {
    // Boleto HORIZONTAL (~4:3): WhatsApp SOLO pinta como card GRANDE las imágenes
    // horizontales (una vertical/alta la deja en blanco). El lienzo final de la
    // card se clava a 1080x790 exactos en rasterizeCardExact.
    width: 1000,
    fonts: [
      { name: "Courier Prime", data: fonts.regular, weight: 400, style: "normal" },
      { name: "Courier Prime", data: fonts.bold, weight: 600, style: "normal" },
      { name: "Courier Prime", data: fonts.bold, weight: 700, style: "normal" },
    ],
    loadAdditionalAsset: async (code: string, segment: string) =>
      code === "emoji" ? await loadEmoji(segment) : "",
  } as any);
}

// Rasteriza el SVG a PNG RGBA (resvg SIEMPRE entrega RGBA) al ancho pedido.
function rasterize(svg: string, width: number): Buffer {
  return new Resvg(svg, { fitTo: { mode: "width", value: width } })
    .render()
    .asPng();
}

// ── Card de WhatsApp con lienzo EXACTO 1080x790 ──────────────────────────
// La referencia que SÍ sale como card GRANDE (riffas.info) es un PNG de
// EXACTAMENTE 1080x790. La nuestra salía con el alto que diera el contenido
// (p.ej. 794). Con el contenido variable (cantidad de números, wrap) el alto
// nunca es estable, así que rasterizamos al ancho y luego componemos el PNG
// sobre un lienzo fijo 1080x790 rellenando con el color del marco (contain,
// centrado, NUNCA recortar contenido; solo se achica si el contenido se pasa
// del alto — caso extremo de muchos números). Todo con resvg (cero deps
// nuevas): el PNG se embebe como data-URI en un SVG-lienzo y se re-rasteriza.
export const RECEIPT_CARD_WIDTH = 1080;
export const RECEIPT_CARD_HEIGHT = 790;

export function rasterizeCardExact(svg: string): Buffer {
  const rendered = new Resvg(svg, {
    fitTo: { mode: "width", value: RECEIPT_CARD_WIDTH },
  }).render();
  const w = rendered.width;
  const h = rendered.height;
  if (w === RECEIPT_CARD_WIDTH && h === RECEIPT_CARD_HEIGHT) return rendered.asPng();
  const pngB64 = rendered.asPng().toString("base64");
  // contain: si cabe, tamaño natural centrado; si se pasa de alto, se achica
  // proporcionalmente (y sobra a los lados) antes que recortar.
  const scale = Math.min(RECEIPT_CARD_WIDTH / w, RECEIPT_CARD_HEIGHT / h, 1);
  const drawW = Math.max(1, Math.round(w * scale));
  const drawH = Math.max(1, Math.round(h * scale));
  const x = Math.round((RECEIPT_CARD_WIDTH - drawW) / 2);
  const y = Math.round((RECEIPT_CARD_HEIGHT - drawH) / 2);
  const canvas =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${RECEIPT_CARD_WIDTH}" height="${RECEIPT_CARD_HEIGHT}" viewBox="0 0 ${RECEIPT_CARD_WIDTH} ${RECEIPT_CARD_HEIGHT}">` +
    `<rect width="${RECEIPT_CARD_WIDTH}" height="${RECEIPT_CARD_HEIGHT}" fill="${C.frame}"/>` +
    `<image x="${x}" y="${y}" width="${drawW}" height="${drawH}" xlink:href="data:image/png;base64,${pngB64}"/>` +
    `</svg>`;
  return new Resvg(canvas).render().asPng();
}

// Render puro (sin Cloudinary): árbol Satori -> SVG -> PNG RGBA a 2x (1880).
export async function renderReceiptPng(
  input: GenerateReceiptInput,
  width = 1880
): Promise<Buffer> {
  return rasterize(await renderReceiptSvg(input), width);
}

// Recibo + card para WhatsApp EN UN SOLO render de Satori:
//   - receiptUrl: PNG 2x subido a Cloudinary (fuente durable; /rc y el header de
//     la Cloud API derivan de ahí con el c_pad 1080x790).
//   - cardPng: PNG **RGBA** con lienzo EXACTO 1080x790 DIRECTO de resvg, para
//     subir a ImgBB. Por qué no el derivado c_pad de Cloudinary: sale RGB (sin
//     alfa). Alimentamos ImgBB con el PNG original de resvg (RGBA) y nos
//     saltamos la conversión de Cloudinary.
export async function generateReceiptAndCard(
  input: GenerateReceiptInput
): Promise<{ receiptUrl: string; cardPng: Buffer }> {
  const svg = await renderReceiptSvg(input);
  const png = rasterize(svg, 1880);
  // Card de ImgBB con lienzo EXACTO 1080x790 (experimento 13-oct: igualar a la
  // referencia riffas.info byte a byte en lo controlable; ver imgbb.ts).
  const cardPng = rasterizeCardExact(svg);
  const receiptUrl = await uploadReceiptCloudinary(png, input.sale.receiptNumber);
  return { receiptUrl, cardPng };
}

export async function generateReceipt(
  input: GenerateReceiptInput
): Promise<string> {
  return (await generateReceiptAndCard(input)).receiptUrl;
}

async function uploadReceiptCloudinary(
  png: Buffer,
  receiptNumber: string
): Promise<string> {
  const dataUri = `data:image/png;base64,${png.toString("base64")}`;
  // Transform del derivado del recibo (constante compartida, misma que usan ImgBB vía
  // receiptData y la página /rc). PNG RGB SIN q_auto (no paleta) → WhatsApp lo pinta
  // como card grande. Ver packages/shared/src/receipt-card.ts.
  const CARD_TRANSFORM = RECEIPT_CARD_TRANSFORM;

  const uploaded = await cloudinary.uploader.upload(dataUri, {
    folder: "riffas/receipts",
    public_id: receiptNumber,
    overwrite: true,
    // Al regenerar el recibo (p.ej. APARTADO→PAGADO tras un abono) invalidamos el
    // edge cache para que la card de WhatsApp no muestre el estado/montos viejos.
    invalidate: true,
    resource_type: "image",
    // Pre-generamos (eager SÍNCRONO) el derivado del og:image DENTRO de la subida.
    // En frío Cloudinary tarda ~2.5s en generarlo y el crawler de WhatsApp corta
    // antes → cae al thumbnail chico ilegible. Al generarlo aquí, cuando el rifero
    // envía (segundos después) WhatsApp lo recibe YA listo y muestra la card GRANDE.
    eager: [
      {
        crop: "pad",
        width: 1080,
        height: 790,
        background: "rgb:e6e7eb",
        // Sin quality:q_auto (evita que Cloudinary lo pase a PALETA) y sin fetch_format
        // → el derivado queda PNG RGB: el MISMO que consume ImgBB (receiptCardUrl) y /rc,
        // así el eager pre-genera exactamente esa URL y no se genera en frío. RGB =
        // WhatsApp lo pinta como card grande (los PNG de paleta, no).
      },
    ],
    eager_async: false,
  });

  // Además llenamos el edge cache de la URL EXACTA (sin versión) que sirve /rc;
  // ya es rápida porque el eager generó el derivado. Best-effort.
  try {
    const cardUrl = uploaded.secure_url
      .replace(/\/v\d+\//, "/")
      .replace("/upload/", `/upload/${CARD_TRANSFORM}/`);
    await fetch(cardUrl);
  } catch {
    // si falla, el recibo igual quedó subido.
  }

  return uploaded.secure_url;
}
