import { describe, it, expect } from "vitest";
import { rasterizeCardExact, RECEIPT_CARD_WIDTH, RECEIPT_CARD_HEIGHT } from "./receipt";

// Lee width/height del IHDR de un PNG (bytes 16-23, big-endian).
function pngSize(buf: Buffer): { w: number; h: number } {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const svgOf = (w: number, h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
  `<rect width="${w}" height="${h}" fill="#E6E7EB"/>` +
  `<rect x="10" y="10" width="${w - 20}" height="${h - 20}" fill="#FFFFFF"/>` +
  `</svg>`;

describe("rasterizeCardExact (card ImgBB con lienzo EXACTO 1080x790)", () => {
  it("contenido más bajo que 790 → lienzo exacto, sin recortar", () => {
    // 1000x733 ≈ el alto real que daba la card (→ 794 a 1080). Debe salir 1080x790.
    const png = rasterizeCardExact(svgOf(1000, 733));
    const { w, h } = pngSize(png);
    expect(w).toBe(RECEIPT_CARD_WIDTH);
    expect(h).toBe(RECEIPT_CARD_HEIGHT);
  });

  it("contenido más alto que 790 → se achica (contain), lienzo exacto", () => {
    const png = rasterizeCardExact(svgOf(1000, 1000));
    const { w, h } = pngSize(png);
    expect(w).toBe(RECEIPT_CARD_WIDTH);
    expect(h).toBe(RECEIPT_CARD_HEIGHT);
  });

  it("contenido ya 1080x790 → pasa directo", () => {
    const png = rasterizeCardExact(svgOf(RECEIPT_CARD_WIDTH, RECEIPT_CARD_HEIGHT));
    const { w, h } = pngSize(png);
    expect(w).toBe(RECEIPT_CARD_WIDTH);
    expect(h).toBe(RECEIPT_CARD_HEIGHT);
  });

  it("el PNG sale con alfa (RGBA) como la referencia de riffas.info", () => {
    const png = rasterizeCardExact(svgOf(1000, 733));
    // colorType en IHDR byte 25: 6 = RGBA.
    expect(png[25]).toBe(6);
  });
});
