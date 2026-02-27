import type { DaemonInstaller } from "./types.js";
import { LaunchdInstaller } from "./launchd.js";
import { SystemdInstaller } from "./systemd.js";
import { SchtasksInstaller } from "./schtasks.js";

export function detectInstaller(): DaemonInstaller {
  switch (process.platform) {
    case "darwin":
      return new LaunchdInstaller();
    case "linux":
      return new SystemdInstaller();
    case "win32":
      return new SchtasksInstaller();
    default:
      throw new Error(`Plataforma no soportada: ${process.platform}`);
  }
}
