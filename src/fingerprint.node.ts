import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as os from "node:os";
import type { Fingerprint } from "./types.js";

/**
 * Genera un machineId estable en Linux/macOS/Windows.
 * Prioriza el machine-id del sistema (no cambia entre reinicios ni IPs).
 * Si no existe, cae a un hash de características del host.
 */
function readMachineId(): string {
  const candidates = ["/etc/machine-id", "/var/lib/dbus/machine-id"];
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf8").trim();
      if (raw) return raw;
    } catch {
      // siguiente candidato
    }
  }

  // Fallback: hash de propiedades razonablemente estables del host.
  const seed = [
    os.hostname(),
    os.platform(),
    os.arch(),
    String(os.totalmem()),
    os.cpus()[0]?.model ?? "",
    // La MAC de la primera interfaz no-interna ayuda a distinguir VPS.
    firstMac(),
  ].join("|");

  return createHash("sha256").update(seed).digest("hex");
}

function firstMac(): string {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] ?? []) {
      if (!ni.internal && ni.mac && ni.mac !== "00:00:00:00:00:00") return ni.mac;
    }
  }
  return "";
}

export function getFingerprint(): Fingerprint {
  // Hasheamos el machine-id para no exponer el identificador crudo del sistema.
  const machineId = createHash("sha256")
    .update(readMachineId())
    .digest("hex")
    .slice(0, 32);

  return {
    machineId,
    runtime: "node",
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
    },
  };
}
