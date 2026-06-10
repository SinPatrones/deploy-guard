# Protocolo de telemetría — `deploy-guard`

Este documento describe **cómo la librería envía datos a `miempresa360.com`**: qué
peticiones hace, en qué momentos, qué contiene cada payload y qué respuesta espera.
Sirve como contrato para implementar después el endpoint receptor en el backend.

---

## 1. Visión general del flujo

```
  Proyecto cliente (Node en un VPS  ó  app en el navegador)
        │
        │  import { initGuard } from 'deploy-guard'
        ▼
  ┌────────────────────────────────────────────┐
  │  Librería (agente)                          │
  │                                             │
  │  1. Al arrancar  ───────► POST  event=startup   │
  │  2. Cada N min   ───────► POST  event=heartbeat │
  │  3. Al cerrar    ───────► POST  event=shutdown  │
  │                                             │
  │            ◄─────── respuesta { ok, block } │
  └────────────────────────────────────────────┘
        │ HTTPS (fetch, JSON)
        ▼
  https://miempresa360.com/api/telemetry   ← endpoint que implementarás
```

Toda la comunicación es **HTTPS + JSON** mediante `fetch`. No hay websockets ni
conexiones persistentes: son peticiones puntuales independientes.

---

## 2. Endpoint y transporte

| Aspecto            | Valor                                                        |
|--------------------|-------------------------------------------------------------|
| Método             | `POST`                                                      |
| URL                | La que pases en `config.endpoint` (p. ej. `https://miempresa360.com/api/telemetry`) |
| `Content-Type`     | `application/json`                                          |
| Autenticación      | Cabecera `x-api-key: <apiKey>` (solo si configuras `apiKey`) |
| Timeout            | `config.timeoutMs` (por defecto **3000 ms**) vía `AbortController` |
| Cookies            | `credentials: "omit"` — nunca se envían cookies del usuario  |
| Reintentos         | **Ninguno**. Si falla, se ignora silenciosamente            |

> **Importante:** la telemetría está diseñada para **nunca romper ni frenar** el
> proyecto cliente. Cualquier error de red, timeout o respuesta no-2xx se captura y
> se descarta en silencio (salvo que actives `debug: true`).

---

## 3. Cabeceras enviadas

```http
POST /api/telemetry HTTP/1.1
Host: miempresa360.com
Content-Type: application/json
x-api-key: <apiKey>        ← solo si config.apiKey está definido
```

La **IP pública del VPS no se envía en el cuerpo** (es falsificable y en navegador
no se conoce). Debes leerla en el servidor desde la conexión / cabecera
`X-Forwarded-For` o `X-Real-IP` según tu proxy (nginx, Cloudflare, etc.).

---

## 4. Cuerpo de la petición (`TelemetryPayload`)

Cada POST envía exactamente esta estructura JSON:

```jsonc
{
  "projectId": "cliente-acme",            // identificador del proyecto/cliente (tú lo asignas)
  "event": "startup",                     // "startup" | "heartbeat" | "shutdown"
  "instanceId": "f47ac10b-58cc-4372-...", // UUID único por arranque (cambia en cada reinicio)
  "machineId": "9f86d081884c7d659a2f...", // identificador ESTABLE de la máquina/navegador
  "version": "1.2.0",                     // versión del proyecto supervisado
  "env": "production",                    // entorno lógico (NODE_ENV u override)
  "runtime": "node",                      // "node" | "browser"  (entorno técnico)
  "side": "backend",                      // "backend" | "frontend"  (lado de la app)
  "host": {
    "hostname": "vps-frankfurt-01",       // hostname del SO  /  dominio en navegador
    "platform": "linux",                  // os.platform()  /  navigator.platform
    "arch": "x64",                        // os.arch()  /  "web"
    "cpus": 4                             // nº de CPUs  /  navigator.hardwareConcurrency
  },
  "sentAt": "2026-06-09T12:00:00.000Z"    // ISO 8601, momento del envío
}
```

### Significado de cada campo

