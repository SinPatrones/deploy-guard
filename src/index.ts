import { createGuard } from "./core.js";
import { getFingerprint } from "./fingerprint.node.js";

/** Punto de entrada para Node.js (VPS, servidores). */
export const initGuard = createGuard(getFingerprint);

export { DeployBlockedError } from "./core.js";
export type {
  GuardConfig,
  GuardHandle,
  GuardEvent,
  AppSide,
  BlockAction,
  TelemetryPayload,
  TelemetryResponse,
  Fingerprint,
  HostInfo,
} from "./types.js";
