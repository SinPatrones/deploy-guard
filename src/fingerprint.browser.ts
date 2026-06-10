import type { Fingerprint } from "./types.js";

const STORAGE_KEY = "deploy_guard_mid";

/**
 * En el navegador no existe machine-id. Persistimos un id aleatorio en
 * localStorage para reconocer la misma instalación entre recargas.
 * Es menos fiable que en Node (el usuario puede limpiar el storage),
 * pero suficiente para contar instalaciones/dominios activos.
 */
function readOrCreateId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const id = genRandom();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    // Storage no disponible (modo privado, SSR parcial, etc.).
    return genRandom();
  }
}

function genRandom(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function getFingerprint(): Fingerprint {
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  const loc = (globalThis as { location?: Location }).location;

  return {
    machineId: readOrCreateId(),
    runtime: "browser",
    host: {
      // En navegador usamos el dominio como "hostname" lógico.
      hostname: loc?.hostname ?? "browser",
      platform: nav?.platform ?? nav?.userAgent ?? "browser",
      arch: "web",
      cpus: nav?.hardwareConcurrency ?? 0,
    },
  };
}
