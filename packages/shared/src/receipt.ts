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
 * Diseño: recibo de marca "Grandes Rifas Hermanos Pernía" (mockup v4 aprobado).
 * Negro + rojo #e2001a + dorado #f5c518 + verde billete. Encabezado con logo real,
 * banner del premio, franja de escasez con N/% DINÁMICOS, números en dorado,
 * datos del comprador con zona, gancho de descuento dinámico y pie de confianza.
 */

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Paleta de marca (un solo lugar para tunear el tema del recibo)
const C = {
  bg: "#0a0a0a",
  black: "#000000",
  ink: "#141414",
  inkLine: "#222222",
  red: "#e2001a",
  gold: "#f5c518",
  green: "#3bd16f",
  white: "#ffffff",
  text: "#cccccc",
  muted: "#888888",
  faint: "#777777",
};

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
// En Satori el display por defecto ya es flex; igual lo seteamos explícito donde importa.
function el(type: string, style: Record<string, any>, children?: any): any {
  return { type, props: { style, children } };
}
function img(src: string, style: Record<string, any>): any {
  return { type: "img", props: { src, style } };
}

const money = (v: unknown) =>
  `$${Number(v ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;

const MONTHS = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

// "11 JUL 2026, 10:10PM" (para la fecha del sorteo, en la franja de escasez)
function fmtDraw(d?: Date | string | null): string {
  if (!d) return "";
  const dt = new Date(d);
  let h = dt.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const mm = dt.getMinutes().toString().padStart(2, "0");
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}, ${h}:${mm}${ampm}`;
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

// Gancho de descuento DINÁMICO (data-driven): según cuántos números apartó, ofrece
// el siguiente pack real de la rifa (qty mayor) con su precio y ahorro calculados de
// pricePerNumber + discountPercent. Para El Dubai: 1→"2 por $100 (ahorra $10)",
// 2→"3 por $145 (ahorra $20)". Sin packs aplicables, mensaje genérico.
function ganchoFor(
  n: number,
  unitPrice: number,
  packs?: { qty: number; discountPercent: number }[] | null
): string {
  const generic = "Mientras más números apartás, más chances de ganar 🍀";
  if (!unitPrice || !packs || packs.length === 0) return generic;
  const next = packs
    .filter((p) => p.qty > n)
    .sort((a, b) => a.qty - b.qty)[0];
  if (!next) return generic;
  const full = next.qty * unitPrice;
  const price = Math.round(full * (1 - next.discountPercent / 100));
  const save = Math.round(full - price);
  const more = next.qty - n;
  const plural = more > 1 ? "s" : "";
  return `Apartá ${more} número${plural} más y llevá ${next.qty} por $${price} — ahorrás $${save} 🍀`;
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
  // Quitamos el selector de variación (FE0F) para casar con los nombres de Twemoji.
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
    prizeTagline?: string | null; // copy del subtítulo del banner (override de marketing)
    bannerUrl?: string | null; // foto LIMPIA del premio (Cloudinary) para el banner
    totalNumbers?: number | null; // total de números de la rifa (para % escasez)
    remaining?: number | null; // números disponibles AHORA (para "quedan N")
    pricePerNumber?: number | null; // precio unitario (para el gancho data-driven)
    discountPackages?: { qty: number; discountPercent: number }[] | null; // packs reales
  };
  contact: { name: string; phone: string; city?: string | null };
  brandName?: string | null;
  brandLogo?: string | null;
  brandColor?: string | null;
  brandInstagram?: string | null;
  brandWebsite?: string | null;
}

