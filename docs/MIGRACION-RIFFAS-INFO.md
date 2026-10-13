# Migración riffas.info → rifacil

**Regla de oro: nada escribe en la base de producción sin que Marco vea y apruebe el
reporte del DRY-RUN.** Las dos herramientas son dry-run por defecto y la escritura real
exige confirmar a mano el host de la base (`--expect-host` / `EXPECT_HOST`).

**Decisión de Marco (13-oct-2026): riffas.info es la verdad.** En cualquier conflicto
mandan los datos de riffas.info, salvo las ventas hechas en rifacil, que nunca se pisan
sin que Marco las marque como prueba.

## Qué se migra y con qué

| Rifa (riffas.info) | Destino en rifacil | Herramienta |
|---|---|---|
| 117 El Plateado de tu Suerte | rifa nueva, **ACTIVE** aunque su fecha (4-oct) pasó | `import-riffas-info.ts --active 117` |
| 112 Resuelve tu Agosto | rifa nueva, **DRAWN** (cerrada) | `import-riffas-info.ts --drawn 112` |
| 88 Gran Rifa Resuelve | **adopta** la "Gran Rifa Resuelve" que ya existe (DRAWN) | `import-riffas-info.ts` |
| 79 El Azulejo | **adopta** "El Azulejo" existente (DRAWN, aunque le queden 8 libres) | `import-riffas-info.ts` |
| 73 El Marino | **adopta** "El Marino" existente (DRAWN, aunque le queden 7 libres) | `import-riffas-info.ts` |
| 96 El Dubai | **reconcilia** la El Dubai existente, mismo id `cmqh43bxj0001xm2teh6gdnel` | `packages/api/scripts/import-eldubai-v1.ts` |

"Adoptar" = se usa la rifa que ya está en rifacil (vitrina de sorteos: id, banner, premios,
ganador y visibilidad intactos) y solo se le llenan números y ventas. Nada se duplica. Los
títulos se emparejan aunque riffas.info les ponga el prefijo "Rifas Hermanos Pernía - ";
si hay duda, el dry-run lo bloquea y se fija a mano con `--map <ext>=<id>`.

El Dubai **no se borra ni se reimporta**: se reconcilia número a número, así que el dominio
`hermanospernia2023.rifacil.vip` (middleware) y los enlaces de recibo ya enviados siguen
funcionando sin tocar código.

## Mapeo (validado; no cambiar sin Marco)

- **Números:** sold sin deuda → PAID · sold con deuda → SOLD · apartado/pending → RESERVED.
  (En los datos reales "sold con deuda" no aparece: todo sold está pagado. En rifacil SOLD se
  muestra como "Por confirmar".)
- **Importes:** en riffas.info `paymentAmount` es **lo ya abonado**, no el precio, y
  `paymentDue` es la deuda. Total del número = abonado + deuda. La deuda queda exactamente
  como dice riffas.info. *(El importador anterior tomaba `paymentAmount` como precio y
  marcaba como PAGADO todo apartado con abono: borraba la deuda.)*
- **Abonos (13-oct):** lo pagado por número es `paymentAmount`, que es lo que muestra el
  tablero de riffas.info. **La lista de abonos tiene repetidos** (un boleto de $25 con abonos
  `[25, 25, 25]`; en julio, 130 números y ~$3.900). En la Gran Rifa la lista suma $13.038, más
  que el máximo posible de 1.000 × $13. Por eso los abonos se importan en orden de fecha hasta
  cubrir lo pagado: los que sobran se ignoran, y si faltan se añade un pago asumido en
  efectivo. Ambos casos se reportan. La recaudación importada sale **más baja** que la suma
  de abonos y que el "recaudo" de la app de riffas.info, que cuenta los repetidos; el reporte
  muestra las dos cifras.
- **Ventas:** agrupadas por cliente × rifa; cada abono real es un `Payment` CONFIRMED **con
  su fecha original** y su método. La venta toma la fecha del primer apartado.
