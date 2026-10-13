# Corte Neon → VPS (rifacil)

**Regla de oro:** producción no se toca sin Marco mirando. Este runbook lo ejecuta Marco
(o el agente con su OK explícito en cada paso que escribe). **Neon no se cancela hasta que
el Paso 9 esté cerrado.**

## Qué cambia

| | Hoy | Después del corte |
|---|---|---|
| Base de producción | Neon `ep-billowing-bread` (us-east-1) | VPS, contenedor **`pg-apps`**, base `rifacil`, rol `rifacil_service` |
| Cómo llega Vercel | TCP directo a Neon | WebSocket: `wss://api.venzalia.com/<ruta-secreta>/v1` → Caddy → `wsproxy` → `pg-apps:5432` (red Docker `appsdb`) |
| Código | Prisma con su motor nativo | El mismo, más `DB_WS_PROXY` → driver adapter de Neon (`packages/db/src/bridge.ts`) |
| Migraciones | `vercel-build` corre `migrate deploy` | `vercel-build` **solo comprueba** por el puente; se aplican a mano por túnel SSH |

Postgres del VPS **no escucha en internet**: el 47281 de `pg-apps` lo bloquea `DOCKER-USER`.
El puente es la única entrada. Sin `DB_WS_PROXY` el código se comporta exactamente como hoy:
este PR se puede mergear antes del corte sin efecto.

**Coste medido:** abrir conexión por el puente cuesta ~2 s (el saludo de Postgres dentro del
túnel) y cada consulta suma la ida y vuelta Vercel ↔ VPS. El VPS está en **Alemania**: con las
funciones de Vercel en `iad1` (EE. UU.) cada consulta añade ~90 ms. Por eso el Paso 6 mueve las
funciones a **`fra1` (Frankfurt)**.

## Datos que hacen falta

- **Ruta secreta del puente:** `~/pgapps/ruta-secreta.txt` en el VPS. `DB_WS_PROXY` =
  `api.venzalia.com/<ruta>/v1`, sin `wss://`. **El `/v1` final es obligatorio** (wsproxy solo
  responde en `/v1`).
- **Contraseña de `rifacil_service`:** `~/neon/rifacil.dbpass` (ya existe, 48 caracteres).
- **Cadena DIRECTA de Neon producción** (`ep-billowing-bread`, sin `-pooler`): de
  `C:\dev\_rifacil-env-backup\env-root-PROD.bak` o de la consola de Neon.
  ⚠️ `~/neon/rifacil.url` en el VPS apunta a **`ep-icy-cloud` (DEV)**: **no usarla**. La copia
  de rifacil que hay en `supabase-db` (7-sep) salió de ahí: es de DEV y no sirve.

## Antes del día (sin ventana, no toca producción)

**A. Mergear este PR.** Sin `DB_WS_PROXY` no cambia nada. Confirmar que el deploy sale verde.

**B. Preparar `pg-apps`** (en el VPS):

```bash
PASS=$(cat ~/neon/rifacil.dbpass)
docker exec -i pg-apps psql -U postgres -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rifacil_service') THEN
    CREATE ROLE rifacil_service LOGIN PASSWORD '$PASS';
  END IF;
END \$\$;
SQL
```

Dar acceso sin TLS **solo desde la red interna** (`appsdb` = `172.20.0.0/16`; por ahí llegan
`wsproxy` y el túnel SSH). Las líneas `hostssl` de tribu11 y capturatodo no se tocan:

```bash
cp ~/pgapps/config/pg_hba.conf ~/pgapps/config/pg_hba.conf.antes-rifacil-$(date +%Y%m%d)
echo "host      rifacil       rifacil_service      172.20.0.0/16 scram-sha-256" >> ~/pgapps/config/pg_hba.conf
docker exec pg-apps psql -U postgres -c "select pg_reload_conf()"
```

**C. Abrir el puente a `pg-apps`.** Hoy `wsproxy` solo deja pasar a `supabase-db`
(`ALLOW_ADDR_REGEX=^supabase-db:5432$`), y otra app lo usa ~170 veces al día, así que
`supabase-db` **se mantiene**. Se recrea el contenedor con la misma imagen; corta el puente
unos 2 s:

```bash
IMG=$(docker inspect wsproxy --format '{{.Image}}')
docker rm -f wsproxy
docker run -d --name wsproxy --restart unless-stopped --network appsdb \
  -p 127.0.0.1:8099:80 \
  -e ALLOW_ADDR_REGEX='^(supabase-db|pg-apps):5432$' \
  -e LOG_CONN_INFO=true -e APPEND_PORT= -e LOG_TRAFFIC=false \
  "$IMG"
docker logs --tail 5 wsproxy
```

**D. Ensayo completo con datos de hoy** (Neon sigue siendo producción). Pasos 3 a 5 sin
congelar, contra una base de ensayo `rifacil_ensayo`, para cronometrar la ventana real. Después:
`docker exec pg-apps psql -U postgres -c "DROP DATABASE rifacil_ensayo"`.

