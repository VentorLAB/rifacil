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
  // Emoji del premio según el texto (auto, moto, efectivo, tecnología, o regalo).
  const prizeIcon = /(carro|auto|toyota|agya|aveo|veh[ií]culo|camioneta|0\s?km)/i.test(prizeText)
    ? "🚗"
    : /(moto|motocicleta|scooter)/i.test(prizeText)
      ? "🏍️"
      : /(efectivo|d[oó]lares|dinero|cash|usd)/i.test(prizeText)
        ? "💵"
        : /(iphone|celular|tel[eé]fono|laptop|tv|televisor|tecnolog)/i.test(prizeText)
          ? "📱"
          : "🎁";

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

  // Números como TEXTO legible (como riffas.info): "045, 088, 112". Muestra TODOS
  // los del comprador. Si son muchos, envuelve; nunca se recorta.
  const numbersText = (sale.numbers || []).join(",  ") || "—";

  // Fila "Etiqueta:  valor" alineada a la izquierda, alto contraste (legible de un
  // vistazo en el preview de WhatsApp). La etiqueta tiene ancho fijo → los valores
  // quedan alineados en columna.
  const row = (label: string, value: string, valueColor: string = C.ink, big = false) =>
    el("div", { display: "flex", flexDirection: "row", alignItems: "baseline", marginBottom: 10 }, [
      el("div", { display: "flex", color: C.sub, fontSize: 19, width: 168 }, label),
      el(
        "div",
        { display: "flex", color: valueColor, fontSize: big ? 24 : 20, fontWeight: 700, flexGrow: 1, flexBasis: 0 },
        value
      ),
    ]);

  // Separador troquelado (línea de puntos horizontal).
  const sep = () =>
    el("div", { display: "flex", width: "100%", height: 0, borderTop: `2px dashed ${C.dash}`, margin: "16px 0" });

  const statusChip = paid
    ? el(
        "div",
        {
          display: "flex",
          alignSelf: "flex-start",
          backgroundColor: "#E7F7EE",
          border: "1px solid #A6E2C2",
          borderRadius: 999,
          padding: "9px 22px",
          marginTop: 6,
        },
        el("div", { color: C.green, fontSize: 20, fontWeight: 700 }, "PAGADO · ¡ESTÁS DENTRO!")
      )
    : el(
        "div",
        {
          display: "flex",
          alignSelf: "flex-start",
          backgroundColor: "#FDF3E2",
          border: "1px solid #F0D9A6",
          borderRadius: 999,
          padding: "9px 22px",
          marginTop: 6,
        },
        el(
          "div",
          { color: C.amber, fontSize: 20, fontWeight: 700 },
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
      borderRadius: 22,
      border: "2px dashed #B9BEC7",
      overflow: "hidden",
      fontFamily: "Inter",
    },
    [
      // 1) Encabezado de marca: logo en placa blanca (o nombre) + "COMPROBANTE".
      el(
        "div",
        {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 26px",
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
                img(logoUri, { height: 44, width: 190, objectFit: "contain" })
              )
            : el("div", { display: "flex", color: onBrand, fontSize: 24, fontWeight: 700 }, brandName),
          el(
            "div",
            { color: onBrand, opacity: 0.95, fontSize: 15, fontWeight: 700, letterSpacing: 2.5 },
            "COMPROBANTE"
          ),
        ]
      ),

      // 2) Cuerpo VERTICAL, limpio y de alto contraste (todo se lee de un vistazo).
      el(
        "div",
        { display: "flex", flexDirection: "column", padding: "24px 28px" },
        [
          // Título de la rifa + premio + sorteo
          el("div", { display: "flex", color: C.ink, fontSize: 34, fontWeight: 700 }, raffle.title || "Rifa"),
          prizeText
            ? el("div", { display: "flex", color: C.sub, fontSize: 19, marginTop: 6 }, `${prizeIcon} ${prizeText}`)
            : el("div", {}),
          drawLine
            ? el("div", { display: "flex", color: C.faint, fontSize: 15, marginTop: 5 }, drawLine)
            : el("div", {}),

          sep(),

          // NÚMEROS (protagonistas): texto grande, todos los del comprador.
          el(
            "div",
            { display: "flex", color: C.faint, fontSize: 14, fontWeight: 700, letterSpacing: 2, marginBottom: 8 },
            "TUS NÚMEROS"
          ),
          el(
            "div",
            { display: "flex", flexWrap: "wrap", color: C.ink, fontSize: 30, fontWeight: 700, letterSpacing: 1 },
            numbersText
          ),

          sep(),

          // Datos del comprador
          row("Comprador:", contact.name + (contact.city ? ` · ${contact.city}` : "")),
          contact.phone ? row("Teléfono:", contact.phone) : el("div", {}),
          sale.createdAt ? row("Reservado:", fmtReserva(sale.createdAt)) : el("div", {}),

          sep(),

          // Montos + estado
          row("Valor total:", money(totalValue), C.ink, true),
          row(paid ? "Pagado:" : "Abonado:", money(paidValue), C.green, true),
          !paid ? row("Deuda:", money(debtValue), brand, true) : el("div", {}),
          el("div", { display: "flex" }, statusChip),

          // Línea persuasiva (cierre cálido, como el "¡Gracias!" de la referencia).
          el(
            "div",
            { display: "flex", justifyContent: "center", width: "100%", color: C.ink, fontSize: 18, fontWeight: 600, marginTop: 18 },
            persuasive
          ),
        ]
      ),

      // 3) Pie de confianza (barra oscura con marca).
      el(
        "div",
        { display: "flex", flexDirection: "column", alignItems: "center", padding: "16px 20px", backgroundColor: C.footer },
        [
          el("div", { display: "flex", color: C.gold, fontSize: 16, fontWeight: 700, letterSpacing: 0.5 }, "🏆 TODO JUEGA HASTA TENER GANADOR"),
          el("div", { display: "flex", color: "#C7CDD6", fontSize: 13, marginTop: 5 }, `${website}  ·  ${instagram}  ·  Recibo ${sale.receiptNumber}`),
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
    // Boleto VERTICAL, limpio y legible (estilo riffas.info). La entrega a WhatsApp
    // se hace vía ImgBB (link ibb.co) que muestra la card GRANDE sin importar el
    // aspecto — por eso podemos priorizar la legibilidad sobre el ancho.
    width: 620,
    fonts: [
      { name: "Inter", data: font, weight: 400, style: "normal" },
      { name: "Inter", data: font, weight: 600, style: "normal" },
      { name: "Inter", data: font, weight: 700, style: "normal" },
    ],
    loadAdditionalAsset: async (code: string, segment: string) =>
      code === "emoji" ? await loadEmoji(segment) : "",
  } as any);

  // Rasterizamos a 2x (620 -> 1240) para un PNG nítido en pantallas retina.
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1240 } })
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
  // PNG REAL (sin f_jpg): la URL .png coincide con el content-type image/png, igual
  // que el i.ibb.co/....png de ImgBB que WhatsApp pinta como card GRANDE.
  const CARD_TRANSFORM = "c_pad,w_1080,h_790,b_rgb:e6e7eb,q_auto:good";

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
        height: 790,
        background: "rgb:e6e7eb",
        quality: "auto:good",
        // Sin fetch_format → el derivado queda como PNG (mismo formato que la subida),
        // así el og:image .png entrega image/png (réplica de ImgBB, card grande).
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