- **Métodos:** efectivo → `EFECTIVO_USD` (supuesto; `--cash-method EFECTIVO_VES` lo cambia),
  Zelle → ZELLE, Pago Móvil → PAGO_MOVIL, Bancolombia → BANCOLOMBIA, Nequi → NEQUI, Binance →
  BINANCE, Zinli → ZINLI, transferencia → BANK_TRANSFER; lo demás → CASH con aviso.
- **Contactos:** teléfono normalizado a E.164 (`normalizePhone(…, "VE")`, regla de oro #3)
  y deduplicado contra los que ya existen en rifacil; a un contacto existente **no se le
  cambia el nombre**. Teléfonos imposibles ("Usaaa") se guardan tal cual. Las métricas del
  CRM (gastado, boletos, última compra) se recalculan con sus ventas reales.
- **Números sin ficha de cliente** (873 en la rifa 73, 18 en la 79, 2 en la 88): contacto
  solo-nombre y lo pagado (`paymentAmount` del tablero) como un pago asumido en efectivo.
  Si están vendidos, no deben nada; si están apartados, deben el resto del precio. **Las
  fechas y el vendedor salen de los `payments` del tablero**: la fecha del primer y del
  último pago válido, y el `userId` (se ignoran los `isValid: false`). *(Hasta el 13-oct se
  importaban con la fecha del día de la importación: se corrigió re-importando 73, 79 y 88.)*
  Si en el tablero no hay ni nombre, se importa como "Sin nombre (tablero #NNN)": **nunca se
  deja libre un número ocupado**.
- **Estado de la rifa:** por fecha de sorteo. Pasada → DRAWN (cerrada a la venta), aunque
  le queden números. Una rifa DRAWN en rifacil nunca se reabre.
- **Vendedores:** se reutilizan por código, cédula o teléfono; los nuevos llevan código
  `IMP-RI-<id>`.

## Qué bloquea la escritura (el dry-run lo dice y sale con código 2)

- Un número ocupado en el tablero de riffas.info que quedaría libre en rifacil.
- Un número en dos ventas, o fuera del rango de la rifa (p. ej. 1..1000 vs 000..999).
- Una ficha de cliente sobre un número que el tablero da por disponible.
- En la rifa destino, ventas que no hizo esta importación (ventas de rifacil): se listan.
- Varias rifas de rifacil que encajan con el mismo título, o un tamaño o precio distinto.
- Recibos que ya existen en otra rifa.
- `--user-id` de un miembro del equipo (hay que usar la cuenta raíz de Orlando).

---

## Runbook

Todo en **PowerShell**, desde `C:\dev\rifacil` con `main` al día. `pnpm` va por
`npx -y pnpm@9.15.9`. Ojo en PowerShell: listas con comas van **entre comillas** (`"79,73,112"`), si no se
parten en varios argumentos. Las cadenas de conexión solo viven en la variable de la ventana
(nunca en archivos del repo ni en el chat); al cerrar la ventana desaparecen.

```powershell
Set-Location C:\dev\rifacil\packages\db   # todos los comandos corren desde aquí
$DIR = "C:\dev\migracion-riffas-info\2026-10-XX"        # FUERA del repo (datos personales)
```

> El dump viejo `C:\dev\rifacil\migracion-riffas-info\export-all-2026-07-11.json` está
> dentro del repo: muévelo a `C:\dev\migracion-riffas-info\` (ya está en `.gitignore`).

### Paso 0 — Qué base es producción (solo lectura)

Producción hoy está en Neon (el código de `main` no tiene el puente al VPS). Hay dos
proyectos: `ep-billowing-bread` y `ep-icy-cloud`. Para cada uno, con su cadena **directa**
(sin `-pooler`):

```powershell
$env:DATABASE_URL = "<cadena directa>"; $env:DIRECT_URL = $env:DATABASE_URL
npx -y pnpm@9.15.9 exec tsx scripts/migracion/check-db.ts
```

Producción es la que tiene **El Dubai #066 vendida el 11-oct a Marco Vera** y la venta más
reciente. Anota su host: es el `--expect-host` de todo lo demás. El mismo comando dice si
faltan migraciones (`20260929010000_add_receipt_share_url`,
`20261011160000_add_whatsapp_message_log`, `20261011170000_add_chatbot`); si falta alguna:
`npx -y pnpm@9.15.9 exec prisma migrate deploy` con Marco mirando.

### Paso 1 — Respaldo de producción

En la consola de Neon, proyecto de producción → **Branches → Create branch** desde `main`,
nombre `pre-riffas-<fecha>`. Es una copia instantánea completa: el rollback de último
recurso.

### Paso 2 — Congelar ventas (empieza la ventana)

1. Marco avisa a los vendedores: **desde este momento no se vende ni se abona nada en
   riffas.info ni en rifacil** hasta nuevo aviso. Si riffas.info tiene venta online, se
   apaga.
2. Anotar la hora. Cada venta posterior en riffas.info se perdería en la migración y su
   número quedaría libre en rifacil (doble venta).
3. Si aun así entra una venta en la El Dubai de rifacil, el reconciliador la listará como
   PROTEGIDA: no se pierde, pero hay que decidirla.

### Paso 3 — Export final de riffas.info (Marco, en su terminal)

Marco inicia sesión en riffas.info → DevTools → Application → Local Storage → copia
`AUTH_TOKEN`.

```powershell
$env:RIFFAS_TOKEN = "<pegar aquí>"
node scripts/migracion/export-riffas-info.mjs $DIR
Remove-Item Env:RIFFAS_TOKEN
```

Debe terminar sin errores y con `números rifa N: 1000` en cada rifa. Si falla la lectura
de métodos de pago, se detiene (antes, todo habría quedado como CASH sin aviso).

### Paso 4 — DRY-RUN (obligatorio, no escribe)

Con `DATABASE_URL` de producción en la ventana:

```powershell
# las 5 rifas (El Dubai va aparte)
npx -y pnpm@9.15.9 exec tsx scripts/migracion/import-riffas-info.ts --dump $DIR --user-id cmqg5sisi0000sz3bc27a4u9y --drawn "79,73,112" --active 117
# El Dubai (escribe un backup JSON y un CSV en $DIR)
npx -y pnpm@9.15.9 exec tsx ../api/scripts/import-eldubai-v1.ts "$DIR\riffas-info-dump.json"
```

`cmqg5sisi0000sz3bc27a4u9y` es la cuenta raíz de Orlando; el dry-run la muestra con nombre
y correo para confirmarla. Revisar con Marco:

- **Sin ✖ (bloqueos).** Con bloqueos no se sigue.
- Solo deben salir las 5 rifas de la tabla. Si riffas.info trae otras (canceladas, de
  prueba), se excluyen con `--skip-raffle "96,<ext>"` (incluir siempre el 96).
- Destino por rifa: 88/79/73 → **ADOPT** sobre las existentes; 117/112 → **CREATE**.
- Conteos contra el dump del 11-oct (diferencias pequeñas = ventas entre el 11 y el
  congelamiento). Ojo: la columna de recaudo se calculó sumando abonos, con los repetidos
  incluidos. Compárala con la línea `abonos as listed` del reporte, no con `revenue`, que
  ya viene sin repetidos:

  | Rifa | Vendidos | Recaudo 11-oct |
  |---|---|---|
  | 117 Plateado | 980 | $26.225 |
  | 112 Agosto | 991 | $12.624 |
  | 96 El Dubai | 976 | $50.257 |
  | 88 Gran Rifa | 1000 | — |
  | 79 Azulejo | 992 | $22.986 |
  | 73 Marino | 993 | $4.112 + 873 sin ficha |

- Deuda por rifa (ahora sí aparece; antes se perdía) y `methods:` sin `?`.
- **El Dubai — lista PROTEGIDOS:** Marco marca cuáles son **prueba** (la 066 del 11-oct lo
  es) y cuáles reales. Las de prueba se pasan por receiptNumber en `DROP_SALES`. Volver a
  correr el dry-run con `DROP_SALES` hasta que `conflicto = 0` y `ANOMALÍA = 0`.
  - El reporte marca con **🧪** las que *parecen* de prueba, con el motivo: nombre Marco
    Vera o tipo Test/Prueba, teléfono del propio negocio (dueño, equipo, vendedor) o
    repetido en 3+ ventas, madrugada (00:00–05:59 VET), monto simbólico (≤ $1) o redondo
    que no es múltiplo del precio. **Es solo una sugerencia**: una compra real de madrugada
    también sale marcada. Nada se borra sin `DROP_SALES`.
  - Imprime una línea `DROP_SALES="…"` sugerida y deja `protegidos-eldubai-<fecha>.csv` en
    `$DIR` para revisarlo con Instinct antes de decidir.

**Marco da el OK por escrito con el reporte delante.**

### Paso 5 — Corrida real

```powershell
$H = "<host anotado en el Paso 0>"
npx -y pnpm@9.15.9 exec tsx scripts/migracion/import-riffas-info.ts --dump $DIR --user-id cmqg5sisi0000sz3bc27a4u9y --drawn "79,73,112" --active 117 --expect-host $H --confirm MIGRAR
$env:APPLY = "1"; $env:EXPECT_HOST = $H; $env:DROP_SALES = "<receipt>,<receipt>"   # entre comillas
npx -y pnpm@9.15.9 exec tsx ../api/scripts/import-eldubai-v1.ts "$DIR\riffas-info-dump.json"
Remove-Item Env:APPLY, Env:EXPECT_HOST, Env:DROP_SALES
```

Cada rifa va en **una transacción**: o entra entera o no entra nada. El importador
verifica los conteos contra el plan después de cada rifa y para si no cuadran.
`id-map.json` en `$DIR` registra rifas, contactos y vendedores creados.

### Paso 6 — Verificación

- `check-db.ts` otra vez: ventas por rifa.
- Por rifa en el panel de rifacil vs tablero de riffas.info: vendidos, disponibles, recaudo,
  deuda (tolerancia: las diferencias ya documentadas por pagos sin cliente).
- 3 ventas al azar: abonos con fecha, método y monto.
- El Dubai: tablero = riffas.info + ventas reales de rifacil que se conservaron.
- `rifashermanospernia.com` y `hermanospernia2023.rifacil.vip` muestran El Dubai.
- Azulejo, Marino, Gran Rifa y Agosto: **no** se pueden comprar (DRAWN).
- Marco abre el panel y ve las rifas con su marca.

### Paso 7 — Reabrir

Se vende **solo en rifacil**. riffas.info queda de solo lectura (no se borra nada allí).

### Rollback

1. **Las 5 rifas:** `import-riffas-info.ts --dump $DIR --rollback` (dry-run) y luego con
   `--expect-host $H --confirm MIGRAR`. Quita solo lo importado: ventas, pagos, contactos
   y vendedores creados que nadie más usa. Las rifas adoptadas vuelven a quedar sin
   números vendidos, y las ventas hechas en rifacil se conservan.
2. **El Dubai:** el backup JSON del Paso 4 tiene la foto previa; para volver atrás entera,
   el branch de Neon del Paso 1.
3. **Todo:** restaurar el branch `pre-riffas-<fecha>` de Neon (se pierde lo escrito después).

### Después

El corte Neon → VPS (`pg-apps`) va **después** de esta migración: el volcado final ya lleva
todo lo importado.

## Casos conocidos (no son errores)

- Diferencias de recaudo de $20–$390 por rifa: pagos registrados sin cliente ligado. El
  reporte muestra el recaudo planificado y el de la app.
- `prizeValue` de las rifas nuevas queda en 0 (riffas.info no lo guarda): editar a mano.
- El botón DESCARGAR EXCEL de riffas.info está roto del lado de ellos (500): se usa su API.
- Teléfonos raros se conservan tal cual ("Usaaa", números incompletos).

## Pruebas

`npx -y pnpm@9.15.9 --filter @riffas/db exec vitest run scripts/migracion` (planificador).
El ciclo completo (dry-run → real → re-corrida → rollback, y El Dubai con protegidas y
`DROP_SALES`) se probó el 13-oct contra un Postgres local desechable con las migraciones
reales y los datos de julio.
