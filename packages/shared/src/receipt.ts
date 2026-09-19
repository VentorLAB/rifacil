import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { v2 as cloudinary } from "cloudinary";
import { INTER_SEMIBOLD_WOFF_BASE64 } from "./inter-font";

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

// --- Fuente para Satori (se cachea entre invocaciones del worker) ---
// Inter 600 EMBEBIDA en base64 (./inter-font). No se lee del filesystem a
// propósito: en serverless (Vercel) este paquete se transpila/bundlea y
// import.meta.url/__dirname no apuntan al .woff en disco — un readFileSync
// crashearía en prod. Embebida = cero filesystem y cero red.
let fontCache: Buffer | null = null;
function getFont(): Buffer {
  if (fontCache) return fontCache;
  fontCache = Buffer.from(INTER_SEMIBOLD_WOFF_BASE64, "base64");
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

// "11 JUL 2026, 10:10 PM" (fecha del sorteo)
function fmtDraw(d?: Date | string | null): string {
  if (!d) return "";
  const dt = new Date(d);
  let h = dt.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const mm = dt.getMinutes().toString().padStart(2, "0");
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}, ${h}:${mm} ${ampm}`;
}

// Fecha de reserva (corta, es-VE)
function fmtReserva(d?: Date | string | null): string {
  if (!d) return "";
  return new Date(d).toLocaleString("es-VE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

// Render puro (sin Cloudinary): árbol Satori -> SVG -> PNG. Separado de la subida
// para poder probar el layout localmente sin credenciales de Cloudinary.
export async function renderReceiptPng(
  input: GenerateReceiptInput
): Promise<Buffer> {
  const { sale, raffle, contact } = input;
  const brandName = input.brandName || "Hermanos Pernía";
  const instagram = input.brandInstagram || "@rifashermanospernia";
  const website = (input.brandWebsite || "rifashermanospernia.com").replace(/^https?:\/\//, "");
  // Normalizamos el color de marca para que SIEMPRE lleve '#': un valor guardado
  // como "df0815" (sin almohadilla) pasaría un regex laxo y rompería/ensuciaría el
  // render. Sin match válido → rojo de marca por defecto.
  const brandMatch = /^#?([0-9a-f]{6})$/i.exec((input.brandColor || "").trim());
  const brand = brandMatch ? `#${brandMatch[1]}` : "#DF0815";
  const onBrand = readableOn(brand);

  // Montos: total a cobrar vs. lo efectivamente abonado. La deuda es el resto.
  // num() neutraliza NaN (un monto no numérico jamás debe salir como "$NaN").
  const num = (v: unknown) => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  const totalValue = num(sale.totalAmount ?? sale.finalAmount);
  const paidValue = num(sale.amountPaid ?? sale.finalAmount);
  const debtValue = Math.max(0, Number((totalValue - paidValue).toFixed(2)));
  const paid = debtValue <= 0;

  // Premio (línea corta y persuasiva bajo el título).
  const prizeText = (
    raffle.prizeTagline ||
    raffle.prizes?.[0]?.titulo ||
    raffle.prize ||
    ""
  ).trim();

  // Sorteo + lotería (contexto y gancho: "está por jugarse").
  const drawStr = fmtDraw(raffle.drawDate);
  const lotStr = raffle.lottery
    ? /^loter[ií]a\b/i.test(raffle.lottery.trim())
      ? raffle.lottery.trim()
      : `Lotería ${raffle.lottery.trim()}`
    : "";
  const drawLine = [drawStr ? `Sorteo ${drawStr}` : "", lotStr].filter(Boolean).join("  ·  ");

  const firstName = (contact.name || "").trim().split(/\s+/)[0] || "";
  const persuasive = paid
    ? `🍀 ¡Ya estás jugando${firstName ? `, ${firstName}` : ""}! Mucha suerte`
    : `🤝 Completá tu pago y asegurá tus números`;

  // Logo del rifero (falla suave a null).
  const logoUri = await fetchDataUri(input.brandLogo);

  // Fila de datos (etiqueta izquierda, valor derecha).
  const dataRow = (
    label: string,
    value: string,
    valueColor: string = C.ink,
    opts: { small?: boolean; strong?: boolean } = {}
  ) =>
    el(
      "div",
      { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" },
      [
        el("div", { color: C.sub, fontSize: opts.small ? 11 : 12.5 }, label),
        el(
          "div",
          { color: valueColor, fontSize: opts.small ? 11 : 12.5, fontWeight: opts.strong ? 700 : 600 },
          value
        ),
      ]
    );

  const numberPills = (sale.numbers || []).map((n) =>
    el(
      "div",
      {
        backgroundColor: C.gold,
        color: C.goldInk,
        fontWeight: 700,
        fontSize: 20,
        padding: "6px 14px",
        borderRadius: 9,
        letterSpacing: 1,
        border: `1px solid ${C.goldEdge}`,
      },
      n
    )
  );

  // Perforación con muescas laterales (el card recorta los círculos a semicírculos).
  const perforation = el(
    "div",
    { display: "flex", position: "relative", width: "100%", height: 16, alignItems: "center" },
    [
      el("div", {
        position: "absolute",
        left: -8,
        top: 0,
        width: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: C.frame,
      }),
      el("div", {
        position: "absolute",
        right: -8,
        top: 0,
        width: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: C.frame,
      }),
      el("div", {
        display: "flex",
        width: "100%",
        height: 0,
        borderTop: `2px dashed ${C.dash}`,
        margin: "0 12px",
      }),
    ]
  );

  const statusChip = paid
    ? el(
        "div",
        {
          display: "flex",
          backgroundColor: "#E7F7EE",
          border: "1px solid #A6E2C2",
          borderRadius: 999,
          padding: "5px 14px",
        },
        el("div", { color: C.green, fontSize: 12.5, fontWeight: 700 }, "PAGADO · ¡ESTÁS DENTRO! 🎉")
      )
    : el(
        "div",
        {
          display: "flex",
          backgroundColor: "#FDF3E2",
          border: "1px solid #F0D9A6",
          borderRadius: 999,
          padding: "5px 14px",
        },
        el(
          "div",
          { color: C.amber, fontSize: 12.5, fontWeight: 700 },
          `APARTADO · te falta ${money(debtValue)}`
        )
      );

  const card = el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      width: "100%",
      backgroundColor: C.card,
      borderRadius: 18,
      overflow: "hidden",
      fontFamily: "Inter",
    },
    [
      // 1) Encabezado de marca (color del rifero). El logo va en una PLACA BLANCA
      //    con objectFit:contain → nunca se recorta, sea logotipo ancho o ícono.
      //    Sin logo: cae al nombre de la marca en texto.
      el(
        "div",
        {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "13px 16px 12px",
          backgroundColor: brand,
        },
        [
          logoUri
            ? el(
                "div",
                {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#ffffff",
                  borderRadius: 12,
                  padding: "8px 16px",
                },
                img(logoUri, { height: 46, width: 200, objectFit: "contain" })
              )
            : el("div", { display: "flex", color: onBrand, fontSize: 17, fontWeight: 700, textAlign: "center" }, brandName),
          el(
            "div",
            { color: onBrand, opacity: 0.85, fontSize: 9, fontWeight: 700, letterSpacing: 2.5, marginTop: 9 },
            "COMPROBANTE DE COMPRA"
          ),
        ]
      ),

      // 2) Título de la rifa + premio + sorteo
      el("div", { display: "flex", flexDirection: "column", padding: "13px 16px 10px" }, [
        el("div", { color: C.ink, fontSize: 16.5, fontWeight: 700 }, raffle.title || "Rifa"),
        prizeText
          ? el("div", { color: C.sub, fontSize: 11.5, marginTop: 3 }, `🎁 ${prizeText}`)
          : el("div", {}),
        drawLine
          ? el("div", { color: C.faint, fontSize: 10.5, marginTop: 3 }, drawLine)
          : el("div", {}),
      ]),

      // 3) Chip de estado (claridad total)
      el("div", { display: "flex", padding: "0 16px 12px" }, statusChip),

      // 4) Perforación / troquel
      perforation,

      // 5) Números (protagonistas)
      el(
        "div",
        { display: "flex", flexDirection: "column", alignItems: "center", padding: "13px 16px 4px" },
        [
          el(
            "div",
            { color: C.faint, fontSize: 9.5, fontWeight: 700, letterSpacing: 2, marginBottom: 9 },
            "TUS NÚMEROS"
          ),
          el(
            "div",
            { display: "flex", flexWrap: "wrap", gap: 7, justifyContent: "center" },
            numberPills
          ),
        ]
      ),

      // 6) Datos del comprador
      el("div", { display: "flex", flexDirection: "column", padding: "8px 16px 2px" }, [
        dataRow("Comprador", contact.name + (contact.city ? ` · ${contact.city}` : "")),
        contact.phone ? dataRow("Teléfono", contact.phone) : el("div", {}),
        sale.createdAt ? dataRow("Reservado", fmtReserva(sale.createdAt), C.sub, { small: true }) : el("div", {}),
      ]),

      // 7) Bloque de montos
      el(
        "div",
        {
          display: "flex",
          flexDirection: "column",
          margin: "8px 16px 4px",
          backgroundColor: C.moneyBg,
          borderRadius: 12,
          padding: "10px 12px",
        },
        [
          dataRow("Valor total", money(totalValue), C.ink, { strong: true }),
          dataRow(paid ? "Pagado" : "Abonado", money(paidValue), C.green, { strong: true }),
          !paid ? dataRow("Deuda", money(debtValue), brand, { strong: true }) : el("div", {}),
        ]
      ),

      // 8) Línea persuasiva
      el(
        "div",
        { display: "flex", justifyContent: "center", padding: "6px 16px 12px" },
        el("div", { color: C.ink, fontSize: 12, fontWeight: 600, textAlign: "center" }, persuasive)
      ),

      // 9) Pie de confianza
      el(
        "div",
        {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "11px 16px",
          backgroundColor: C.footer,
        },
        [
          el(
            "div",
            { color: C.gold, fontSize: 10, fontWeight: 700, letterSpacing: 0.5 },
            "🏆 TODO JUEGA HASTA TENER GANADOR"
          ),
          el(
            "div",
            { color: "#C7CDD6", fontSize: 9.5, marginTop: 4 },
            `${website}  ·  ${instagram}`
          ),
          el(
            "div",
            { color: "#7E8590", fontSize: 8.5, marginTop: 3 },
            `Recibo ${sale.receiptNumber}`
          ),
        ]
      ),
    ]
  );

  // Marco exterior (da el aire alrededor del boleto y el color de las muescas).
  const tree = el(
    "div",
    {
      display: "flex",
      width: "100%",
      padding: 14,
      backgroundColor: C.frame,
      fontFamily: "Inter",
    },
    card
  );

  const font = getFont();
  const svg = await satori(tree as any, {
    width: 360,
    fonts: [
      { name: "Inter", data: font, weight: 400, style: "normal" },
      { name: "Inter", data: font, weight: 600, style: "normal" },
      { name: "Inter", data: font, weight: 700, style: "normal" },
    ],
    loadAdditionalAsset: async (code: string, segment: string) =>
      code === "emoji" ? await loadEmoji(segment) : "",
  } as any);

  // Rasterizamos a ~3x (360 -> 1080) para un PNG nítido en pantallas retina.
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1080 } })
    .render()
    .asPng();
  return png;
}

export async function generateReceipt(
  input: GenerateReceiptInput
): Promise<string> {
  const png = await renderReceiptPng(input);
  const dataUri = `data:image/png;base64,${png.toString("base64")}`;
  // Transform del og:image que usa /rc. DEBE coincidir con apps/web/app/rc/[id]/route.ts.
  const CARD_TRANSFORM = "c_pad,w_1080,h_1350,b_rgb:e6e7eb,q_auto:good,f_jpg";

  const uploaded = await cloudinary.uploader.upload(dataUri, {
    folder: "riffas/receipts",
    public_id: input.sale.receiptNumber,
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
        height: 1350,
        background: "rgb:e6e7eb",
        quality: "auto:good",
        fetch_format: "jpg",
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