| Campo        | Origen / utilidad                                                                 |
|--------------|-----------------------------------------------------------------------------------|
| `projectId`  | Lo defines tú al integrar. Separa los datos por cliente/proyecto.                 |
| `event`      | Tipo de señal (ver sección 5).                                                    |
| `instanceId` | UUID generado **en cada arranque**. Útil para contar reinicios y procesos vivos.  |
| `machineId`  | **Clave para contar VPS reales.** Estable entre reinicios y cambios de IP.         |
| `version`    | Versión del proyecto cliente, para saber qué se desplegó.                          |
| `env`        | `production`, `staging`, etc.                                                      |
| `runtime`    | Entorno técnico: `node` (servidor) o `browser`.                                   |
| `side`       | **Distingue backend de frontend.** Autodetectado (`node`→`backend`, `browser`→`frontend`); overridable vía `config.side`. |
| `host`       | Metadatos de la máquina (ver más abajo cómo se obtiene en cada entorno).           |
| `sentAt`     | Timestamp del cliente. Para latencia/orden usa también la hora de recepción.      |

> **`runtime` vs `side`:** `runtime` es el entorno técnico donde corre el código
> (`node` o `browser`). `side` es la clasificación lógica que registrarás en tu
> historial (`backend` o `frontend`). Por defecto van de la mano
> (`node`→`backend`, `browser`→`frontend`), pero `side` se puede forzar con
> `config.side` para casos como SSR. **Para distinguir backend de frontend en tu
> backend, filtra por `side`.**

---

## 5. Eventos y cuándo se disparan

| Evento      | Cuándo se envía                                                        | Para qué sirve                                    |
|-------------|-----------------------------------------------------------------------|---------------------------------------------------|
| `startup`   | Una vez, al llamar a `initGuard()`.                                    | Detectar **nuevos despliegues / arranques**.      |
| `heartbeat` | Cada `heartbeatMinutes` (por defecto 15 min); o manual con `.ping()`. | Saber qué instancias siguen **vivas ahora**.      |
| `shutdown`  | Al llamar `.stop()`, o en navegador al evento `pagehide`.             | Detectar cierres (best-effort, puede perderse).   |

- En **Node**, el temporizador del heartbeat usa `.unref()`: no impide que el
  proceso termine si ya no hay nada más que hacer.
- En **navegador**, el `shutdown` se intenta con `fetch(..., { keepalive: true })`
  durante `pagehide`, pero no está garantizado (depende del navegador).

### Cómo distinguir "instancias activas" vs "despliegues totales"

- **Despliegues / instalaciones totales** → cuenta eventos `startup` (o `machineId`
  únicos vistos alguna vez).
- **Instancias activas ahora** → cuenta `machineId` (o `instanceId`) con un
  `heartbeat` recibido en los últimos, p. ej., 2× `heartbeatMinutes`.

---

## 6. Cómo se obtiene `machineId` y `host` en cada entorno

### Node.js (VPS / servidores)
- `machineId`: hash SHA-256 (truncado a 32 chars) de `/etc/machine-id` o
  `/var/lib/dbus/machine-id`. Si no existen, se calcula un hash a partir de
  `hostname + platform + arch + totalmem + modelo de CPU + MAC` de la primera
  interfaz de red no interna. → **Estable entre reinicios y cambios de IP.**
- `host`: `os.hostname()`, `os.platform()`, `os.arch()`, `os.cpus().length`.
- El `machine-id` crudo del sistema **nunca se transmite**; solo su hash.

### Navegador
- `machineId`: UUID aleatorio persistido en `localStorage`
  (`deploy_guard_mid`). → Reconoce la misma instalación entre recargas, pero
  **menos fiable** (el usuario puede borrar el storage o usar modo privado).
- `host`: `location.hostname` (dominio), `navigator.platform`, `"web"`,
  `navigator.hardwareConcurrency`.

---

## 7. Respuesta esperada del servidor (`TelemetryResponse`)

El endpoint debe responder `200 OK` con este JSON. Aquí vive el **control remoto**:

```jsonc
// Caso normal (autorizado):
{ "ok": true, "block": false, "message": null }

// Para bloquear una instancia no autorizada o que excede el límite:
{ "ok": true, "block": true, "message": "Instancia no autorizada" }
```

