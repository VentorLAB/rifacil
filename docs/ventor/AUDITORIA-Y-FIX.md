# Auditoría a fondo — Riffas 2.0 (rifacil)
### Hallazgos priorizados + el fix del problema crítico

Revisé el flujo de venta (web y física), el aislamiento multi-tenant y los límites por plan.
Resumen: **la plataforma está bien construida, pero el control de "no vender el número dos veces"
NO está blindado.** Es justo lo que te preocupaba. Abajo el detalle y la solución exacta.

---

## 🔴 CRÍTICO — Doble venta por condición de carrera (web Y física)

**Dónde:** `public.createSale` (ventas web) y `sale.create` (ventas físicas).

**Qué hacen hoy (ambos):**
1. Leen los números y verifican disponibilidad (`status !== AVAILABLE`).
2. Crean la venta (`sale.create`).
3. `raffleNumber.updateMany({ where: { raffleId, number: { in } }, data: { status: SOLD/RESERVED } })`
   — **sin** la guarda `status: "AVAILABLE"` y **fuera de una transacción**.

**El problema:** entre el paso 1 (chequeo) y el paso 3 (escritura) hay una ventana. Dos compradores
a la vez —o **uno por web y otro en físico al mismo tiempo**— pasan ambos el chequeo, ambos crean su
`Sale`, y ambos sobrescriben el número. El `@@unique([raffleId, number])` **no** te salva: la fila ya
existe, el `updateMany` solo la pisa con el último que escribe. Resultado: **dos ventas distintas
reclaman el mismo número.**

**Por qué te importa más ahora:** el objetivo de unificar web + físico es justo que vendan en paralelo.
Eso **aumenta** la probabilidad de choque (rifa popular, últimos números, web y calle a la vez).

**Severidad:** crítica. Es un bug real, no teórico. Debe arreglarse antes de escalar a Orlando.

---

## 🟠 ALTO — Sin transacciones: estado inconsistente si algo falla a mitad

Los pasos de una venta (crear `Sale` → crear `Payment` → actualizar números → actualizar contacto →
actualizar contadores de la rifa) **no** están envueltos en `$transaction`. Si algo falla a mitad
(un timeout, el render del recibo, un corte de red), queda estado a medias: una venta sin números
marcados, o contadores (`soldCount`, `revenue`) desincronizados del ledger real. Solo
`raffle.ts:174` usa transacción (creación de rifa + generación de números).

El fix del punto crítico resuelve esto de paso, porque mete el reclamo + la venta en una transacción.

---

## 🟡 MEDIO — Límites por plan: existen a medias

`premiumProcedure` (auth + suscripción) existe, pero `enforceSubscriptionLimits` solo valida que la
suscripción exista y no esté `EXPIRED`. **No** aplica límites por plan concretos (máx. rifas activas
en FREE, dominio propio solo en PRO, etc.). Para Orlando no bloquea el lanzamiento, pero **sí lo
necesitas antes de revender**: sin límites reales, el plan FREE canibaliza al PRO. Aquí es donde
amarras `customDomain` solo a PRO/ENTERPRISE.

---

## 🟢 Lo que está SÓLIDO (confirmado)

- **Multi-tenant correcto:** todas las queries filtran por `userId`/`session.user.id`; las
  públicas se acotan por `raffle.userId`. El `upsert` de contacto usa `userId_phone`. Bien.
- **Recibos server-side** (Satori → PNG), con fallback seguro si el render falla. Regla del iPhone
  respetada.
- **Ledger de pagos** bien diseñado: `Payment` como fuente de verdad, `amountPaid` cacheado, deuda
  derivada. Abonos parciales (apartado) bien modelados.
- **Tasa USD/VES congelada** al momento de la venta (`rateUsed`, `amountVes`).
- **Atribución a vendedor** acotada al rifero dueño. **Privacidad** en verificación pública (nombre
  enmascarado).

---

## ✅ EL FIX del problema crítico (reclamo atómico en transacción)

La idea: **reclamar los números PRIMERO, de forma atómica**, con la guarda `status: "AVAILABLE"`
dentro del `where`. `updateMany` solo cambia las filas que siguen disponibles y te dice cuántas
cambió (`count`). Si `count` < lo pedido, alguien te ganó un número → revientas la transacción
entera. Esto cierra el hueco para web, físico y choques web-vs-físico.

### Web — `packages/api/src/routers/public.ts` → `createSale`

Deja ANTES de la transacción lo idempotente (upsert de contacto, cálculo de precio, tasa, recibo
NO). Reemplaza el bloque que va desde `prisma.sale.create(...)` hasta el `raffle.update(...)` por:

