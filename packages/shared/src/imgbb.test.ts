import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { uploadReceiptToImgBB } from "./imgbb";

const OK_JSON = {
  data: {
    url_viewer: "https://ibb.co/7J6hKQP8",
    url: "https://i.ibb.co/QF10MkLz/R-1.png",
  },
  success: true,
  status: 200,
};

describe("uploadReceiptToImgBB", () => {
  const prevKey = process.env.IMGBB_API_KEY;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.IMGBB_API_KEY = "test-key";
  });
  afterEach(() => {
    if (prevKey === undefined) delete process.env.IMGBB_API_KEY;
    else process.env.IMGBB_API_KEY = prevKey;
  });

  it("happy path: devuelve viewerUrl (ibb.co) + directUrl", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch" as any)
      .mockResolvedValue({ ok: true, json: async () => OK_JSON } as any);
    const res = await uploadReceiptToImgBB(
      "https://res.cloudinary.com/dbi6monrl/image/upload/riffas/receipts/R-1.png",
      "R-1"
    );
    expect(res).toEqual({
      viewerUrl: "https://ibb.co/7J6hKQP8",
      directUrl: "https://i.ibb.co/QF10MkLz/R-1.png",
    });
    // Llama al endpoint de ImgBB con la key.
    const calledUrl = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).toContain("api.imgbb.com/1/upload");
    expect(calledUrl).toContain("key=test-key");
  });

  it("sin API key → null (falla suave, no llama a la red)", async () => {
    delete process.env.IMGBB_API_KEY;
    const fetchMock = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue({} as any);
    const res = await uploadReceiptToImgBB("https://x/y.png", "R-1");
    expect(res).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("respuesta no OK → null", async () => {
    vi.spyOn(globalThis, "fetch" as any).mockResolvedValue({ ok: false } as any);
    expect(await uploadReceiptToImgBB("https://x/y.png", "R-1")).toBeNull();
  });

  it("JSON sin url_viewer → null", async () => {
    vi.spyOn(globalThis, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => ({ data: {}, success: false }),
    } as any);
    expect(await uploadReceiptToImgBB("https://x/y.png", "R-1")).toBeNull();
  });

  it("fetch lanza (red caída/timeout) → null", async () => {
    vi.spyOn(globalThis, "fetch" as any).mockRejectedValue(new Error("network"));
    expect(await uploadReceiptToImgBB("https://x/y.png", "R-1")).toBeNull();
  });

  it("imagen vacía → null (no llama a la red)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue({} as any);
    expect(await uploadReceiptToImgBB("", "R-1")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
