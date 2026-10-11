# Migración riffas.info → rifacil

**Regla de oro: nada de esto toca producción ni los datos reales sin el OK explícito de Marco con este plan en la mano.**

## Qué se migró y se validó (dry-run real, 11-oct-2026)

| Rifa | Números vendidos | Recaudo (app) | Recaudo (reconstruido) | Estado destino |
|---|---|---|---|---|
| 117 El Plateado de tu Suerte | 980/1000 | $26.245 | $26.225 | **ACTIVE** (quedan 20) |
| 112 Resuelve tu Agosto | 991/1000 | $12.623 | $12.624 | ACTIVE (quedan 9) |
| 96 El Dubai | 976/1000 | $50.286 | $50.257 | ACTIVE (quedan 24) |
| 88 Gran Rifa Resuelve | 1000/1000 | $13.038 | $13.015 | DRAWN (agotada) |
| 79 El Azulejo | 992/1000 | $23.374 | $22.986 | ACTIVE (quedan 8) |
| 73 El Marino | 993/1000 | $35.369 | $4.112 + 873 fallback | ACTIVE (quedan 7) |

Más: 1.153 contactos con teléfono, vendedores por rifa (Orlando/Eduard = ADMIN, Georgely/Maria = VENDEDOR), y cada abono real con monto, fecha y método.

## Herramientas (esta rama)

1. `packages/db/scripts/migracion/export-riffas-info.mjs` — dump JSON de TODO vía API solo-lectura.
   `RIFFAS_TOKEN=<jwt> node packages/db/scripts/migracion/export-riffas-info.mjs migration-dump`
   (El token sale de localStorage.AUTH_TOKEN logueado en riffas.info. El backend exige header Origin; ya incluido.)
2. `packages/db/scripts/migracion/import-riffas-info.ts` — importador. **Dry-run por defecto** (solo reporte).
   Real: `npx tsx scripts/migracion/import-riffas-info.ts --dump migration-dump --confirm MIGRAR --user-id <cuid>`
   Idempotente: re-correr reemplaza las rifas importadas (id-map.json en el dump).

## Mapeo

- Rifa: nombre→title, precio→pricePerNumber, playDate→drawDate, lotería/contacto/color/banners directos. `prizeValue` queda en 0 (la app vieja no lo guarda; se edita a mano). Estado: DRAWN si pasada Y agotada; si quedan números, ACTIVE.
- Números: sold+sinDeuda→PAID · sold+deuda→SOLD · apartado/pending→RESERVED · available→AVAILABLE.
- Ventas: agrupadas por cliente×rifa (una Sale con sus números, abonos como Payment CONFIRMED con su fecha original).
- Métodos: efectivo→EFECTIVO_USD (supuesto, `--cash-method` lo cambia), Zelle→ZELLE, Pago móvil→PAGO_MOVIL, Bancolombia→BANCOLOMBIA, Nequi→NEQUI, Binance→BINANCE, Zinli→ZINLI; lo demás→CASH con warning.
- Contactos: dedup por (userId, phone). Dirección→city.
- Vendedores: dedup por cédula; responsable→ADMIN, vendedor→VENDEDOR.

## Casos conocidos (quedan en el reporte del importador)

- **873 números de la rifa 73** (y 18 de la 79, 2 de la 88) no tienen ficha de cliente en la app vieja (pagos de rifas viejas sin cliente ligado). Se importan con contacto solo-nombre y pago asumido en efectivo. El reporte los cuenta.
- Diferencias menores de recaudo ($20-$390 por rifa): pagos registrados sin cliente. El importador avisa por rifa.
- El botón DESCARGAR EXCEL de riffas.info está **roto del lado de ellos** (error 500) — la migración usa su API, no ese export.
- Teléfonos raros del lado de ellos se conservan tal cual ("Usaaa", números incompletos).

## Pasos para el día de la migración (con OK de Marco)

1. Export fresco: correr export-riffas-info.mjs (el token vence; sacarlo del navegador ese día).
2. Dry-run y revisar el reporte con Orlando (especialmente rifas 73/79 y el supuesto efectivo=USD).
3. Correr con `--confirm MIGRAR --user-id <orlando>` apuntando a la DB de producción.
4. Verificación: conteos por rifa (tablero vs rifacil), recaudo por rifa, 3 ventas al azar con sus abonos.
5. Rollback si algo sale mal: borrar las rifas importadas (id-map.json) — cascada limpia números/ventas/pagos.
