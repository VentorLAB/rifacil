import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { BRIDGE_POOL_MAX, createBridgePool, normalizeProxyAddress, proxyUrlFor } from "./bridge";

// bridge.ts loads the driver with require(); load it the same way so the test
// sees the same module instance (and the same global neonConfig).
const neon: typeof import("@neondatabase/serverless") = createRequire(__filename)(
  "@neondatabase/serverless",
);

const URL = "postgresql://rifacil_service:secret@pg-apps:5432/rifacil";

describe("normalizeProxyAddress", () => {
  it("keeps a bare host/path untouched", () => {
    expect(normalizeProxyAddress("api.example.com/abc123/v1")).toBe("api.example.com/abc123/v1");
  });

  it("strips a scheme and whitespace (the driver adds wss:// itself)", () => {
    expect(normalizeProxyAddress(" wss://api.example.com/abc123/v1 ")).toBe("api.example.com/abc123/v1");
    expect(normalizeProxyAddress("https://api.example.com/abc123/v1")).toBe("api.example.com/abc123/v1");
  });
});

describe("proxyUrlFor", () => {
  it("appends the target address the way wsproxy expects it", () => {
    expect(proxyUrlFor("wss://api.example.com/abc123/v1", "pg-apps", 5432)).toBe(
      "api.example.com/abc123/v1?address=pg-apps:5432",
    );
  });
});

describe("createBridgePool", () => {
  const pools: Array<{ end: () => Promise<void> }> = [];
  afterEach(async () => {
    await Promise.all(pools.splice(0).map((p) => p.end().catch(() => undefined)));
  });

  it("configures the driver for a TLS-terminating proxy and scram auth", () => {
    const pool = createBridgePool("api.example.com/abc123/v1", URL);
    pools.push(pool);

    expect(neon.neonConfig.useSecureWebSocket).toBe(true);
    expect(neon.neonConfig.forceDisablePgSSL).toBe(true);
    expect(neon.neonConfig.pipelineTLS).toBe(false);
    expect(neon.neonConfig.pipelineConnect).toBe(false);
    expect(neon.neonConfig.webSocketConstructor).toBeTruthy();

    const wsProxy = neon.neonConfig.wsProxy;
    expect(typeof wsProxy).toBe("function");
    expect((wsProxy as (h: string, p: number) => string)("pg-apps", 5432)).toBe(
      "api.example.com/abc123/v1?address=pg-apps:5432",
    );
  });

  it("caps the pool, bounds the connect timeout and listens for pool errors", () => {
    const pool = createBridgePool("api.example.com/abc123/v1", URL);
    pools.push(pool);

    const options = (pool as unknown as { options: Record<string, unknown> }).options;
    expect(options.max).toBe(BRIDGE_POOL_MAX);
    expect(options.connectionTimeoutMillis).toBe(10_000);
    expect(pool.listenerCount("error")).toBe(1);
    // Must not throw: without a listener an "error" event would crash the process.
    expect(() => pool.emit("error", new Error("tunnel dropped"))).not.toThrow();
  });

  it("refuses to start without a connection string", () => {
    expect(() => createBridgePool("api.example.com/abc123", "")).toThrow(/DATABASE_URL/);
  });
});
