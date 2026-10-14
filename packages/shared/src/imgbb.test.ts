import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { uploadReceiptToImgBB } from "./imgbb";

// Respuesta del endpoint de INVITADO (ibb.co/json).
const GUEST_OK_JSON = {
  status_code: 200,
  success: { message: "image uploaded", code: 200 },
  image: {
    url_viewer: "https://ibb.co/7J6hKQP8",
    url: "https://i.ibb.co/QF10MkLz/R-1.png",
  },
};

// Respuesta de la API oficial (api.imgbb.com).
const API_OK_JSON = {
  data: {
    url_viewer: "https://ibb.co/ApiKey1",
    url: "https://i.ibb.co/AAAA/R-1.png",
  },
  success: true,
  status: 200,
};

// Respuesta simulada de descarga de imagen (Cloudinary → bytes).
const imgDownloadOk = () =>
  ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer }) as any;
const guestUploadOk = () => ({ ok: true, json: async () => GUEST_OK_JSON }) as any;
const apiUploadOk = () => ({ ok: true, json: async () => API_OK_JSON }) as any;

const CLOUD_URL =
  "https://res.cloudinary.com/dbi6monrl/image/upload/riffas/receipts/R-1.png";
// base64 puro (salta la descarga de imagen).
const B64 = Buffer.from("fake-png").toString("base64");

const callsTo = (fetchMock: any, needle: string) =>
  fetchMock.mock.calls.filter((c: any[]) => String(c[0]).includes(needle));

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

  it("URL: baja la imagen y la sube como INVITADO → viewerUrl + directUrl", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch" as any)
      .mockResolvedValueOnce(imgDownloadOk()) // 1) descarga de Cloudinary
      .mockResolvedValueOnce(guestUploadOk()); // 2) subida invitado
    const res = await uploadReceiptToImgBB(CLOUD_URL, "R-1");
    expect(res).toEqual({
      viewerUrl: "https://ibb.co/7J6hKQP8",
      directUrl: "https://i.ibb.co/QF10MkLz/R-1.png",
    });
    // La 2da llamada es al endpoint web de invitado (SIN key en la URL).
    const guestUrl = String(fetchMock.mock.calls[1]?.[0] ?? "");
    expect(guestUrl).toBe("https://ibb.co/json");
    expect(guestUrl).not.toContain("test-key");
  });

  it("base64 directo: no descarga, sube como invitado (multipart, no API)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue(guestUploadOk());
    const res = await uploadReceiptToImgBB(B64, "R-1");
    expect(res?.viewerUrl).toBe("https://ibb.co/7J6hKQP8");
    // 1 sola SUBIDA al endpoint de invitado; las llamadas extra son el warm-up.
    expect(callsTo(fetchMock, "ibb.co/json")).toHaveLength(1);
    expect(callsTo(fetchMock, "api.imgbb.com")).toHaveLength(0);
  });

  it("tras subir, hace WARM-UP del viewer y de la imagen directa (CDN caliente para el crawler de WhatsApp)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch" as any).mockResolvedValue(guestUploadOk());
    const res = await uploadReceiptToImgBB(B64, "R-1");
    expect(res).not.toBeNull();
    const warmed = fetchMock.mock.calls.map((c: any[]) => String(c[0]));
    expect(warmed).toContain("https://ibb.co/7J6hKQP8");
    expect(warmed).toContain("https://i.ibb.co/QF10MkLz/R-1.png");
  });

  it("invitado falla en ambos intentos → cae al RESPALDO de la API oficial con key", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch" as any)
      .mockResolvedValueOnce({ ok: false, status: 500 } as any) // invitado intento 1
      .mockResolvedValueOnce({ ok: false, status: 500 } as any) // invitado intento 2
      .mockResolvedValue(apiUploadOk()); // API oficial + warm-up
    const res = await uploadReceiptToImgBB(B64, "R-1");
    expect(res?.viewerUrl).toBe("https://ibb.co/ApiKey1");
    expect(callsTo(fetchMock, "api.imgbb.com")).toHaveLength(1);
    const apiUrl = String(callsTo(fetchMock, "api.imgbb.com")[0]?.[0] ?? "");
    expect(apiUrl).toContain("key=test-key");
  });

  it("invitado falla y NO hay API key → null", async () => {
    delete process.env.IMGBB_API_KEY;
    vi.spyOn(globalThis, "fetch" as any).mockResolvedValue({ ok: false, status: 500 } as any);
    expect(await uploadReceiptToImgBB(B64, "R-1")).toBeNull();
  });

  it("sin API key la vía invitado IGUAL funciona (resiliencia: no depende de env)", async () => {
    delete process.env.IMGBB_API_KEY;
    vi.spyOn(globalThis, "fetch" as any).mockResolvedValue(guestUploadOk());
    const res = await uploadReceiptToImgBB(B64, "R-1");
    expect(res?.viewerUrl).toBe("https://ibb.co/7J6hKQP8");
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

  it("invitado: reintenta y a la 2da subida OK → viewerUrl", async () => {
    vi.spyOn(globalThis, "fetch" as any)
      .mockResolvedValueOnce({ ok: false, status: 502 } as any) // 1er intento falla
      .mockResolvedValueOnce(guestUploadOk()); // reintento OK
    const res = await uploadReceiptToImgBB(B64, "R-1");
    expect(res?.viewerUrl).toBe("https://ibb.co/7J6hKQP8");
  });

  it("invitado: JSON sin url_viewer en ambos intentos → respaldo API", async () => {
    vi.spyOn(globalThis, "fetch" as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: 400, image: {} }) } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status_code: 400, image: {} }) } as any)
      .mockResolvedValue(apiUploadOk());
    const res = await uploadReceiptToImgBB(B64, "R-1");
    expect(res?.viewerUrl).toBe("https://ibb.co/ApiKey1");
  });

  it("invitado y API lanzan/fallan siempre → null", async () => {
    vi.spyOn(globalThis, "fetch" as any).mockRejectedValue(new Error("network"));
    expect(await uploadReceiptToImgBB(B64, "R-1")).toBeNull();
  });
});
