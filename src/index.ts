import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { homedir } from "node:os";
import { join } from "node:path";
import { TaskQueue, type Task } from "./queue.js";
import { parseWhen } from "./scheduler.js";
import { detectInstaller } from "./daemon/detect.js";

const dbPath =
  process.env.CLAUDE_CRON_DB ??
  join(homedir(), ".claude", "claude-cron.sqlite");

const queue = new TaskQueue(dbPath);

const server = new McpServer({
  name: "claude-cron",
  version: "0.1.0",
});

// --- Helpers ---

function formatTask(task: Task): string {
  const payload = JSON.parse(task.payload);
  const nextRun = task.next_run
    ? new Date(task.next_run * 1000).toLocaleString()
    : "—";
  const lastRun = task.last_run
    ? new Date(task.last_run * 1000).toLocaleString()
    : "—";
  const schedule = task.cron
    ? `cron: ${task.cron}`
    : task.run_at
      ? new Date(task.run_at * 1000).toLocaleString()
      : "—";

  const lines = [
    `**${task.name}** (${task.id})`,
    `  Type: ${task.type} | Status: ${task.status}`,
    `  Schedule: ${schedule}`,
    `  Next run: ${nextRun}`,
    `  Last run: ${lastRun} | Runs: ${task.run_count}`,
  ];

  if (payload.command) lines.push(`  Command: \`${payload.command}\``);
  if (payload.prompt) lines.push(`  Prompt: ${payload.prompt.slice(0, 100)}...`);
  if (payload.message) lines.push(`  Message: ${payload.message.slice(0, 100)}`);

  const notifyVia: string[] = JSON.parse(task.notify_via);
  if (notifyVia.length > 0) {
    lines.push(`  Notify: ${notifyVia.join(", ")}${task.notify_to ? ` → ${task.notify_to}` : ""}`);
  }

  if (task.last_result) {
    const result = JSON.parse(task.last_result);
    lines.push(`  Last result: ${result.success ? "OK" : "FAIL"} (${result.duration_ms}ms)`);
  }

  return lines.join("\n");
}

// --- Tools ---

