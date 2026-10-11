// ─────────────────────────────────────────────────────────────────────────────
// Chatbot de WhatsApp con memoria (Claude). Pedido de Marco 11-oct-2026:
// webhook entrante → Claude con historial por conversación → respuesta por la
// misma API del rifero. Config por rifero (userSettings.chatbotEnabled +
// chatbotInstructions). Apagado por defecto: solo responde tenants que lo
// activen Y tengan su WhatsApp API conectado.
//
// Multi-tenant: el mensaje entrante se enruta al rifero por phoneNumberId
// (Cloud API) o número destino (YCloud). La memoria es por (tenant, teléfono
// del cliente): ChatConversation + ChatMessage, dedup por wamid.
//
// Costo: ANTHROPIC_API_KEY es de la plataforma (rifacil) — base para revender
// el chatbot por tenant. Modelo por env CHATBOT_MODEL.
// ─────────────────────────────────────────────────────────────────────────────
import type { PrismaClient } from "@riffas/db";
import { sendTextWhatsapp, type WhatsappCredentials } from "@riffas/shared/whatsapp-cloud";

export interface InboundMessage {
  wamid: string;
  from: string;            // teléfono del cliente (E.164 sin + a veces)
  name?: string;           // nombre de perfil de WhatsApp
  text: string;
  phoneNumberId?: string;  // Cloud API: value.metadata.phone_number_id
  to?: string;             // YCloud: número WABA destino
}

// Extrae mensajes entrantes de AMBOS formatos: Meta Cloud API (entry/changes)
// y YCloud (whatsapp.inbound_message.received).
export function extractInboundMessages(body: any): InboundMessage[] {
  const out: InboundMessage[] = [];
  // YCloud
  const yc = body?.whatsappInboundMessage;
  if (yc && yc.type === "text" && yc.text?.body) {
    out.push({
      wamid: yc.id, from: yc.from, name: yc.customerProfile?.name,
      text: String(yc.text.body).slice(0, 4000), to: yc.to,
    });
    return out;
  }
  // Meta Cloud API
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const v = change?.value;
      if (!v?.messages) continue;
      const names = new Map<string, string>();
      for (const c of v.contacts ?? []) names.set(c.wa_id, c.profile?.name);
      for (const m of v.messages) {
        if (m?.type !== "text" || !m?.text?.body || !m?.from || !m?.id) continue;
        out.push({
          wamid: m.id, from: m.from, name: names.get(m.from),
          text: String(m.text.body).slice(0, 4000),
          phoneNumberId: v.metadata?.phone_number_id,
        });
      }
    }
  }
  return out;
}

const normPhone = (p: string) => p.replace(/[^\d]/g, "");

async function findTenant(prisma: PrismaClient, msg: InboundMessage) {
  const users = await prisma.userSettings.findMany({
    where: {
      chatbotEnabled: true,
      whatsappConnected: true,
      ...(msg.phoneNumberId ? { whatsappPhoneNumberId: msg.phoneNumberId } : {}),
    },
    select: {
      userId: true, whatsappProvider: true, whatsappApiToken: true,
      whatsappPhoneNumberId: true, whatsappPhoneNumber: true, chatbotInstructions: true,
    },
  });
  if (msg.phoneNumberId) return users[0] ?? null;
  // YCloud: cuadrar por número destino (normalizado).
  const target = normPhone(msg.to ?? "");
  return users.find((u) => normPhone(u.whatsappPhoneNumber ?? "") === target) ?? null;
}

