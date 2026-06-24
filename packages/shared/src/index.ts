// @riffas/shared — utilidades CLIENT-SAFE (este barrel se importa desde el navegador).
// OJO: NO re-exportar "./receipt" aquí — usa satori + @resvg/resvg-js (binarios nativos
// solo-servidor) y rompería cualquier Client Component. Importa el recibo desde
// "@riffas/shared/receipt" (solo en código de servidor: Server Actions, routers, workers).
export * from "./phone";
export * from "./google-contacts";
export * from "./numbers";
export * from "./whatsapp-link";