| Campo     | Tipo               | Significado                                              |
|-----------|--------------------|---------------------------------------------------------|
| `ok`      | `boolean`          | El servidor procesó el evento correctamente.            |
| `block`   | `boolean` (opc.)   | Si es `true`, la instancia se considera no autorizada.  |
| `message` | `string \| null`   | Motivo legible (se muestra/loguea en el cliente).       |

### Qué hace la librería con `block: true`

Según `config.onBlock`:

| `onBlock`    | Comportamiento al recibir `block: true`                                  |
|--------------|--------------------------------------------------------------------------|
| `"warn"` (def.) | Loguea un `console.warn`. No interrumpe la app.                        |
| `"throw"`    | Lanza `DeployBlockedError` (puedes capturarlo para abortar el arranque). |
| `"callback"` | Invoca `config.onBlockCallback(res)`; tú decides qué hacer.              |

> **El bloqueo solo ocurre con una orden EXPLÍCITA** (`block: true`) del servidor.
> Un fallo de red, timeout o ausencia de respuesta **nunca** bloquea: así un corte
> de internet no apaga apps legítimas.

---

## 8. Ejemplo de petición real (cURL equivalente)

Esto es exactamente lo que tu endpoint recibirá:

```bash
curl -X POST https://miempresa360.com/api/telemetry \
  -H "Content-Type: application/json" \
  -H "x-api-key: TU_CLAVE" \
  -d '{
    "projectId": "cliente-acme",
    "event": "startup",
    "instanceId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "machineId": "9f86d081884c7d659a2feaa0c55ad015",
    "version": "1.2.0",
    "env": "production",
    "runtime": "node",
    "side": "backend",
    "host": { "hostname": "vps-frankfurt-01", "platform": "linux", "arch": "x64", "cpus": 4 },
    "sentAt": "2026-06-09T12:00:00.000Z"
  }'
```

Respuesta:

```json
{ "ok": true, "block": false, "message": null }
```

---

## 9. Esquema de almacenamiento sugerido (para cuando hagas el backend)

Una tabla por evento es suficiente para empezar:

```sql
CREATE TABLE telemetry_events (
  id          BIGSERIAL PRIMARY KEY,
  project_id  TEXT        NOT NULL,
  event       TEXT        NOT NULL,        -- startup | heartbeat | shutdown
  instance_id TEXT        NOT NULL,
  machine_id  TEXT        NOT NULL,        -- agrupa por VPS real
  version     TEXT,
  env         TEXT,
  runtime     TEXT,                        -- node | browser
  side        TEXT,                        -- backend | frontend
  hostname    TEXT,
  platform    TEXT,
  arch        TEXT,
  cpus        INT,
  ip          INET,                        -- la rellenas en el servidor (X-Forwarded-For)
  sent_at     TIMESTAMPTZ,                 -- del cliente
  received_at TIMESTAMPTZ DEFAULT now()    -- del servidor (la de confianza)
);

CREATE INDEX idx_tel_machine ON telemetry_events (project_id, machine_id, received_at);
```

Consultas típicas:

```sql
-- VPS activos ahora (heartbeat en los últimos 30 min)
SELECT COUNT(DISTINCT machine_id)
FROM telemetry_events
WHERE project_id = 'cliente-acme'
  AND received_at > now() - interval '30 minutes';

-- Historial de despliegues (arranques) por máquina
SELECT machine_id, version, MIN(received_at) AS primer_arranque
FROM telemetry_events
WHERE project_id = 'cliente-acme' AND event = 'startup'
GROUP BY machine_id, version
ORDER BY primer_arranque DESC;
```

---

## 10. Pseudocódigo del endpoint receptor

Independiente del framework; adáptalo a tu stack:

```
POST /api/telemetry
  1. Validar cabecera x-api-key contra la clave del projectId. Si no coincide → 401.
  2. Parsear el JSON del cuerpo (TelemetryPayload).
  3. Obtener la IP real desde X-Forwarded-For / X-Real-IP.
  4. Insertar el evento en telemetry_events (con received_at = ahora).
  5. Decidir bloqueo:
       - ¿machine_id está en una allowlist? ¿se superó el nº máximo de VPS?
       - si no autorizado → responder { ok: true, block: true, message: "..." }
       - si ok            → responder { ok: true, block: false }
  6. Responder SIEMPRE 200 con JSON (TelemetryResponse).
```