**E. Backups nocturnos.** `/var/backups/ventorlab` hoy guarda un `rifacil` que es la copia
vieja de `supabase-db`. Con `sudo`, añadir `pg-apps` / `rifacil` al script de backup y
comprobar a la mañana siguiente que aparece `rifacil_<fecha>.dump.enc`.

## El día (ventana ≈ 20–30 min, madrugada VET)

**1. Aviso.** Marco avisa a vendedores y riferos: pausa de ventas y abonos.

**2. Congelar Neon (solo lectura).** Desde ese momento ninguna escritura llega a Neon, y el
volcado es consistente por construcción. Contra Neon producción (consola SQL de Neon o `psql`):

```sql
ALTER DATABASE neondb SET default_transaction_read_only = on;
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE datname = 'neondb' AND pid <> pg_backend_pid();   -- cierra las sesiones viejas
```

La web sigue leyendo; las escrituras fallan con error (lo esperado durante la pausa).
**Rollback inmediato:** `ALTER DATABASE neondb RESET default_transaction_read_only;`

**3. Volcado final** (en el VPS, cadena DIRECTA de producción).

⚠️ **Versiones:** Neon producción corre **PostgreSQL 18.6** y `pg-apps` es **17.11**. `pg_dump`
tiene que ser 18, porque se niega a volcar un servidor más nuevo. El volcado 18 se restaura con
el `pg_restore` 17 de `pg-apps`. Así se hizo el 7-sep (Neon 18 → `supabase-db` 17.6) y funcionó.
El ensayo del Paso D lo confirma con los datos de hoy. La URL entra por stdin para que no
aparezca en la lista de procesos (mismo patrón que `~/neon/volcar18.sh`):

```bash
read -rs URL        # pegar la cadena directa de ep-billowing-bread; no se ve ni se guarda
STAMP=$(date +%Y-%m-%d_%H%M)
printf '%s\n' "$URL" | docker run --rm -i -v ~/neon:/salida postgres:18-alpine \
  bash -c "read -r U; pg_dump \"\$U\" -Fc --no-owner --no-acl -f /salida/rifacil-prod_$STAMP.dump"
chmod 600 ~/neon/rifacil-prod_$STAMP.dump; ls -lh ~/neon/rifacil-prod_$STAMP.dump   # ~31 MB de base
```

**4. Restaurar en `pg-apps`.** Si la base existe es del ensayo; borrarla primero. La extensión
se crea antes y como superusuario (si la crea el restore, falla el comentario):

```bash
docker exec pg-apps psql -U postgres -c "DROP DATABASE IF EXISTS rifacil"
docker exec pg-apps psql -U postgres -c "CREATE DATABASE rifacil OWNER rifacil_service"
docker exec pg-apps psql -U postgres -d rifacil -c "CREATE EXTENSION IF NOT EXISTS pg_trgm"
docker cp ~/neon/rifacil-prod_$STAMP.dump pg-apps:/tmp/rifacil.dump
docker exec pg-apps pg_restore -U postgres -d rifacil --no-owner --no-acl --role=rifacil_service /tmp/rifacil.dump 2>/tmp/restore.err
grep '^pg_restore: error' /tmp/restore.err | grep -vE 'must be owner of extension|already exists' | head   # debe salir vacío
docker exec -i pg-apps psql -U postgres -d rifacil -v ON_ERROR_STOP=1 <<'SQL'
GRANT ALL ON SCHEMA public TO rifacil_service;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO rifacil_service;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO rifacil_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO rifacil_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO rifacil_service;
REVOKE ALL ON DATABASE rifacil FROM PUBLIC;
GRANT CONNECT ON DATABASE rifacil TO rifacil_service;
SQL
docker exec pg-apps rm -f /tmp/rifacil.dump
```

**5. Comparar fila por fila** Neon vs VPS (IGUALDAD exacta, no "parece bien"):

```bash
GEN="SELECT string_agg(format('SELECT %L AS t, count(*) AS n FROM %I.%I', c.relname, n.nspname, c.relname), ' UNION ALL ') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema')"
Q=$(docker exec pg-apps psql -U postgres -d rifacil -Atc "$GEN")
printf '%s\n' "$URL" | docker run --rm -i -e Q="$Q" postgres:18-alpine \
  bash -c 'read -r U; psql "$U" -At -F"|" -c "$Q"' | LC_ALL=C sort > /tmp/neon.txt
docker exec pg-apps psql -U postgres -d rifacil -At -F'|' -c "$Q" | LC_ALL=C sort > /tmp/vps.txt
diff /tmp/neon.txt /tmp/vps.txt && echo "IDENTICO tabla por tabla"
```

Y una comprobación de negocio: la última venta y la El Dubai #066 tienen que coincidir.
`check-db.ts` contra Neon y, por el túnel SSH (ver "Migraciones después del corte"), contra
el VPS.