// Render puro (sin Cloudinary): árbol Satori -> SVG -> PNG. Separado de la subida
// para poder probar el layout localmente (scripts/render-receipt) sin credenciales.
export async function renderReceiptPng(
  input: GenerateReceiptInput
): Promise<Buffer> {
  const { sale, raffle, contact } = input;
  const brandName = input.brandName || "Hermanos Pernía";
  const instagram = input.brandInstagram || "@rifashermanospernia";
  const website = (input.brandWebsite || "rifashermanospernia.com").replace(/^https?:\/\//, "");

  // Montos reales: total a cobrar vs. lo efectivamente abonado. La deuda es el resto.
  const totalValue = Number(sale.totalAmount ?? sale.finalAmount ?? 0);
  const paidValue = Number(sale.amountPaid ?? sale.finalAmount ?? 0);
  const debtValue = Math.max(0, Number((totalValue - paidValue).toFixed(2)));
  const rate = Number(sale.rateUsed ?? 0);

  // Escasez DINÁMICA desde la DB.
  const total = Number(raffle.totalNumbers ?? 0);
  const remaining = Math.max(0, Number(raffle.remaining ?? 0));
  const soldPct = total > 0 ? Math.min(100, Math.round(((total - remaining) / total) * 100)) : 0;

  // Premio: "Bello Toyota Agya 2026 GR" + "+ $1.500" en dorado (si viene en el texto).
  const prizeText = (
    raffle.prizeTagline ||
    raffle.prizes?.[0]?.titulo ||
    raffle.prize ||
    "Gran premio"
  ).trim();
  const prizeMatch = prizeText.match(/^(.*?)(\+\s*\$.*)$/);
  const prizeMain = (prizeMatch ? prizeMatch[1] : prizeText).trim();
  const prizeAdd = prizeMatch ? prizeMatch[2].trim() : "";

  // Línea de sorteo: "{pct}% vendido · Sorteo 11 JUL 2026, 10:10PM · Lotería Táchira"
  const drawStr = fmtDraw(raffle.drawDate);
  // Evita "Lotería Lotería del Táchira": no anteponer "Lotería" si ya lo trae.
  const lotStr = raffle.lottery
    ? /^loter[ií]a\b/i.test(raffle.lottery.trim())
      ? raffle.lottery.trim()
      : `Lotería ${raffle.lottery.trim()}`
    : "";

  // Escasez HONESTA: el grito "casi agotada" solo si de verdad va muy vendida.
  const scarcityHeadline =
    soldPct >= 80
      ? `🔥 ¡CASI AGOTADA! Solo quedan ${remaining} números`
      : soldPct >= 50
        ? `⚡ ¡Va rápido! Quedan ${remaining} números`
        : `🎟️ Quedan ${remaining} números disponibles`;
  const scarcityMeta = [
    `${soldPct}% vendido`,
    drawStr ? `Sorteo ${drawStr}` : "",
    lotStr,
  ]
    .filter(Boolean)
    .join(" · ");

  const zona = contact.city ? ` · ${contact.city}` : "";

  // Imágenes (en paralelo); fallan suave a null.
  const [logoUri, bannerUri] = await Promise.all([
    fetchDataUri(input.brandLogo),
    fetchDataUri(raffle.bannerUrl),
  ]);

  // Fila de la tabla de comprador
  const dataRow = (
    label: string,
    value: string,
    valueColor: string = C.white,
    opts: { topBorder?: boolean; small?: boolean } = {}
  ) =>
    el(
      "div",
      {
        display: "flex",
        justifyContent: "space-between",
        padding: opts.topBorder ? "6px 0 0" : "3px 0",
        marginTop: opts.topBorder ? 4 : 0,
        ...(opts.topBorder ? { borderTop: `1px solid ${C.inkLine}` } : {}),
      },
      [
        el("div", { color: opts.small ? C.faint : "#aaaaaa", fontSize: opts.small ? 11 : 12 }, label),
        el("div", { color: valueColor, fontSize: opts.small ? 11 : 12 }, value),
      ]
    );

  const numberPills = sale.numbers.map((n) =>
    el(
      "div",
      {
        backgroundColor: C.gold,
        color: C.bg,
        fontWeight: 700,
        fontSize: 18,
        padding: "8px 16px",
        borderRadius: 8,
        letterSpacing: 1,
      },
      n
    )
  );

  const tree = el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      width: "100%",
      backgroundColor: C.bg,
      border: "1px solid #2a2a2a",
      borderRadius: 14,
      overflow: "hidden",
      fontFamily: "Inter",
    },
    [
      // 1) Encabezado: logo HP real + nombre, borde rojo
      el(
        "div",
        {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "12px 16px",
          backgroundColor: C.black,
          borderBottom: `3px solid ${C.red}`,
        },
        [
          logoUri ? img(logoUri, { height: 30, marginRight: 9 }) : el("div", {}),
          el(
            "div",
            { display: "flex", flexDirection: "column" },
            [
              el(
                "div",
                { color: C.red, fontSize: 9, fontWeight: 700, letterSpacing: 0.5 },
                "GRANDES RIFAS"
              ),
              el("div", { color: C.white, fontSize: 13, fontWeight: 700 }, brandName),
            ]
          ),
        ]
      ),

      // 2) Banner del premio. CON foto: overlay sobre la imagen. SIN foto: hero
      //    centrado compacto (evita el hueco negro gigante cuando no hay foto).
      bannerUri
        ? el(
            "div",
            { display: "flex", position: "relative", height: 130, width: "100%", overflow: "hidden" },
            [
              img(bannerUri, { width: "100%", height: "100%", objectFit: "cover" }),
              // título sobre la foto
              el(
                "div",
                { display: "flex", position: "absolute", top: 8, left: 0, right: 0, justifyContent: "center" },
                el(
                  "div",
                  {
                    color: C.gold,
                    fontSize: 24,
                    fontWeight: 700,
                    letterSpacing: 2,
                    textShadow: "0 1px 3px #000",
                  },
                  (raffle.title || "").toUpperCase()
                )
              ),
              // subtítulo del premio (gradiente inferior)
              el(
                "div",
                {
                  display: "flex",
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  padding: "8px 14px",
                  backgroundImage: `linear-gradient(transparent, ${C.bg})`,
                },
                el(
                  "div",
                  { display: "flex", color: C.white, fontSize: 11, fontWeight: 700 },
                  [
                    el("div", { color: C.white }, prizeMain + (prizeAdd ? " " : "")),
                    prizeAdd ? el("div", { color: C.gold }, prizeAdd) : el("div", {}),
                  ]
                )
              ),
            ]
          )
        : el(
            "div",
            {
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              padding: "20px 16px",
              backgroundColor: "#141414",
              borderBottom: `1px solid ${C.inkLine}`,
            },
            [
              el(
                "div",
                { color: C.gold, fontSize: 28, fontWeight: 700, letterSpacing: 2, textAlign: "center" },
                (raffle.title || "").toUpperCase()
              ),
              el(
                "div",
                { display: "flex", marginTop: 8, fontSize: 13, fontWeight: 700, textAlign: "center" },
                [
                  el("div", { color: C.white }, prizeMain + (prizeAdd ? " " : "")),
                  prizeAdd ? el("div", { color: C.gold }, prizeAdd) : el("div", {}),
                ]
              ),
            ]
          ),

      // 3) Franja de escasez ROJA (N y % dinámicos)
      el(
        "div",
        {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "9px 16px",
          backgroundColor: C.red,
        },
        [
          el(
            "div",
            { color: C.white, fontSize: 12, fontWeight: 700, textAlign: "center" },
            scarcityHeadline
          ),
          // barra de progreso
          el(
            "div",
            {
              display: "flex",
              width: "100%",
              height: 5,
              backgroundColor: "rgba(0,0,0,0.25)",
              borderRadius: 3,
              marginTop: 6,
              overflow: "hidden",
            },
            el("div", { width: `${soldPct}%`, height: "100%", backgroundColor: C.gold })
          ),
          el("div", { color: "#ffffee", fontSize: 9, marginTop: 4, textAlign: "center" }, scarcityMeta),
        ]
      ),

      // 4) Cuerpo: números + tabla del comprador
      el(
        "div",
        { display: "flex", flexDirection: "column", padding: 16 },
        [
          el(
            "div",
            { display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 14 },
            [
              el(
                "div",
                { color: C.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 },
                "Tus números de la suerte"
              ),
              el(
                "div",
                { display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" },
                numberPills
              ),
            ]
          ),
          el(
            "div",
            {
              display: "flex",
              flexDirection: "column",
              backgroundColor: C.ink,
              borderRadius: 8,
              padding: 12,
              border: `1px solid ${C.inkLine}`,
            },
            [
              dataRow("Comprador", `${contact.name}${zona}`),
              dataRow("Valor total", money(totalValue)),
              dataRow(debtValue > 0 ? "Abonado" : "Pagado", money(paidValue), C.green),
              debtValue > 0 ? dataRow("Deuda", money(debtValue), C.gold) : el("div", {}),
              rate > 0
                ? dataRow(
                    debtValue > 0 ? "Falta en Bs" : "Total en Bs",
                    `${((debtValue > 0 ? debtValue : totalValue) * rate).toLocaleString("es-VE", {
                      maximumFractionDigits: 2,
                    })} Bs · tasa ${rate.toLocaleString("es-VE", { maximumFractionDigits: 2 })}`,
                    C.faint,
                    { small: true }
                  )
                : el("div", {}),
              dataRow("Fecha de reserva", fmtReserva(sale.createdAt), C.faint, { topBorder: true, small: true }),
              dataRow("Recibo", sale.receiptNumber, C.faint, { small: true }),
            ]
          ),
        ]
      ),

      // 5) Gancho de descuento dinámico
      el(
        "div",
        {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          margin: "0 16px 16px",
          backgroundColor: "#1a1205",
          border: `1px solid ${C.gold}`,
          borderRadius: 10,
          padding: 12,
        },
        [
          el(
            "div",
            { color: C.gold, fontSize: 12, fontWeight: 700, marginBottom: 3, textAlign: "center" },
            "🎁 ¡Más números, más chances de ganar!"
          ),
          el(
            "div",
            { color: "#dddddd", fontSize: 11, textAlign: "center" },
            ganchoFor(
              sale.numbers.length,
              Number(raffle.pricePerNumber ?? 0),
              raffle.discountPackages ?? null
            )
          ),
        ]
      ),

      // 6) Pie de confianza
      el(
        "div",
        {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "12px 16px",
          backgroundColor: "#111111",
          borderTop: `1px solid ${C.inkLine}`,
        },
        [
          el(
            "div",
            { color: C.red, fontSize: 10, fontWeight: 700, textAlign: "center" },
            "🏆 TODO JUEGA HASTA TENER GANADOR"
          ),
          el(
            "div",
            { color: C.text, fontSize: 10, marginTop: 3, textAlign: "center" },
            "Desde 2019 entregando premios reales · Sorteo oficial"
          ),
          el(
            "div",
            { display: "flex", color: C.text, fontSize: 10, marginTop: 3 },
            [
              el("div", { color: C.text }, "📸 "),
              el("div", { color: C.white, fontWeight: 700 }, instagram),
            ]
          ),
        ]
      ),

      // 7) Barra final
      el(
        "div",
        {
          display: "flex",
          justifyContent: "center",
          padding: 10,
          backgroundColor: C.black,
          borderTop: "1px solid #1a1a1a",
        },
        el("div", { color: C.muted, fontSize: 10 }, `🌐 ${website} · ¡Gracias por tu compra!`)
      ),
    ]
  );

  const font = getFont();
  // Registramos el mismo buffer en varios pesos para que cualquier fontWeight
  // (400/600/700) resuelva sin caer al fallback.
  const svg = await satori(tree as any, {
    width: 340,
    fonts: [
      { name: "Inter", data: font, weight: 400, style: "normal" },
      { name: "Inter", data: font, weight: 600, style: "normal" },
      { name: "Inter", data: font, weight: 700, style: "normal" },
    ],
    loadAdditionalAsset: async (code: string, segment: string) =>
      code === "emoji" ? await loadEmoji(segment) : "",
  } as any);

  // Rasterizamos a ~3x (340 -> 1020) para un PNG nítido en pantallas retina.
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1020 } })
    .render()
    .asPng();
  return png;
}

export async function generateReceipt(
  input: GenerateReceiptInput
): Promise<string> {
  const png = await renderReceiptPng(input);
  const dataUri = `data:image/png;base64,${png.toString("base64")}`;
  const uploaded = await cloudinary.uploader.upload(dataUri, {
    folder: "riffas/receipts",
    public_id: input.sale.receiptNumber,
    overwrite: true,
    resource_type: "image",
  });

  return uploaded.secure_url;
}