---

## 11. Ejemplos de implementación del receptor

Implementaciones de referencia del endpoint. Adáptalas a tu stack real; todas
siguen el mismo contrato (secciones 4 y 7).

### 11.1 Node.js + Express (con PostgreSQL)

```ts
// telemetry.route.ts
import express from "express";
import { Pool } from "pg";

const pool = new Pool(); // configura con tus variables de entorno

// Clave de API por proyecto. En producción guárdalas en BD o secrets.
const API_KEYS: Record<string, string> = {
  "cliente-acme": process.env.ACME_API_KEY ?? "",
};

// Máximo de VPS autorizados por proyecto (para enforcement opcional).
const MAX_MACHINES: Record<string, number> = {
  "cliente-acme": 2,
};

export const router = express.Router();

router.post("/api/telemetry", express.json(), async (req, res) => {
  const p = req.body; // TelemetryPayload

  // 1. Validar API key contra el projectId.
  const expected = API_KEYS[p?.projectId];
  if (!expected || req.header("x-api-key") !== expected) {
    return res.status(401).json({ ok: false, message: "API key inválida" });
  }

  // 2. IP real (ajusta según tu proxy: nginx, Cloudflare, etc.).
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
    || req.socket.remoteAddress;

  // 3. Guardar el evento.
  await pool.query(
    `INSERT INTO telemetry_events
       (project_id, event, instance_id, machine_id, version, env, runtime, side,
        hostname, platform, arch, cpus, ip, sent_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      p.projectId, p.event, p.instanceId, p.machineId, p.version, p.env,
      p.runtime, p.side, p.host?.hostname, p.host?.platform, p.host?.arch,
      p.host?.cpus, ip, p.sentAt,
    ]
  );

  // 4. Decidir bloqueo: ¿esta máquina supera el cupo de VPS del proyecto?
  const limit = MAX_MACHINES[p.projectId];
  let block = false;
  let message: string | null = null;

  if (typeof limit === "number") {
    const { rows } = await pool.query(
      `SELECT array_agg(DISTINCT machine_id) AS ids
       FROM telemetry_events
       WHERE project_id = $1
         AND received_at > now() - interval '30 days'`,
      [p.projectId]
    );
    const ids: string[] = rows[0]?.ids ?? [];
    // Bloquea si ya hay >= limit máquinas distintas y esta es una nueva.
    if (!ids.includes(p.machineId) && ids.length >= limit) {
      block = true;
      message = "Se superó el número de instancias autorizadas";
    }
  }

  // 5. Responder SIEMPRE 200 con el contrato TelemetryResponse.
  res.json({ ok: true, block, message });
});
```

### 11.2 NestJS — arquitectura limpia

Separación por capas: el **controller** solo traduce HTTP; el **caso de uso**
contiene la lógica; un **puerto** (interfaz) abstrae la persistencia y un
**adaptador** la implementa. Así la lógica de telemetría no depende de NestJS ni
de la BD.

#### Dominio — tipos y puerto del repositorio

```ts
// telemetry/domain/telemetry-event.ts
export interface TelemetryEvent {
  projectId: string;
  event: "startup" | "heartbeat" | "shutdown";
  instanceId: string;
  machineId: string;
  version?: string;
  env?: string;
  runtime?: "node" | "browser";
  side?: "backend" | "frontend";
  host?: { hostname?: string; platform?: string; arch?: string; cpus?: number };
  ip?: string | null;
  sentAt?: string;
}

// telemetry/domain/telemetry.repository.ts (PUERTO)
export abstract class TelemetryRepository {
  abstract save(event: TelemetryEvent): Promise<void>;
  /** machine_ids distintos vistos para un proyecto en una ventana de días. */
  abstract distinctMachines(projectId: string, days: number): Promise<string[]>;
}
```

#### Caso de uso — lógica de registro y decisión de bloqueo

```ts
// telemetry/application/record-telemetry.usecase.ts
import { Injectable } from "@nestjs/common";
import { TelemetryEvent } from "../domain/telemetry-event";
import { TelemetryRepository } from "../domain/telemetry.repository";

