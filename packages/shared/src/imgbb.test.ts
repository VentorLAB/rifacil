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

// Respuesta simulada de descarga de imagen (Cloudinary → bytes).
const imgDownloadOk = () =>
  ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer }) as any;
const imgbbUploadOk = () => ({ ok: true, json: async () => OK_JSON }) as any;

const CLOUD_URL =
  "https://res.cloudinary.com/dbi6monrl/image/upload/riffas/receipts/R-1.png";
// base64 puro (salta la descarga de imagen).
const B64 = Buffer.from("fake-png").toString("base64");

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

  it("URL: baja la imagen y la sube a ImgBB → viewerUrl + directUrl", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch" as any)
      .mockResolvedValueOnce(imgDownloadOk()) // 1) descarga de Cloudinary
      .mockResolvedValueOnce(imgbbUploadOk()); // 2) subida a ImgBB
    const res = await uploadReceiptToImgBB(CLOUD_URL, "R-1");
    expect(res).toEqual({
      viewerUrl: "https://ibb.co/7J6hKQP8",
      directUrl: "https://i.ibb.co/QF10MkLz/R-1.png",
    });
    // La 2da llamada es al endpoint de ImgBB con la key.
    const imgbbUrl = String(fetchMock.mock.calls[1]?.[0] ?? "");
    expect(imgbbUrl).toContain("api.imgbb.com/1/upload");
    expect(imgbbUrl).toContain("key=test-key");
  });

  it("base64 directo: no descarga, sube a ImgBB", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch" as any)
      .mockResolvedValue(imgbbUploadOk());
    const res = await uploadReceiptToImgBB(B64, "R-1");
    expect(res?.viewerUrl).toBe("https://ibb.co/7J6hKQP8");
    // Solo 1 fetch (la subida): no hubo descarga previa.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("api.imgbb.com");
  });

  it("sin API key → null (no llama a la red)", async () => {
    delete process.env.IMGBB_API_KEY;
    const fetchMock = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue({} as any);
    expect(await uploadReceiptToImgBB(CLOUD_URL, "R-1")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("imagen vacía → null (no llama a la red)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue({} as any);
    expect(await uploadReceiptToImgBB("", "R-1")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("URL: si la descarga falla siempre → null", async () => {
    vi.spyOn(globalThis, "fetch" as any).mockResolvedValue({ ok: false } as any);
    expect(await uploadReceiptToImgBB(CLOUD_URL, "R-1")).toBeNull();
  });

  it("base64: subida no-OK en ambos intentos → null", async () => {
    vi.spyOn(globalThis, "fetch" as any).mockResolvedValue({ ok: false } as any);
    expect(await uploadReceiptToImgBB(B64, "R-1")).toBeNull();
  });

  it("base64: reintenta y a la 2da subida OK → viewerUrl", async () => {
    vi.spyOn(globalThis, "fetch" as any)
      .mockResolvedValueOnce({ ok: false } as any) // 1er intento falla
      .mockResolvedValueOnce(imgbbUploadOk()); // reintento OK
    const res = await uploadReceiptToImgBB(B64, "R-1");
    expect(res?.viewerUrl).toBe("https://ibb.co/7J6hKQP8");
  });

  it("base64: JSON sin url_viewer en ambos intentos → null", async () => {
    vi.spyOn(globalThis, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => ({ data: {}, success: false }),
    } as any);
    expect(await uploadReceiptToImgBB(B64, "R-1")).toBeNull();
  });

  it("base64: fetch lanza en ambos intentos → null", async () => {
    vi.spyOn(globalThis, "fetch" as any).mockRejectedValue(new Error("network"));
    expect(await uploadReceiptToImgBB(B64, "R-1")).toBeNull();
  });
});
