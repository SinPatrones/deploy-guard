import { createGuard } from "./core.js";
import { getFingerprint } from "./fingerprint.browser.js";

/** Punto de entrada para el navegador. */
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
