import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import type { DaemonInstaller, DaemonOptions, DaemonResult } from "./types.js";

const LABEL = "com.claude-cron.runner";

function plistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

function defaultBunPath(): string {
  // Bun suele estar en ~/.bun/bin/bun o en PATH
  const homeBun = join(homedir(), ".bun", "bin", "bun");
  if (existsSync(homeBun)) return homeBun;
  return "/opt/homebrew/bin/bun";
}

function generatePlist(options: DaemonOptions): string {
  const bun = options.bunPath ?? defaultBunPath();
  const runner = options.runnerPath ?? join(import.meta.dir, "..", "runner.ts");
  const db = options.dbPath ?? join(homedir(), ".claude", "claude-cron.sqlite");
  const log = options.logPath ?? join(homedir(), "Library", "Logs", "claude-cron.log");
  const interval = options.checkIntervalSeconds ?? 60;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bun}</string>
    <string>run</string>
    <string>${runner}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CLAUDE_CRON_DB</key>
    <string>${db}</string>
  </dict>
  <key>StartInterval</key>
  <integer>${interval}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${log}</string>
  <key>StandardErrorPath</key>
  <string>${log}</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>`;
}

export class LaunchdInstaller implements DaemonInstaller {
  readonly platform = "macOS";

  async install(options: DaemonOptions): Promise<DaemonResult> {
    const path = plistPath();
    const dir = join(homedir(), "Library", "LaunchAgents");

    // Asegurar directorio
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Descargar si ya existe
    if (existsSync(path)) {
      try {
        const proc = Bun.spawn(["launchctl", "unload", path], {
          stdout: "pipe",
          stderr: "pipe",
        });
        await proc.exited;
      } catch { /* ignorar */ }
    }

    // Escribir plist
    const plist = generatePlist(options);
    writeFileSync(path, plist, "utf-8");

    // Cargar
    const proc = Bun.spawn(["launchctl", "load", path], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    if (proc.exitCode !== 0) {
      return {
        success: false,
        message: `Error cargando launchd agent: ${stderr.trim()}`,
      };
    }

    return {
      success: true,
      message: `Daemon instalado en ${path}`,
      details: [
        `Verificar: launchctl list | grep claude-cron`,
        `Logs: tail -f ~/Library/Logs/claude-cron.log`,
        `Parar: launchctl unload ${path}`,
      ].join("\n"),
    };
  }

  async uninstall(): Promise<DaemonResult> {
    const path = plistPath();
    if (!existsSync(path)) {
      return { success: false, message: "Daemon no instalado" };
    }

    const proc = Bun.spawn(["launchctl", "unload", path], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    unlinkSync(path);

    return { success: true, message: "Daemon desinstalado" };
  }

  async status(): Promise<"running" | "stopped" | "not_installed"> {
    if (!existsSync(plistPath())) return "not_installed";

    const proc = Bun.spawn(["launchctl", "list"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    return stdout.includes(LABEL) ? "running" : "stopped";
  }
}
