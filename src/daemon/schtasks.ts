import { homedir } from "node:os";
import { join } from "node:path";
import type { DaemonInstaller, DaemonOptions, DaemonResult } from "./types.js";

const TASK_NAME = "ClaudeCron";

export class SchtasksInstaller implements DaemonInstaller {
  readonly platform = "Windows";

  async install(options: DaemonOptions): Promise<DaemonResult> {
    const bun = options.bunPath ?? join(homedir(), ".bun", "bin", "bun.exe");
    const runner = options.runnerPath ?? join(import.meta.dir, "..", "runner.ts");
    const interval = options.checkIntervalSeconds ?? 60;
    const intervalMinutes = Math.max(1, Math.round(interval / 60));

    const proc = Bun.spawn(
      [
        "schtasks",
        "/Create",
        "/TN",
        TASK_NAME,
        "/TR",
        `"${bun}" run "${runner}"`,
        "/SC",
        "MINUTE",
        "/MO",
        String(intervalMinutes),
        "/F",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    if (proc.exitCode !== 0) {
      return {
        success: false,
        message: `Error creando scheduled task: ${stderr.trim()}`,
      };
    }

    return {
      success: true,
      message: `Scheduled task "${TASK_NAME}" creada (cada ${intervalMinutes} min)`,
      details: [
        `Verificar: schtasks /Query /TN ${TASK_NAME}`,
        `Borrar: schtasks /Delete /TN ${TASK_NAME} /F`,
      ].join("\n"),
    };
  }

  async uninstall(): Promise<DaemonResult> {
    const proc = Bun.spawn(
      ["schtasks", "/Delete", "/TN", TASK_NAME, "/F"],
      { stdout: "pipe", stderr: "pipe" },
    );
    await proc.exited;

    return {
      success: proc.exitCode === 0,
      message:
        proc.exitCode === 0
          ? "Scheduled task eliminada"
          : "No se encontró la scheduled task",
    };
  }

  async status(): Promise<"running" | "stopped" | "not_installed"> {
    const proc = Bun.spawn(
      ["schtasks", "/Query", "/TN", TASK_NAME],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    if (proc.exitCode !== 0) return "not_installed";
    return stdout.includes("Running") ? "running" : "stopped";
  }
}
