# Claude Cron

Tareas diferidas para AI coding assistants. MCP server + daemon que permite a cualquier AI coding assistant programar tareas para el futuro.

## Quickstart

```bash
bun install
bun test          # 38 tests
bun run typecheck # tsc --noEmit
```

## Configuración en Claude Code

Añadir a `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "claude-cron": {
      "command": "bun",
      "args": ["run", "/Users/fernando/code/claude-cron/src/index.ts"],
      "env": {
        "CLAUDE_CRON_DB": "/Users/fernando/.claude/claude-cron.sqlite",
        "GMAIL_ADDRESS": "frr@keepcoding.io",
        "GMAIL_APP_PASSWORD": "op://FRR DEV/...",
        "NTFY_TOPIC": "claude-cron-frr-xxx",
        "NTFY_URL": "https://ntfy.sh"
      }
    }
  }
}
```

## Arquitectura

```
AI Assistant (Claude Code / Codex / Copilot)
    │ stdio (MCP protocol)
    ▼
MCP Server (src/index.ts)          ← CRUD de tareas
    │ SQLite (WAL mode)
    ▼
Runner / Daemon (src/runner.ts)    ← Loop: ejecuta tareas vencidas
    ├─ reminder  → notificación + email + push
    ├─ shell     → Bun.spawn(command)
    ├─ claude    → claude -p --output-format text "prompt"
    ├─ codex     → codex --quiet "prompt"
    └─ copilot   → gh copilot suggest "prompt"
```

## MCP Tools

| Tool | Descripción |
|------|-------------|
| `schedule_task` | Programa una tarea para el futuro |
| `list_tasks` | Lista tareas (filtra por status, upcoming, tags) |
| `cancel_task` | Cancela una tarea por ID |
| `run_now` | Marca una tarea para ejecución inmediata |
| `install_daemon` | Registra el runner como servicio del OS |

### schedule_task

```typescript
{
  name: "Nightly tests",
  type: "shell",              // reminder | shell | claude | codex | copilot
  when: "daily at 3:00",      // ver "Expresiones when" abajo
  payload: {
    command: "cd ~/code/bfclaude && make test",  // shell
    // message: "...",         // reminder
    // prompt: "...",          // claude/codex/copilot
    // model: "haiku",
    // workingDir: "/path",
    // maxBudgetUsd: 0.10,
  },
  notify: ["notification", "email", "push"],
  notifyTo: "frr@keepcoding.io",
  tags: ["ci"],
}
```

### Expresiones `when`

| Tipo | Ejemplos |
|------|----------|
| Lenguaje natural | `"tomorrow 9:00"`, `"in 30 minutes"`, `"next friday at 3pm"` |
| Cron (5 campos) | `"0 9 * * 1"`, `"*/5 * * * *"` |
| ISO 8601 | `"2026-03-01T09:00:00Z"`, `"2026-03-01"` |
| Shortcuts | `"every monday at 8"`, `"daily at 9:00"`, `"every 5 minutes"` |

Parsing: chrono-node (natural) + croner (cron) + regex (shortcuts). Los shortcuts se evalúan antes de chrono-node para que "every monday at 8" no se interprete como fecha puntual.

## Estructura

```
src/
├── index.ts              # Entry point MCP server (5 tools)
├── runner.ts             # Daemon: oneshot (launchd) o --loop (dev)
├── queue.ts              # SQLite: schema, CRUD, getDueTasks
├── scheduler.ts          # parseWhen(): chrono-node + croner + shortcuts
├── adapters/
│   ├── types.ts          # AIAdapter interface
│   ├── claude.ts         # claude -p --output-format text
│   ├── codex.ts          # codex --quiet (stub)
│   └── copilot.ts        # gh copilot suggest (stub)
├── notify/
│   ├── types.ts          # NotificationAdapter interface
│   ├── desktop.ts        # node-notifier (cross-platform)
│   ├── email.ts          # SMTP directo a Gmail (TLS 465)
│   └── push.ts           # ntfy.sh (móvil + Apple Watch)
└── daemon/
    ├── types.ts          # DaemonInstaller interface
    ├── detect.ts         # process.platform → installer
    ├── launchd.ts        # macOS: ~/Library/LaunchAgents/
    ├── systemd.ts        # Linux: ~/.config/systemd/user/
    └── schtasks.ts       # Windows: Task Scheduler
```

## Runner

Dos modos:

```bash
# Oneshot (para launchd StartInterval / systemd timer)
bun run src/runner.ts

# Loop continuo (para dev o KeepAlive)
bun run src/runner.ts --loop
```

El daemon lee SQLite cada 60s (configurable con `CLAUDE_CRON_INTERVAL`), ejecuta tareas vencidas, y envía notificaciones.

Tareas cron se reprograman automáticamente tras completar (next_run recalculado). Tareas puntuales pasan a `completed` o `failed`.

## Daemon

```bash
# Instalar (desde Claude Code via MCP tool install_daemon, o manualmente):
# macOS:
bun run src/daemon/launchd.ts  # genera plist + launchctl load

# Verificar
launchctl list | grep claude-cron
tail -f ~/Library/Logs/claude-cron.log

# Desinstalar
launchctl unload ~/Library/LaunchAgents/com.claude-cron.runner.plist
```

## Notificaciones

| Canal | Requisitos | Env vars |
|-------|-----------|----------|
| Desktop | node-notifier (incluido) | — |
| Email | Gmail App Password | `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD` |
| Push (ntfy) | App ntfy en móvil/watch | `NTFY_TOPIC`, `NTFY_URL` (opt), `NTFY_TOKEN` (opt) |

## Schema SQLite

```sql
tasks (
  id TEXT PRIMARY KEY,          -- nanoid 12 chars
  name, type, status,           -- tipo: reminder|shell|claude|codex|copilot
  run_at INTEGER,               -- Unix ts (puntual)
  cron TEXT,                    -- Expresión cron (recurrente)
  payload TEXT,                 -- JSON según type
  notify_via TEXT,              -- JSON array: ["notification","email","push"]
  notify_to TEXT,               -- Email destino
  next_run, last_run,           -- Timestamps
  run_count, last_result,       -- Ejecuciones + JSON resultado
  created_at, created_by, tags  -- Metadata
)
```

## Dependencias

- `@modelcontextprotocol/sdk` — MCP protocol
- `chrono-node` — Lenguaje natural → Date
- `croner` — Cron parsing + next run
- `nanoid` — IDs cortos
- `node-notifier` — Notificaciones desktop cross-platform
- `zod` — Validación de inputs MCP
- `bun:sqlite` — built-in, zero deps

## TODO

- [ ] Configurar MCP en settings.json reales y probar end-to-end
- [ ] Instalar daemon con `install_daemon` y verificar ciclo completo
- [ ] Configurar ntfy para push al móvil/watch
- [ ] npm publish (nombre TBD)
- [ ] CI con tests en macOS + Linux
- [ ] README con GIFs de uso real