async function businessContext(prisma: PrismaClient, userId: string) {
  const [user, raffles, accounts] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.raffle.findMany({
      where: { userId, status: "ACTIVE", isPublic: true },
      select: { title: true, pricePerNumber: true, drawDate: true, loteria: true, description: true },
      take: 5,
    }),
    prisma.paymentAccount.findMany({
      where: { userId, active: true },
      select: { method: true, bankName: true, phone: true, idDocument: true, accountNumber: true, holderName: true },
      take: 8,
    }),
  ]);
  const rifas = raffles.map((r) => {
    const premios = (r.description ?? "").split("||").map((s) => s.trim()).filter(Boolean).join("; ");
    return `- ${r.title}: $${r.pricePerNumber} por número${r.drawDate ? `, juega ${r.drawDate.toISOString().slice(0, 10)}` : ""}${r.loteria ? ` por ${r.loteria}` : ""}${premios ? `. Premios: ${premios}` : ""}`;
  }).join("\n") || "(sin rifas activas ahora mismo)";
  const pagos = accounts.map((a) =>
    `- ${a.method}${a.bankName ? ` ${a.bankName}` : ""}${a.phone ? ` tlf ${a.phone}` : ""}${a.idDocument ? ` CI/RIF ${a.idDocument}` : ""}${a.accountNumber ? ` cta ${a.accountNumber}` : ""}${a.holderName ? ` a nombre de ${a.holderName}` : ""}`
  ).join("\n") || "(preguntar al organizador)";
  return { nombre: user?.name || "la rifa", rifas, pagos };
}

async function callClaude(system: string, history: { role: "user" | "assistant"; content: string }[]) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.CHATBOT_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system,
      messages: history.slice(-20),
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${j?.error?.message || r.statusText}`);
  return String(j?.content?.[0]?.text ?? "").trim();
}

// Procesa UN mensaje entrante: guarda, piensa, responde. Nunca lanza (el
// webhook debe responder 200 igual).
export async function handleInboundMessage(prisma: PrismaClient, msg: InboundMessage) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return;
    const tenant = await findTenant(prisma, msg);
    if (!tenant?.whatsappApiToken) return;

    const phone = `+${normPhone(msg.from)}`;

    // Dedup por wamid (Meta reintenta si la respuesta tarda).
    const dup = await prisma.chatMessage.findUnique({ where: { wamid: msg.wamid }, select: { id: true } });
    if (dup) return;

    const convo = await prisma.chatConversation.upsert({
      where: { userId_customerPhone: { userId: tenant.userId, customerPhone: phone } },
      update: { lastMessageAt: new Date(), ...(msg.name ? { customerName: msg.name } : {}) },
      create: { userId: tenant.userId, customerPhone: phone, customerName: msg.name ?? null },
    });
    await prisma.chatMessage.create({
      data: { conversationId: convo.id, direction: "IN", body: msg.text, wamid: msg.wamid },
    });

    const history = await prisma.chatMessage.findMany({
      where: { conversationId: convo.id },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { direction: true, body: true },
    });

    const ctx = await businessContext(prisma, tenant.userId);
    const system = [
      `Eres el asistente de WhatsApp de ${ctx.nombre}, un negocio de rifas. Respondes compradores en español venezolano, corto y claro (máximo 2-3 párrafos breves), tono amable y vendedor sin ser insistente.`,
      `RIFAS ACTIVAS:\n${ctx.rifas}`,
      `MÉTODOS DE PAGO ACEPTADOS:\n${ctx.pagos}`,
      `Reglas: solo hablas de las rifas, números, precios, premios y pagos de arriba. No inventes premios ni precios. Si te mandan un comprobante o dicen que ya pagaron, diles que en breve el equipo confirma su pago. Si preguntan algo que no sabes (estado de SU compra, reclamos), ofrece pasarlos con el equipo humano. No compartas datos de otros clientes.`,
      tenant.chatbotInstructions ? `Instrucciones del dueño:\n${tenant.chatbotInstructions}` : "",
    ].filter(Boolean).join("\n\n");

    const reply = await callClaude(system, history.map((h) => ({ role: h.direction === "IN" ? "user" as const : "assistant" as const, content: h.body })));
    if (!reply) return;

    const creds: WhatsappCredentials = {
      provider: (tenant.whatsappProvider as "CLOUD_API" | "YCLOUD") ?? "CLOUD_API",
      apiToken: tenant.whatsappApiToken,
      phoneNumberId: tenant.whatsappPhoneNumberId ?? undefined,
      phoneNumber: tenant.whatsappPhoneNumber ?? undefined,
    };
    const sent = await sendTextWhatsapp(creds, phone, reply);
    await prisma.chatMessage.create({
      data: { conversationId: convo.id, direction: "OUT", body: reply, wamid: sent.messageId ?? null },
    });
    await prisma.chatConversation.update({ where: { id: convo.id }, data: { lastMessageAt: new Date() } });
  } catch (e) {
    console.error("[chatbot] error procesando mensaje entrante:", e);
  }
}
