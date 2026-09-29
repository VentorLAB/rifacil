// Transform de Cloudinary del derivado del recibo para el PREVIEW de WhatsApp.
//
// Fuente ÚNICA de verdad — la usan los 3 consumidores (imgbb vía receiptData, el
// warm-up/eager de receipt.ts, y la página /rc). Antes era un literal duplicado en
// los 3 y se desincronizó; centralizado aquí para que no vuelva a pasar.
//
// CRÍTICO — SIN `q_auto`: con q_auto Cloudinary optimiza el PNG a PALETA (colorType 3,
// indexado) y WhatsApp NO pinta como card grande los PNG de paleta — solo RGB/RGBA.
// La imagen de la app de referencia (riffas.info) que SÍ sale grande es RGBA. Sin
// q_auto el derivado queda RGB (colorType 2) → card grande. NO re-agregar q_auto.
//
// Módulo SIN dependencias nativas (solo una constante) → seguro de importar también
// desde el route handler edge /rc.
export const RECEIPT_CARD_TRANSFORM = "c_pad,w_1080,h_790,b_rgb:e6e7eb";