server.tool(
  "schedule_task",
  "Programa una tarea para ejecutarse en el futuro. Soporta: recordatorios, comandos shell, prompts a Claude/Codex/Copilot. La expresión 'when' acepta lenguaje natural (\"tomorrow 9:00\", \"in 2 hours\"), cron (\"0 8 * * 1\"), ISO 8601, o shortcuts (\"every monday at 8\", \"daily at 9:00\").",
  {
    name: z.string().describe("Nombre descriptivo de la tarea"),
    type: z
      .enum(["reminder", "shell", "claude", "codex", "copilot"])
      .describe("Tipo de tarea: reminder (aviso), shell (comando), claude/codex/copilot (prompt a AI)"),
    when: z
      .string()
      .describe(
        'Cuándo ejecutar. Ejemplos: "tomorrow 9:00", "in 30 minutes", "0 8 * * 1" (cron), "every monday at 8", "2026-03-01T10:00:00"',
      ),
    payload: z
      .object({
        message: z.string().optional().describe("Mensaje del recordatorio (type=reminder)"),
        command: z.string().optional().describe("Comando shell (type=shell)"),
        prompt: z.string().optional().describe("Prompt para AI (type=claude/codex/copilot)"),
        model: z.string().optional().describe("Modelo a usar (ej: haiku, sonnet)"),
        workingDir: z.string().optional().describe("Directorio de trabajo"),
        maxBudgetUsd: z.number().optional().describe("Presupuesto máximo en USD"),
        timeoutMs: z.number().optional().describe("Timeout en milisegundos"),
      })
      .describe("Payload específico según el tipo de tarea"),
    notify: z
      .array(z.enum(["notification", "email", "push"]))
      .optional()
      .describe("Canales de notificación al completar"),
    notifyTo: z.string().optional().describe("Email destino (si notify incluye email)"),
    tags: z.array(z.string()).optional().describe("Tags para filtrado"),
  },
  async ({ name, type, when, payload, notify, notifyTo, tags }) => {
    try {
      const schedule = parseWhen(when);

      const task = queue.create({
        name,
        type,
        run_at: schedule.run_at,
        cron: schedule.cron,
        payload,
        next_run: schedule.next_run,
        notify_via: notify,
        notify_to: notifyTo,
        tags,
        created_by: "claude-code",
      });

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Tarea programada:`,
              "",
              formatTask(task),
              "",
              schedule.cron
                ? `Recurrente — próxima ejecución: ${schedule.human}`
                : `Ejecución única: ${schedule.human}`,
            ].join("\n"),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error programando tarea: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "list_tasks",
  "Lista las tareas programadas. Filtra por estado, próximas a ejecutar, o tags.",
  {
    status: z
      .enum(["pending", "running", "completed", "failed", "cancelled"])
      .optional()
      .describe("Filtrar por estado"),
    upcoming: z.boolean().optional().describe("Solo tareas pendientes, ordenadas por próxima ejecución"),
    tags: z.array(z.string()).optional().describe("Filtrar por tags"),
  },
  async ({ status, upcoming, tags }) => {
    const tasks = queue.list({ status, upcoming, tags });

    if (tasks.length === 0) {
      return {
        content: [{ type: "text" as const, text: "No hay tareas que coincidan con los filtros." }],
      };
    }

    const formatted = tasks.map(formatTask).join("\n\n---\n\n");
    return {
      content: [
        {
          type: "text" as const,
          text: `${tasks.length} tarea(s):\n\n${formatted}`,
        },
      ],
    };
  },
);

server.tool(
  "cancel_task",
  "Cancela una tarea programada.",
  {
    id: z.string().describe("ID de la tarea a cancelar"),
  },
  async ({ id }) => {
    const success = queue.cancel(id);
    return {
      content: [
        {
          type: "text" as const,
          text: success
            ? `Tarea ${id} cancelada.`
            : `No se pudo cancelar la tarea ${id} (no existe o ya está completada/cancelada).`,
        },
      ],
      isError: !success,
    };
  },
);

server.tool(
  "run_now",
  "Ejecuta una tarea inmediatamente, independiente de su schedule.",
  {
    id: z.string().describe("ID de la tarea a ejecutar ahora"),
  },
  async ({ id }) => {
    const task = queue.get(id);
    if (!task) {
      return {
        content: [{ type: "text" as const, text: `Tarea ${id} no encontrada.` }],
        isError: true,
      };
    }

    // Poner next_run a ahora para que el runner la ejecute
    const now = Math.floor(Date.now() / 1000);
    queue.updateNextRun(id, now);

    return {
      content: [
        {
          type: "text" as const,
          text: `Tarea "${task.name}" marcada para ejecución inmediata. El daemon la ejecutará en el próximo ciclo (o ejecuta \`bun run src/runner.ts\` para forzar).`,
        },
      ],
    };
  },
);

server.tool(
  "install_daemon",
  "Instala el daemon de claude-cron como servicio del sistema operativo. En macOS usa launchd, en Linux systemd, en Windows Task Scheduler.",
  {
    checkInterval: z
      .number()
      .optional()
      .describe("Intervalo de comprobación en segundos (default: 60)"),
  },
  async ({ checkInterval }) => {
    try {
      const installer = detectInstaller();
      const result = await installer.install({
        checkIntervalSeconds: checkInterval,
        dbPath,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: [
              result.success ? `Daemon instalado (${installer.platform}):` : "Error:",
              "",
              result.message,
              "",
              result.details ?? "",
            ].join("\n"),
          },
        ],
        isError: !result.success,
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[claude-cron] MCP server started | DB: ${dbPath}`);
}

main().catch((err) => {
  console.error("[claude-cron] Fatal:", err);
  process.exit(1);
});
