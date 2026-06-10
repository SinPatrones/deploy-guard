import type {
  Fingerprint,
  GuardConfig,
  GuardEvent,
  GuardHandle,
  TelemetryPayload,
  TelemetryResponse,
} from "./types.js";

/** Error lanzado cuando onBlock === "throw" y el servidor ordena bloqueo. */
export class DeployBlockedError extends Error {
  readonly response: TelemetryResponse;
  constructor(response: TelemetryResponse) {
    super(response.message || "Despliegue bloqueado por el servidor de control");
    this.name = "DeployBlockedError";
    this.response = response;
  }
}

function genId(): string {
  // crypto.randomUUID está en Node >=16 y navegadores modernos.
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Construye la función pública initGuard inyectando el adaptador de fingerprint
 * correspondiente al entorno (node o browser). Toda la lógica común vive aquí.
 */
export function createGuard(loadFingerprint: () => Promise<Fingerprint> | Fingerprint) {
  return function initGuard(config: GuardConfig): GuardHandle {
    const {
      endpoint,
      projectId,
      apiKey,
      version = "unknown",
      heartbeatMinutes = 15,
      timeoutMs = 3000,
      onBlock = "warn",
      onBlockCallback,
      debug = false,
    } = config;

    const env =
      config.env ??
      (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
        ?.NODE_ENV ??
      "production";

    const instanceId = genId();
    let fingerprint: Fingerprint | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    const state = {
      lastResponse: null as TelemetryResponse | null,
      blocked: false,
    };

    const log = (...args: unknown[]) => {
      if (debug) console.log("[deploy-guard]", ...args);
    };

    function applyBlock(res: TelemetryResponse) {
      state.blocked = true;
      if (onBlock === "callback") {
        onBlockCallback?.(res);
      } else if (onBlock === "warn") {
        console.warn("[deploy-guard] BLOQUEO:", res.message ?? "instancia no autorizada");
      } else if (onBlock === "throw") {
        throw new DeployBlockedError(res);
      }
    }

    async function send(event: GuardEvent): Promise<TelemetryResponse | null> {
      try {
        if (!fingerprint) fingerprint = await loadFingerprint();

        // side: override explícito o autodetección desde el runtime.
        const side = config.side ?? (fingerprint.runtime === "node" ? "backend" : "frontend");

        const payload: TelemetryPayload = {
          projectId,
          event,
          instanceId,
          machineId: fingerprint.machineId,
          version,
          env,
          runtime: fingerprint.runtime,
          side,
          host: fingerprint.host,
          sentAt: new Date().toISOString(),
        };

        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), timeoutMs);

        const headers: Record<string, string> = { "content-type": "application/json" };
        if (apiKey) headers["x-api-key"] = apiKey;

        const resp = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
          // En navegador evita arrastrar cookies de sesión del usuario.
          credentials: "omit",
          keepalive: event === "shutdown",
        }).finally(() => clearTimeout(t));

        if (!resp.ok) {
          log(`servidor respondió ${resp.status}`);
          return null;
        }

        const data = (await resp.json().catch(() => null)) as TelemetryResponse | null;
        if (data) {
          state.lastResponse = data;
          log(`evento ${event} ok`, data);
          // El bloqueo solo ocurre con orden EXPLÍCITA del servidor.
          // Un fallo de red nunca debe apagar una app legítima.
          if (data.block === true) applyBlock(data);
        }
        return data;
      } catch (err) {
        // Silencioso por diseño: la telemetría nunca debe romper al cliente.
        log("error de envío (ignorado):", (err as Error)?.message);
        return null;
      }
    }

    function startHeartbeat() {
      if (heartbeatMinutes <= 0) return;
      timer = setInterval(() => {
        void send("heartbeat");
      }, heartbeatMinutes * 60_000);
      // En Node, no mantener vivo el proceso solo por el heartbeat.
      (timer as unknown as { unref?: () => void }).unref?.();
    }

    // Arranque: dispara startup y, si todo va bien, programa el heartbeat.
    void send("startup").then(() => {
      if (!stopped) startHeartbeat();
    });

    // En navegador, intenta avisar al cerrar la pestaña.
    const w = globalThis as { addEventListener?: (e: string, cb: () => void) => void };
    if (typeof w.addEventListener === "function") {
      w.addEventListener("pagehide", () => void send("shutdown"));
    }

    return {
      async stop() {
        stopped = true;
        if (timer) clearInterval(timer);
        await send("shutdown");
      },
      ping() {
        return send("heartbeat");
      },
      get lastResponse() {
        return state.lastResponse;
      },
      get blocked() {
        return state.blocked;
      },
    };
  };
}