**6. Vercel** (Settings → Environment Variables → **solo Production**):

| Variable | Valor |
|---|---|
| `DATABASE_URL` | `postgresql://rifacil_service:<pass>@pg-apps:5432/rifacil` (sin `sslmode`) |
| `DIRECT_URL` | el mismo valor (Prisma lo exige en el schema; en modo puente no se usa para conectar) |
| `DB_WS_PROXY` | `api.venzalia.com/<ruta-secreta>/v1` |

Y **Settings → Functions → Function Region → `fra1`** (Frankfurt, junto al VPS).
Guardar los valores viejos de Neon: son el rollback.

**7. Redeploy de producción** (Deployments → último de `main` → Redeploy, **sin** build cache).
El build debe mostrar `[vercel-build] … DB_WS_PROXY → check de migraciones por el puente…` y
`[check-migrations] schema is up to date.` Si falla ahí, nada cambió: rollback del Paso 6.

**8. Prueba de humo** (antes de reabrir ventas):
- `https://rifacil.vip` y `rifashermanospernia.com` cargan; El Dubai muestra sus conteos.
- Login en el panel; Contactos muestra "Total gastado".
- **Una escritura real:** crear y borrar un contacto de prueba.
- Vercel → Logs: sin `[db] bridge pool lost a connection` ni errores de Prisma.
- `docker logs --since 10m wsproxy` muestra `proxying to pg-apps:5432`.

**9. Reabrir** las ventas. Dejar Neon **congelado (solo lectura) una semana** como red de
seguridad. Después: cancelar Neon (ver "Qué más depende de Neon").

## Rollback

- **Antes de reabrir (Pasos 2–8):** volver las 3 variables de Vercel a Neon (borrar
  `DB_WS_PROXY`), region `iad1`, redeploy, y
  `ALTER DATABASE neondb RESET default_transaction_read_only;`. No se pierde nada: el VPS no
  recibió escrituras reales.
- **Después de reabrir:** el VPS ya divergió. Volver a Neon exige volcar el VPS y restaurarlo
  en Neon (los mismos pasos 3–5 en sentido inverso), con nueva pausa. Por eso el Paso 8 se hace
  **antes** de reabrir.

## Migraciones después del corte

El build ya no las aplica (no hay TCP desde Vercel): **las bloquea** si faltan. Para aplicar una
migración nueva, **antes** de mergear su PR:

```powershell
# Terminal 1: túnel (deja 127.0.0.1:55432 → pg-apps)
ssh -N -L 55432:127.0.0.1:47281 ventorlab-vps
# Terminal 2 (C:\dev\rifacil\packages\db)
$env:DATABASE_URL = "postgresql://rifacil_service:<pass>@127.0.0.1:55432/rifacil"
$env:DIRECT_URL = $env:DATABASE_URL
npx -y pnpm@9.15.9 exec prisma migrate status
npx -y pnpm@9.15.9 exec prisma migrate deploy
```

(La conexión entra a `pg-apps` desde `172.20.0.1`, cubierta por la línea `host` del Paso B.)
Antes de una migración destructiva: volcado manual (`pg_dump` como en el Paso 3).

## Qué más depende de Neon (resolver antes de cancelar la cuenta)

- **Vercel Production:** `DATABASE_URL` / `DIRECT_URL` → cambian en el Paso 6.
- **Vercel Preview** apunta a **`ep-icy-cloud` (DEV)**. Al cancelar Neon los previews se quedan
  sin base. Opción recomendada: base `rifacil_dev` en `pg-apps` (restaurada desde un volcado de
  DEV o vacía + migraciones) y las mismas 3 variables en Preview, apuntando a `rifacil_dev`.
- **Desarrollo local:** `C:\dev\rifacil\.env` y `apps/web/.env.local` apuntan a `ep-icy-cloud`.
  Con `rifacil_dev` en el VPS, usar el túnel SSH de arriba (`127.0.0.1:55432/rifacil_dev`).
- **Integración Neon ↔ Vercel:** revisar en Vercel → Integrations si existe. Si existe, quitarla
  **después** del Paso 6, porque puede reescribir variables.
- **GitHub Actions:** el repo no tiene workflows. Nada que cambiar.
- **VPS:** `~/neon/rifacil.url` (DEV), los volcados `~/neon/rifacil_*.dump` y la base `rifacil`
  vieja de `supabase-db` (copia de DEV del 7-sep). Borrarla cuando `rifacil_dev` exista, si no
  se reutiliza.
- **Branch de backup** `pre-riffas-2026-10-13` (endpoint `ep-ancient-frost`): se va con la cuenta.
- **Seguridad:** rotar la contraseña de `neondb_owner` (se pegó en un chat) es irrelevante una
  vez cancelado Neon, pero si la cancelación se retrasa, rotarla.
