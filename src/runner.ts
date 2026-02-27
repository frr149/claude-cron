import { homedir } from "node:os";
import { join } from "node:path";
import { TaskQueue, type Task, type TaskResult } from "./queue.js";
import { ClaudeAdapter } from "./adapters/claude.js";
import { CodexAdapter } from "./adapters/codex.js";
import { CopilotAdapter } from "./adapters/copilot.js";
import { DesktopNotificationAdapter } from "./notify/desktop.js";
import { EmailNotificationAdapter } from "./notify/email.js";
import { PushNotificationAdapter } from "./notify/push.js";
import type { AIAdapter } from "./adapters/types.js";
import type { NotificationAdapter, NotificationPayload } from "./notify/types.js";

const dbPath =
  process.env.CLAUDE_CRON_DB ??
  join(homedir(), ".claude", "claude-cron.sqlite");

const CHECK_INTERVAL_MS =
  parseInt(process.env.CLAUDE_CRON_INTERVAL ?? "60") * 1000;

const aiAdapters: Record<string, AIAdapter> = {
  claude: new ClaudeAdapter(),
  codex: new CodexAdapter(),
  copilot: new CopilotAdapter(),
};

const notifyAdapters: Record<string, NotificationAdapter> = {
  notification: new DesktopNotificationAdapter(),
  email: new EmailNotificationAdapter(),
  push: new PushNotificationAdapter(),
};

async function executeTask(task: Task): Promise<TaskResult> {
  const payload = JSON.parse(task.payload);
  const start = Date.now();

  switch (task.type) {
    case "reminder": {
      return {
        success: true,
        output: payload.message ?? task.name,
        duration_ms: Date.now() - start,
      };
    }

    case "shell": {
      const command = payload.command;
      if (!command) {
        return { success: false, output: "No command specified", duration_ms: 0 };
      }

      const proc = Bun.spawn(["sh", "-c", command], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: payload.workingDir,
        timeout: payload.timeoutMs ?? 300_000, // 5 min default
      });

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      await proc.exited;

      return {
        success: proc.exitCode === 0,
        output: proc.exitCode === 0 ? stdout.trim() : `STDERR: ${stderr.trim()}\nSTDOUT: ${stdout.trim()}`,
        duration_ms: Date.now() - start,
      };
    }

    case "claude":
    case "codex":
    case "copilot": {
      const adapter = aiAdapters[task.type];
      if (!adapter) {
        return { success: false, output: `No adapter for ${task.type}`, duration_ms: 0 };
      }

      const installed = await adapter.isInstalled();
      if (!installed) {
        return {
          success: false,
          output: `${adapter.cliCommand} no está instalado`,
          duration_ms: 0,
        };
      }

      const result = await adapter.execute(payload.prompt ?? task.name, {
        model: payload.model,
        maxBudgetUsd: payload.maxBudgetUsd,
        timeoutMs: payload.timeoutMs ?? 600_000, // 10 min default
        workingDir: payload.workingDir,
      });

      return {
        success: result.success,
        output: result.output,
        duration_ms: result.durationMs,
      };
    }

    default:
      return { success: false, output: `Unknown task type: ${task.type}`, duration_ms: 0 };
  }
}

async function sendNotifications(task: Task, result: TaskResult): Promise<void> {
  const notifyVia: string[] = JSON.parse(task.notify_via);
  if (notifyVia.length === 0) return;

  const status = result.success ? "completada" : "fallida";
  const payload: NotificationPayload = {
    title: `${task.name} — ${status}`,
    message: result.output.slice(0, 1000), // Limitar tamaño
    taskId: task.id,
    taskName: task.name,
  };

  for (const via of notifyVia) {
    const adapter = via === "email" && task.notify_to
      ? new EmailNotificationAdapter(task.notify_to)
      : notifyAdapters[via];

    if (!adapter) {
      console.error(`[runner] Adapter de notificación desconocido: ${via}`);
      continue;
    }

    try {
      await adapter.send(payload);
    } catch (err) {
      console.error(`[runner] Error enviando ${via}:`, err);
    }
  }
}

async function tick(queue: TaskQueue): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const dueTasks = queue.getDueTasks(now);

  if (dueTasks.length === 0) return;

  console.log(`[runner] ${dueTasks.length} tarea(s) pendiente(s)`);

  for (const task of dueTasks) {
    console.log(`[runner] Ejecutando: ${task.name} (${task.type})`);
    queue.markRunning(task.id);

    try {
      const result = await executeTask(task);
      console.log(
        `[runner] ${task.name}: ${result.success ? "OK" : "FAIL"} (${result.duration_ms}ms)`,
      );

      if (result.success) {
        queue.markCompleted(task.id, result);
      } else {
        queue.markFailed(task.id, result);
      }

      await sendNotifications(task, result);
    } catch (err) {
      const errorResult: TaskResult = {
        success: false,
        output: err instanceof Error ? err.message : String(err),
        duration_ms: 0,
      };
      queue.markFailed(task.id, errorResult);
      console.error(`[runner] Error en ${task.name}:`, err);
    }
  }
}

// Entry point: modo oneshot (para launchd/systemd) o loop continuo
const mode = process.argv.includes("--loop") ? "loop" : "oneshot";

const queue = new TaskQueue(dbPath);
console.log(`[runner] DB: ${dbPath} | Mode: ${mode}`);

if (mode === "loop") {
  // Loop continuo (para desarrollo o KeepAlive)
  const run = async () => {
    while (true) {
      await tick(queue);
      await Bun.sleep(CHECK_INTERVAL_MS);
    }
  };
  run().catch((err) => {
    console.error("[runner] Fatal:", err);
    process.exit(1);
  });
} else {
  // Oneshot: ejecuta una vez y sale (launchd StartInterval lo reinvoca)
  tick(queue)
    .then(() => {
      queue.close();
    })
    .catch((err) => {
      console.error("[runner] Fatal:", err);
      queue.close();
      process.exit(1);
    });
}
