/** Tipo de evento reportado al servidor central. */
export type GuardEvent = "startup" | "heartbeat" | "shutdown";

/** Lado de la aplicación: servidor (backend) o cliente/navegador (frontend). */
export type AppSide = "backend" | "frontend";

/** Qué hacer cuando el servidor responde `block: true`. */
export type BlockAction = "throw" | "warn" | "callback";

/** Información de la máquina/instancia donde corre el proyecto supervisado. */
export interface HostInfo {
  hostname: string;
  platform: string;
  arch: string;
  cpus: number;
}

/** Fingerprint del entorno, resuelto por el adaptador node o browser. */
export interface Fingerprint {
  /** Identificador estable de la máquina/navegador (sobrevive a reinicios). */
  machineId: string;
  runtime: "node" | "browser";
  host: HostInfo;
}

/** Payload que viaja en cada POST al endpoint receptor. */
export interface TelemetryPayload {
  projectId: string;
  event: GuardEvent;
  instanceId: string;
  machineId: string;
  version: string;
  env: string;
  /** Entorno de ejecución técnico. */
  runtime: "node" | "browser";
  /** Lado de la app: backend o frontend (autodetectado u overridable). */
  side: AppSide;
  host: HostInfo;
  sentAt: string;
}

/** Respuesta esperada del endpoint receptor. */
export interface TelemetryResponse {
  ok: boolean;
  /** Si es true, la instancia debe considerarse no autorizada. */
  block?: boolean;
  /** Mensaje legible (motivo del bloqueo, aviso, etc.). */
  message?: string | null;
}

export interface GuardConfig {
  /** URL completa del endpoint receptor en miempresa360.com. */
  endpoint: string;
  /** Identificador del proyecto/cliente. Tú lo asignas. */
  projectId: string;
  /** Clave de API para autenticar el reporte (cabecera x-api-key). */
  apiKey?: string;
  /** Versión del proyecto supervisado. Por defecto "unknown". */
  version?: string;
  /** Entorno lógico. Por defecto process.env.NODE_ENV || "production". */
  env?: string;
  /**
   * Lado de la app. Si se omite, se autodetecta: node → "backend",
   * browser → "frontend". Úsalo para casos especiales (p. ej. un Node de SSR
   * que quieras contabilizar como "frontend").
   */
  side?: AppSide;
  /** Minutos entre heartbeats. 0 desactiva el heartbeat. Por defecto 15. */
  heartbeatMinutes?: number;
  /** Timeout de cada request en ms. Por defecto 3000. */
  timeoutMs?: number;
  /** Qué hacer si el servidor ordena bloquear. Por defecto "warn". */
  onBlock?: BlockAction;
  /** Callback invocado cuando onBlock === "callback". */
  onBlockCallback?: (res: TelemetryResponse) => void;
  /** Loguea actividad interna para depurar. Por defecto false. */
  debug?: boolean;
}

/** Controlador devuelto por initGuard para gestionar el ciclo de vida. */
export interface GuardHandle {
  /** Detiene el heartbeat y envía un evento shutdown best-effort. */
  stop: () => Promise<void>;
  /** Fuerza el envío inmediato de un heartbeat. */
  ping: () => Promise<TelemetryResponse | null>;
  /** Última respuesta recibida del servidor. */
  readonly lastResponse: TelemetryResponse | null;
  /** true si la última respuesta ordenó bloqueo. */
  readonly blocked: boolean;
}
