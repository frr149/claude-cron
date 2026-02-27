import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import type { DaemonInstaller, DaemonOptions, DaemonResult } from "./types.js";

const SERVICE_NAME = "claude-cron";

function unitDir(): string {
  return join(homedir(), ".config", "systemd", "user");
}

function servicePath(): string {
  return join(unitDir(), `${SERVICE_NAME}.service`);
}

function timerPath(): string {
  return join(unitDir(), `${SERVICE_NAME}.timer`);
}

function generateService(options: DaemonOptions): string {
  const bun = options.bunPath ?? join(homedir(), ".bun", "bin", "bun");
  const runner = options.runnerPath ?? join(import.meta.dir, "..", "runner.ts");
  const db = options.dbPath ?? join(homedir(), ".claude", "claude-cron.sqlite");

  return `[Unit]
Description=Claude Cron — deferred task runner
After=default.target

[Service]
Type=oneshot
ExecStart=${bun} run ${runner}
Environment=CLAUDE_CRON_DB=${db}

[Install]
WantedBy=default.target
`;
}

function generateTimer(options: DaemonOptions): string {
  const interval = options.checkIntervalSeconds ?? 60;
  return `[Unit]
Description=Claude Cron timer

[Timer]
OnBootSec=30
OnUnitActiveSec=${interval}
AccuracySec=5

[Install]
WantedBy=timers.target
`;
}

export class SystemdInstaller implements DaemonInstaller {
  readonly platform = "Linux";

  async install(options: DaemonOptions): Promise<DaemonResult> {
    const dir = unitDir();
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(servicePath(), generateService(options), "utf-8");
    writeFileSync(timerPath(), generateTimer(options), "utf-8");

    // Reload y activar timer
    const reload = Bun.spawn(["systemctl", "--user", "daemon-reload"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await reload.exited;

    const enable = Bun.spawn(
      ["systemctl", "--user", "enable", "--now", `${SERVICE_NAME}.timer`],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stderr = await new Response(enable.stderr).text();
    await enable.exited;

    if (enable.exitCode !== 0) {
      return {
        success: false,
        message: `Error activando timer: ${stderr.trim()}`,
      };
    }

    return {
      success: true,
      message: `Daemon instalado (systemd user timer)`,
      details: [
        `Verificar: systemctl --user status ${SERVICE_NAME}.timer`,
        `Logs: journalctl --user -u ${SERVICE_NAME} -f`,
        `Parar: systemctl --user disable --now ${SERVICE_NAME}.timer`,
      ].join("\n"),
    };
  }

  async uninstall(): Promise<DaemonResult> {
    const proc = Bun.spawn(
      ["systemctl", "--user", "disable", "--now", `${SERVICE_NAME}.timer`],
      { stdout: "pipe", stderr: "pipe" },
    );
    await proc.exited;

    if (existsSync(servicePath())) unlinkSync(servicePath());
    if (existsSync(timerPath())) unlinkSync(timerPath());

    const reload = Bun.spawn(["systemctl", "--user", "daemon-reload"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await reload.exited;

    return { success: true, message: "Daemon desinstalado" };
  }

  async status(): Promise<"running" | "stopped" | "not_installed"> {
    if (!existsSync(timerPath())) return "not_installed";

    const proc = Bun.spawn(
      ["systemctl", "--user", "is-active", `${SERVICE_NAME}.timer`],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    return stdout.trim() === "active" ? "running" : "stopped";
  }
}