export interface TelemetryResult {
  ok: boolean;
  block: boolean;
  message: string | null;
}

@Injectable()
export class RecordTelemetryUseCase {
  // Cupo de máquinas autorizadas por proyecto (config/secrets en producción).
  private readonly maxMachines: Record<string, number> = { "cliente-acme": 2 };

  constructor(private readonly repo: TelemetryRepository) {}

  async execute(event: TelemetryEvent): Promise<TelemetryResult> {
    await this.repo.save(event);

    const limit = this.maxMachines[event.projectId];
    if (typeof limit !== "number") {
      return { ok: true, block: false, message: null };
    }

    const machines = await this.repo.distinctMachines(event.projectId, 30);
    const isNew = !machines.includes(event.machineId);
    if (isNew && machines.length >= limit) {
      return { ok: true, block: true, message: "Se superó el número de instancias autorizadas" };
    }
    return { ok: true, block: false, message: null };
  }
}
```

#### Adaptador — implementación del puerto (TypeORM como ejemplo)

```ts
// telemetry/infrastructure/typeorm-telemetry.repository.ts
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { TelemetryRepository } from "../domain/telemetry.repository";
import { TelemetryEvent } from "../domain/telemetry-event";
import { TelemetryEventEntity } from "./telemetry-event.entity";

@Injectable()
export class TypeormTelemetryRepository extends TelemetryRepository {
  constructor(
    @InjectRepository(TelemetryEventEntity)
    private readonly rows: Repository<TelemetryEventEntity>,
  ) {
    super();
  }

  async save(e: TelemetryEvent): Promise<void> {
    await this.rows.insert({
      projectId: e.projectId, event: e.event, instanceId: e.instanceId,
      machineId: e.machineId, version: e.version, env: e.env, runtime: e.runtime,
      side: e.side, hostname: e.host?.hostname, platform: e.host?.platform,
      arch: e.host?.arch, cpus: e.host?.cpus, ip: e.ip, sentAt: e.sentAt,
    });
  }

  async distinctMachines(projectId: string, days: number): Promise<string[]> {
    const rows = await this.rows
      .createQueryBuilder("t")
      .select("DISTINCT t.machineId", "machineId")
      .where("t.projectId = :projectId", { projectId })
      .andWhere("t.receivedAt > now() - (:days || ' days')::interval", { days })
      .getRawMany<{ machineId: string }>();
    return rows.map((r) => r.machineId);
  }
}
```

#### Controller — solo HTTP (validación de API key + IP)

```ts
// telemetry/infrastructure/telemetry.controller.ts
import { Body, Controller, Headers, Ip, Post, UnauthorizedException } from "@nestjs/common";
import { RecordTelemetryUseCase } from "../application/record-telemetry.usecase";
import { TelemetryEvent } from "../domain/telemetry-event";

const API_KEYS: Record<string, string> = { "cliente-acme": process.env.ACME_API_KEY ?? "" };

@Controller("api/telemetry")
export class TelemetryController {
  constructor(private readonly recordTelemetry: RecordTelemetryUseCase) {}

  @Post()
  async handle(
    @Body() body: TelemetryEvent,
    @Headers("x-api-key") apiKey: string,
    @Headers("x-forwarded-for") xff: string,
    @Ip() ip: string,
  ) {
    if (!API_KEYS[body.projectId] || apiKey !== API_KEYS[body.projectId]) {
      throw new UnauthorizedException({ ok: false, message: "API key inválida" });
    }
    const realIp = xff?.split(",")[0]?.trim() || ip;
    return this.recordTelemetry.execute({ ...body, ip: realIp });
  }
}
```

#### Módulo — cableado de dependencias

```ts
// telemetry/telemetry.module.ts
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TelemetryController } from "./infrastructure/telemetry.controller";
import { RecordTelemetryUseCase } from "./application/record-telemetry.usecase";
import { TelemetryRepository } from "./domain/telemetry.repository";
import { TypeormTelemetryRepository } from "./infrastructure/typeorm-telemetry.repository";
import { TelemetryEventEntity } from "./infrastructure/telemetry-event.entity";

