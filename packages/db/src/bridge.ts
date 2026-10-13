import type { Pool, PoolConfig } from "@neondatabase/serverless";

/**
 * WebSocket bridge to the VentorLAB VPS Postgres.
 *
 * WHY THIS EXISTS. The database lives on the VPS and the app is served from
 * Vercel. The VPS Postgres does NOT listen on the internet (DOCKER-USER drops
 * it) and must not start to: Vercel has no fixed egress IPs to allow-list.
 * Instead, Caddy (already on 443 with a valid cert) forwards a secret path to
 * the `wsproxy` container (ghcr.io/neondatabase/wsproxy), which speaks
 * WebSocket outside and the Postgres wire protocol inside the `appsdb` Docker
 * network. The Neon serverless driver can talk through that tunnel; Prisma's
 * native engine cannot, hence the driver adapter.
 *
 * Same design already in production for capturatodo
 * (C:\dev\capturatodo\src\lib\conexion-db.ts), adapted to Prisma 5 (the
 * adapter takes a Pool instance, not a config object).
 *
 * MEASURED COST: ~9 ms per query, ~2 s to open a connection (the Postgres
 * handshake inside the tunnel; the WebSocket itself is ~54 ms). On Vercel that
 * is ~2 s extra on every cold start. It is the price of not opening the port.
 *
 * `DB_WS_PROXY` is the proxy address WITHOUT protocol, ending in wsproxy's
 * `/v1` endpoint: `api.venzalia.com/<secret-path>/v1` (Caddy strips the secret
 * prefix; wsproxy only answers on /v1, anything else is a 404). The tunnel is
 * always `wss://`.
 */

/** Strips any scheme (the driver prepends `wss://` itself); the path is kept as is. */
export function normalizeProxyAddress(raw: string): string {
  return raw.trim().replace(/^[a-z]+:\/\//i, "");
}

/** Builds the per-connection proxy URL (without protocol), as wsproxy expects it. */
export function proxyUrlFor(proxy: string, host: string, port: number | string): string {
  return `${normalizeProxyAddress(proxy)}?address=${host}:${port}`;
}

// Each Vercel function instance has its own pool and the VPS Postgres accepts a
// limited number of connections overall. A low cap keeps many parallel
// instances within budget.
export const BRIDGE_POOL_MAX = 3;

/**
 * Configures the Neon driver to go through our proxy and returns a Pool.
 * Imports are lazy on purpose: without a bridge configured, none of this is
 * even loaded.
 */
export function createBridgePool(proxy: string, connectionString: string): Pool {
  if (!connectionString) {
    throw new Error("[db] DB_WS_PROXY is set but DATABASE_URL is empty");
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const neon: typeof import("@neondatabase/serverless") = require("@neondatabase/serverless");

  // Node 22 ships a global WebSocket; `ws` is the fallback for Node 20
  // (Vercel's Node version is a project setting, so do not assume).
  neon.neonConfig.webSocketConstructor =
    typeof WebSocket !== "undefined"
      ? WebSocket
      : // eslint-disable-next-line @typescript-eslint/no-var-requires
        require("ws");

  // The internet leg is encrypted by Caddy's certificate.
  neon.neonConfig.useSecureWebSocket = true;
  // Proxy -> Postgres runs on the internal Docker network without TLS, and
  // Postgres does not listen on the internet. That is the point.
  neon.neonConfig.forceDisablePgSSL = true;
  neon.neonConfig.pipelineTLS = false;
  // Roles use scram-sha-256; Neon's pipelined startup only works with
  // cleartext passwords.
  neon.neonConfig.pipelineConnect = false;
  neon.neonConfig.wsProxy = (host, port) => proxyUrlFor(proxy, host, port);

  const config: PoolConfig = {
    connectionString,
    max: BRIDGE_POOL_MAX,
    // pg's default 0 means "wait forever". Opening a connection through the
    // bridge takes ~2 s, so 10 s is generous; it stops a request from hanging
    // forever if the tunnel stops answering.
    connectionTimeoutMillis: 10_000,
    // Vercel freezes the function between invocations and idle sockets die
    // anyway; no point in keeping them for long.
    idleTimeoutMillis: 30_000,
  };
  const pool = new neon.Pool(config);

  // Prisma 5's adapter-neon does NOT attach an error listener to the pool. An
  // idle client dropped by the tunnel emits "error" on the pool, and an
  // EventEmitter "error" without a listener crashes the process. Log it
  // instead; the pool discards the broken client and opens a new one.
  pool.on("error", (err: Error) => {
    console.error("[db] bridge pool lost a connection:", err.message);
  });

  return pool;
}
