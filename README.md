# deploy-guard

Agente ligero de **telemetría y control de despliegues**. Se integra en tu proyecto
con una línea y reporta a un endpoint central (p. ej. `miempresa360.com`) cada vez
que el proyecto arranca y mientras sigue vivo. Permite además **bloqueo remoto
opcional** de instancias no autorizadas.

- ✅ Funciona en **backend (Node.js)** y **frontend (navegador)** — autodetección.
- ✅ Distingue cada señal con `side: "backend" | "frontend"`.
- ✅ Heartbeat periódico para saber qué instancias están **activas ahora**.
- ✅ Identifica cada VPS con un `machineId` estable (sobrevive a reinicios y cambios de IP).
- ✅ **Nunca rompe ni frena** tu app: todo es asíncrono y con fallo silencioso.
- ✅ Cero dependencias en runtime (usa `fetch` nativo).

> 📄 El contrato completo de qué se envía y qué responde el servidor está en
> [`docs/TELEMETRIA.md`](./docs/TELEMETRIA.md).

---

## Instalación

```bash
npm install deploy-guard
```

Requiere **Node.js >= 18** (por `fetch` nativo). En navegador funciona en cualquier
bundler moderno (Vite, webpack, Next.js, etc.); el `exports` del paquete resuelve
automáticamente la build correcta para cada entorno.

---

## Uso rápido

```ts
import { initGuard } from "deploy-guard";

initGuard({
  endpoint: "https://miempresa360.com/api/telemetry",
  projectId: "cliente-acme",
  apiKey: "TU_CLAVE",
});
```

Con eso ya envía un evento `startup` al arrancar y un `heartbeat` cada 15 minutos.

---

## Ejemplos por entorno

### Backend — Node.js / Express

```ts
// server.ts
import express from "express";
import { initGuard } from "deploy-guard";

const guard = initGuard({
  endpoint: "https://miempresa360.com/api/telemetry",
  projectId: "cliente-acme",
  apiKey: process.env.GUARD_API_KEY,
  version: process.env.npm_package_version, // versión de tu app
  heartbeatMinutes: 15,
  onBlock: "warn",
});

const app = express();
app.get("/", (_req, res) => res.send("ok"));

const server = app.listen(3000);

// Apagado limpio: avisa al servidor central.
process.on("SIGTERM", async () => {
  await guard.stop();
  server.close();
});
```

→ Reporta con `side: "backend"`, `runtime: "node"` y los datos del VPS
(`hostname`, `platform`, `arch`, `cpus`, `machineId` estable).

### Backend — NestJS

```ts
// main.ts
import { initGuard } from "deploy-guard";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  initGuard({
    endpoint: "https://miempresa360.com/api/telemetry",
    projectId: "cliente-acme",
    apiKey: process.env.GUARD_API_KEY,
  });

  await app.listen(3000);
}
bootstrap();
```

### Frontend — app de navegador (Vite / React / Vue / vanilla)

```ts
// main.ts (punto de entrada de tu app web)
import { initGuard } from "deploy-guard";

initGuard({
  endpoint: "https://miempresa360.com/api/telemetry",
  projectId: "cliente-acme",
  apiKey: import.meta.env.VITE_GUARD_API_KEY,
  version: __APP_VERSION__,
});
```

→ Reporta con `side: "frontend"`, `runtime: "browser"`, usando el dominio como
`hostname` y un id persistido en `localStorage`. Intenta un `shutdown` al cerrar
la pestaña (best-effort).

### Next.js (SSR + cliente)

Como Next corre en Node y en navegador, puedes inicializarlo en ambos lados.
Si quieres marcar el render de servidor como `frontend`, usa el override `side`:

```ts
// instrumentación de servidor (p. ej. instrumentation.ts)
import { initGuard } from "deploy-guard";

initGuard({
  endpoint: "https://miempresa360.com/api/telemetry",
  projectId: "cliente-acme",
  side: "frontend", // fuerza la clasificación aunque corra en Node
});
```

---

## API

### `initGuard(config): GuardHandle`

Arranca el agente. Devuelve un handle para controlar su ciclo de vida.

#### `config`

