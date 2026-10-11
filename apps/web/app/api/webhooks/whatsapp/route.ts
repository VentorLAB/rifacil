import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@riffas/db";

// Webhook de estados de WhatsApp (Meta Cloud API / YCloud → mismo formato de
// eventos de Meta). Alimenta el METERING: actualiza SENT → DELIVERED/READ/FAILED
// por wamid. Registrar esta URL en la app de Meta (o en YCloud) con el verify
// token de env WHATSAPP_WEBHOOK_VERIFY_TOKEN.
//
// Seguridad: la verificación GET exige el token; el POST valida que el wamid
// exista (solo actualiza filas propias) — no crea datos ni acepta comandos.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "verify token inválido" }, { status: 403 });
}

const STATUS_MAP: Record<string, string> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Formato Meta: entry[].changes[].value.statuses[] (YCloud reenvía igual).
    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const statuses = change?.value?.statuses ?? [];
        for (const st of statuses) {
          const messageId = st?.id;
          const status = STATUS_MAP[st?.status];
          if (!messageId || !status) continue;
          const error =
            status === "FAILED"
              ? (st?.errors?.[0]?.title || st?.errors?.[0]?.message || "falló la entrega").slice(0, 500)
              : null;
          const updated = await prisma.whatsappMessageLog.updateMany({
            where: { messageId },
            data: { status, ...(error ? { error } : {}) },
          });
          if (updated.count === 0) {
            console.warn(`[webhook whatsapp] wamid desconocido (${messageId}) — mensaje no enviado por rifacil o log perdido`);
          }
        }
      }
    }
    // Meta exige 200 rápido aunque no haya nada que procesar.
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[webhook whatsapp] error procesando estados:", err);
    return NextResponse.json({ ok: true }); // 200 igual: evita reintentos infinitos de Meta
  }
}