@Module({
  imports: [TypeOrmModule.forFeature([TelemetryEventEntity])],
  controllers: [TelemetryController],
  providers: [
    RecordTelemetryUseCase,
    // El caso de uso depende del PUERTO; aquí inyectamos el ADAPTADOR.
    { provide: TelemetryRepository, useClass: TypeormTelemetryRepository },
  ],
})
export class TelemetryModule {}
```

### 11.3 Next.js (App Router) — Route Handler

```ts
// app/api/telemetry/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres"; // o tu cliente de BD

export async function POST(req: NextRequest) {
  const p = await req.json();

  // 1. Validar API key.
  const expected = process.env[`APIKEY_${p.projectId}`];
  if (!expected || req.headers.get("x-api-key") !== expected) {
    return NextResponse.json({ ok: false, message: "API key inválida" }, { status: 401 });
  }

  // 2. IP real.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  // 3. Guardar el evento.
  await sql`
    INSERT INTO telemetry_events
      (project_id, event, instance_id, machine_id, version, env, runtime, side,
       hostname, platform, arch, cpus, ip, sent_at)
    VALUES
      (${p.projectId}, ${p.event}, ${p.instanceId}, ${p.machineId}, ${p.version},
       ${p.env}, ${p.runtime}, ${p.side}, ${p.host?.hostname}, ${p.host?.platform},
       ${p.host?.arch}, ${p.host?.cpus}, ${ip}, ${p.sentAt})
  `;

  // 4. (Opcional) Lógica de bloqueo según tu allowlist / cupo.
  const block = false;

  // 5. Responder con el contrato.
  return NextResponse.json({ ok: true, block, message: null });
}
```

### 11.4 PHP / Laravel — Controller + ruta

```php
// routes/api.php
Route::post('/telemetry', [TelemetryController::class, 'store']);
```

```php
// app/Http/Controllers/TelemetryController.php
class TelemetryController extends Controller
{
    public function store(Request $request)
    {
        $p = $request->json()->all();

        // 1. Validar API key.
        $expected = config("guard.keys.{$p['projectId']}");
        if (!$expected || $request->header('x-api-key') !== $expected) {
            return response()->json(['ok' => false, 'message' => 'API key inválida'], 401);
        }

        // 2. IP real.
        $ip = explode(',', $request->header('x-forwarded-for', $request->ip()))[0];

        // 3. Guardar el evento.
        DB::table('telemetry_events')->insert([
            'project_id'  => $p['projectId'],
            'event'       => $p['event'],
            'instance_id' => $p['instanceId'],
            'machine_id'  => $p['machineId'],
            'version'     => $p['version'] ?? null,
            'env'         => $p['env'] ?? null,
            'runtime'     => $p['runtime'] ?? null,
            'side'        => $p['side'] ?? null,
            'hostname'    => $p['host']['hostname'] ?? null,
            'platform'    => $p['host']['platform'] ?? null,
            'arch'        => $p['host']['arch'] ?? null,
            'cpus'        => $p['host']['cpus'] ?? null,
            'ip'          => trim($ip),
            'sent_at'     => $p['sentAt'] ?? null,
            'received_at' => now(),
        ]);

        // 4 y 5. Decidir bloqueo y responder con el contrato.
        return response()->json(['ok' => true, 'block' => false, 'message' => null]);
    }
}
```

> En todos los casos: responde **siempre 200** con el JSON `TelemetryResponse`
> (`{ ok, block, message }`). Si quieres activar el bloqueo, pon `block: true`
> según tu allowlist de `machine_id` o el cupo de instancias del proyecto.

---

## 12. Consideraciones importantes

- **Robustez del enforcement**: el bloqueo desincentiva despliegues no autorizados
  de buena fe, pero alguien con acceso al código puede parchear la librería para
  ignorar `block`. Para algo más fuerte habría que firmar las respuestas, ofuscar,
  o mover lógica crítica al servidor.
- **Privacidad**: se recopilan IP, hostname y características de la máquina. Si lo
  instalan terceros, debe ser transparente (avísalo en tus términos).
- **Volumen**: con `heartbeatMinutes = 15`, cada instancia genera ~96 eventos/día.
  Dimensiona la BD o agrega/recorta eventos antiguos según tu escala.
```