| Opción             | Tipo                                   | Por defecto                      | Descripción                                                            |
|--------------------|----------------------------------------|----------------------------------|------------------------------------------------------------------------|
| `endpoint`         | `string` **(requerido)**               | —                                | URL del endpoint receptor.                                            |
| `projectId`        | `string` **(requerido)**               | —                                | Identificador del proyecto/cliente.                                  |
| `apiKey`           | `string`                               | —                                | Se envía como cabecera `x-api-key`.                                   |
| `version`          | `string`                               | `"unknown"`                      | Versión de tu proyecto.                                              |
| `env`              | `string`                               | `NODE_ENV` o `"production"`      | Entorno lógico.                                                      |
| `side`             | `"backend" \| "frontend"`              | autodetectado por runtime        | Override de la clasificación backend/frontend.                       |
| `heartbeatMinutes` | `number`                               | `15`                             | Minutos entre heartbeats. `0` desactiva el heartbeat.               |
| `timeoutMs`        | `number`                               | `3000`                           | Timeout de cada request.                                            |
| `onBlock`          | `"warn" \| "throw" \| "callback"`      | `"warn"`                         | Qué hacer si el servidor responde `block: true`.                    |
| `onBlockCallback`  | `(res) => void`                        | —                                | Callback usado cuando `onBlock === "callback"`.                      |
| `debug`            | `boolean`                              | `false`                          | Loguea la actividad interna del agente.                             |

#### `GuardHandle`

| Miembro          | Tipo                                      | Descripción                                            |
|------------------|-------------------------------------------|--------------------------------------------------------|
| `stop()`         | `() => Promise<void>`                     | Detiene el heartbeat y envía un `shutdown`.            |
| `ping()`         | `() => Promise<TelemetryResponse \| null>`| Fuerza un heartbeat inmediato.                        |
| `lastResponse`   | `TelemetryResponse \| null`               | Última respuesta del servidor.                        |
| `blocked`        | `boolean`                                 | `true` si la última respuesta ordenó bloqueo.         |

---

## Bloqueo remoto (enforcement opcional)

Si el servidor responde `{ "ok": true, "block": true, "message": "..." }`, la
librería actúa según `onBlock`:

```ts
import { initGuard, DeployBlockedError } from "deploy-guard";

try {
  const guard = initGuard({
    endpoint: "https://miempresa360.com/api/telemetry",
    projectId: "cliente-acme",
    onBlock: "throw", // lanza DeployBlockedError si el server bloquea
  });
} catch (err) {
  if (err instanceof DeployBlockedError) {
    console.error("Despliegue no autorizado:", err.message);
    process.exit(1);
  }
}
```

O con callback, para tu propia lógica:

```ts
initGuard({
  endpoint: "https://miempresa360.com/api/telemetry",
  projectId: "cliente-acme",
  onBlock: "callback",
  onBlockCallback: (res) => {
    // mostrar un aviso, deshabilitar funciones, etc.
    console.warn("Bloqueado:", res.message);
  },
});
```

> ⚠️ El bloqueo **solo** ocurre con una orden explícita del servidor. Un fallo de
> red o un timeout **nunca** bloquea, para no apagar apps legítimas si el endpoint
> está caído. Ten en cuenta que un cliente con acceso al código puede parchear la
> librería para ignorar el bloqueo; sirve contra despliegues no autorizados de
> buena fe, no contra un atacante decidido.

---

## ¿Qué envía exactamente?

Resumen del payload (detalle completo en [`docs/TELEMETRIA.md`](./docs/TELEMETRIA.md)):

```jsonc
{
  "projectId": "cliente-acme",
  "event": "startup",            // startup | heartbeat | shutdown
  "instanceId": "uuid-por-arranque",
  "machineId": "hash-estable-del-vps",
  "version": "1.2.0",
  "env": "production",
  "runtime": "node",             // node | browser
  "side": "backend",             // backend | frontend
  "host": { "hostname": "...", "platform": "linux", "arch": "x64", "cpus": 4 },
  "sentAt": "2026-06-09T12:00:00.000Z"
}
```

La IP pública **no** la manda el cliente: la lees en el servidor desde
`X-Forwarded-For`.

---

## Desarrollo

```bash
npm install      # dependencias de build (tsup, typescript)
npm run build    # genera dist/ (ESM + CJS + tipos)
npm run typecheck
npm run dev      # build en watch
```

---

## Licencia

MIT
