// Tasa de cambio USD -> VES por rifero.
//
// Fuente: Binance P2P (USDT/VES). Usamos el precio P2P real al que el rifero
// CONVIERTE USDT en bolívares ("a cuánto compramos Bs"): en la API de Binance
// eso es `tradeType: "SELL"` (el rifero vende USDT y recibe VES; toma el precio
// de los anuncios que COMPRAN USDT). Para usar el otro lado (a cuánto te cuesta
// recomprar dólares, anuncios que VENDEN USDT) cambia P2P_TRADE_TYPE a "BUY".
//
// USDT≈USD, así que VES/USDT lo tratamos como VES/USD. Si el fetch falla, el
// rifero fija la tasa manualmente en Ajustes.

const round4 = (n: number) => Math.round(n * 10000) / 10000;

// Lado del mercado P2P. "SELL" = vender USDT → recibir Bs ("comprar bolívares").
const P2P_TRADE_TYPE: "SELL" | "BUY" = "SELL";

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Trae la tasa de Binance P2P (USDT/VES). Devuelve la mediana de los mejores
// anuncios para que un anuncio atípico no distorsione la tasa.
export async function fetchBinanceP2PRate(): Promise<number> {
  const res = await fetch(
    "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search",
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        fiat: "VES",
        asset: "USDT",
        tradeType: P2P_TRADE_TYPE,
        page: 1,
        rows: 10,
        payTypes: [],
        countries: [],
        publisherType: null,
      }),
    }
  );
  if (!res.ok) throw new Error(`Binance P2P HTTP ${res.status}`);

  const json: any = await res.json();
  const prices: number[] = (json?.data ?? [])
    .map((d: any) => Number(d?.adv?.price))
    .filter((n: number) => Number.isFinite(n) && n > 0);

  if (prices.length === 0) {
    throw new Error("Respuesta de Binance P2P inválida (sin anuncios)");
  }

  // Mediana de hasta los 6 mejores anuncios (Binance los ordena por mejor precio).
  return round4(median(prices.slice(0, 6)));
}

// Tasa activa actual del rifero (la más reciente marcada isActive).
export async function getActiveRate(prisma: any, userId: string) {
  return prisma.exchangeRate.findFirst({
    where: { userId, isActive: true },
    orderBy: { createdAt: "desc" },
  });
}

// Guarda una nueva tasa activa, desactivando la anterior (historial con timestamp).
export async function saveRate(
  prisma: any,
  userId: string,
  vesPerUsd: number,
  source: "BCV" | "BINANCE" | "MANUAL"
) {
  await prisma.exchangeRate.updateMany({
    where: { userId, isActive: true },
    data: { isActive: false },
  });
  return prisma.exchangeRate.create({
    data: { userId, vesPerUsd: round4(vesPerUsd), source, isActive: true },
  });
}