```ts
const sale = await prisma.$transaction(async (tx) => {
  // 1) RECLAMO ATÓMICO: solo los que SIGUEN disponibles pasan a SOLD.
  const claim = await tx.raffleNumber.updateMany({
    where: { raffleId: raffle.id, number: { in: input.numbers }, status: "AVAILABLE" },
    data: {
      status: "SOLD",
      contactId: contact.id,
      vendorId,
      soldAt: new Date(),
      paymentMethod: input.paymentMethod,
      receiptNumber,
    },
  });
  if (claim.count !== input.numbers.length) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Uno o más números acaban de ser tomados. Refresca e intenta de nuevo.",
    });
  }

  // 2) Crear la venta (ya con los números asegurados).
  const sale = await tx.sale.create({
    data: {
      raffleId: raffle.id, contactId: contact.id, userId, vendorId,
      numbers: input.numbers, totalNumbers: input.numbers.length,
      totalAmount, discountApplied: discountApplied || undefined, finalAmount,
      amountPaid: declared, rateUsed: rateUsed ?? undefined, amountVes: amountVes ?? undefined,
      status: "PENDING", paymentMethod: input.paymentMethod,
      paymentReference: input.paymentReference, paymentProof: input.paymentProof,
      receiptNumber, source: vendorId ? "vendor" : "public",
    },
  });

  // 3) Enlazar saleId a los números reclamados.
  await tx.raffleNumber.updateMany({
    where: { raffleId: raffle.id, number: { in: input.numbers } },
    data: { saleId: sale.id },
  });

  // 4) Abono reportado (PENDING) + contadores.
  if (declared > 0) {
    await tx.payment.create({
      data: {
        saleId: sale.id, amount: declared, method: input.paymentMethod,
        reference: input.paymentReference, proofUrl: input.paymentProof, status: "PENDING",
      },
    });
  }
  await tx.contact.update({
    where: { id: contact.id },
    data: { totalTickets: { increment: input.numbers.length }, lastPurchase: new Date() },
  });
  await tx.raffle.update({
    where: { id: raffle.id },
    data: { soldCount: { increment: input.numbers.length } },
  });

  return sale;
}, { isolationLevel: "Serializable" });

// EL RECIBO se genera DESPUÉS de la transacción (es lento/externo; no debe
// retener locks de la DB). Luego se hace prisma.sale.update con receiptUrl,
// igual que ya lo haces hoy.
```

> Puedes borrar el chequeo previo `taken.length > 0` o dejarlo solo como validación temprana
> "linda" — el blindaje real es el reclamo atómico de arriba.

### Física — `packages/api/src/routers/sale.ts` → `create`

Mismo patrón. El estado del número es `numberStatus` (`PAID` si pago completo, si no `RESERVED`):

```ts
const sale = await prisma.$transaction(async (tx) => {
  const claim = await tx.raffleNumber.updateMany({
    where: { raffleId: input.raffleId, number: { in: input.numbers }, status: "AVAILABLE" },
    data: {
      status: numberStatus, contactId, vendorId: input.vendorId, soldAt: new Date(),
      paidAt: isFullyPaid ? new Date() : undefined,
      paymentMethod: input.paymentMethod, receiptNumber,
    },
  });
  if (claim.count !== input.numbers.length) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Uno o más números ya fueron vendidos. Verifica e intenta de nuevo.",
    });
  }

  const sale = await tx.sale.create({ data: { /* … igual que hoy … */ } });
  await tx.raffleNumber.updateMany({
    where: { raffleId: input.raffleId, number: { in: input.numbers } },
    data: { saleId: sale.id },
  });
  if (amountPaid > 0) {
    await tx.payment.create({ data: { saleId: sale.id, amount: amountPaid, method: input.paymentMethod,
      reference: input.paymentReference, proofUrl: input.paymentProof, status: "CONFIRMED" } });
  }
  await tx.contact.update({ where: { id: contactId }, data: {
    totalSpent: { increment: amountPaid }, totalTickets: { increment: input.numbers.length },
    totalRaffles: { increment: 1 }, lastPurchase: new Date() } });
  await tx.raffle.update({ where: { id: input.raffleId }, data: {
    soldCount: { increment: input.numbers.length }, revenue: { increment: amountPaid } } });
  return sale;
}, { isolationLevel: "Serializable" });

// Recibo + sale.update(receiptUrl) DESPUÉS de la transacción.
```

### Cómo probarlo (obligatorio antes de lanzar)
- Dos pestañas/dispositivos comprando el **mismo** número casi a la vez → solo una venta debe pasar;
  la otra recibe `CONFLICT`. Repetir simulando web + físico simultáneos.
- Verificar que `soldCount` de la rifa = nº real de números no disponibles (sin descuadres).

---

## Orden de construcción recomendado (después de esta revisión)

1. **Fix anti-doble-venta** (web + física) — esto primero, es el riesgo real. 1 archivo cada uno.
2. **Envolver en transacción** ya queda incluido en el fix.
3. **Standup de la base** + migración `customDomain` + desplegar.
4. **Feature de dominio propio** (middleware + router + página, ya escritos).
5. **Onboarding de Orlando** (cuenta, branding, rifa, dominio).
6. **Límites por plan reales** (antes de revender a otros riferos).
