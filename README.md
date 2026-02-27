# Claude Cron

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1.svg)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org)

Deferred tasks for AI coding assistants. MCP server + daemon that allows any AI coding assistant to schedule tasks for the future.

## Quickstart

```bash
bun install
bun test          # 38 tests
bun run typecheck # tsc --noEmit
```

## Claude Code Configuration

Add to `~/.claude/settings.json`:

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

## Architecture

```
AI Assistant (Claude Code / Codex / Copilot)
    │ stdio (MCP protocol)
    ▼
MCP Server (src/index.ts)          ← Task CRUD
    │ SQLite (WAL mode)
    ▼
Runner / Daemon (src/runner.ts)    ← Loop: executes due tasks
    ├─ reminder  → notification + email + push
    ├─ shell     → Bun.spawn(command)
    ├─ claude    → claude -p --output-format text "prompt"
    ├─ codex     → codex --quiet "prompt"
    └─ copilot   → gh copilot suggest "prompt"
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `schedule_task` | Schedule a task for the future |
| `list_tasks` | List tasks (filter by status, upcoming, tags) |
| `cancel_task` | Cancel a task by ID |
| `run_now` | Mark a task for immediate execution |
| `install_daemon` | Register the runner as an OS service |

### schedule_task

```typescript
{
  name: "Nightly tests",
  type: "shell",              // reminder | shell | claude | codex | copilot
  when: "daily at 3:00",      // see "When expressions" below
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

### `when` Expressions

| Type | Examples |
|------|----------|
| Natural language | `"tomorrow 9:00"`, `"in 30 minutes"`, `"next friday at 3pm"` |
| Cron (5 fields) | `"0 9 * * 1"`, `"*/5 * * * *"` |
| ISO 8601 | `"2026-03-01T09:00:00Z"`, `"2026-03-01"` |
| Shortcuts | `"every monday at 8"`, `"daily at 9:00"`, `"every 5 minutes"` |

Parsing: chrono-node (natural) + croner (cron) + regex (shortcuts). Shortcuts are evaluated before chrono-node so that "every monday at 8" is not interpreted as a single date.

## Structure

```
src/
├── index.ts              # MCP server entry point (5 tools)
├── runner.ts             # Daemon: oneshot (launchd) or --loop (dev)
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
│   ├── email.ts          # Direct SMTP to Gmail (TLS 465)
│   └── push.ts           # ntfy.sh (mobile + Apple Watch)
└── daemon/
    ├── types.ts          # DaemonInstaller interface
    ├── detect.ts         # process.platform → installer
    ├── launchd.ts        # macOS: ~/Library/LaunchAgents/
    ├── systemd.ts        # Linux: ~/.config/systemd/user/
    └── schtasks.ts       # Windows: Task Scheduler
```

## Runner

Two modes:

```bash
# Oneshot (for launchd StartInterval / systemd timer)
bun run src/runner.ts

# Continuous loop (for dev or KeepAlive)
bun run src/runner.ts --loop
```

The daemon reads SQLite every 60s (configurable via `CLAUDE_CRON_INTERVAL`), executes due tasks, and sends notifications.

Cron tasks are automatically rescheduled after completion (next_run recalculated). One-off tasks transition to `completed` or `failed`.

## Daemon

```bash
# Install (from Claude Code via MCP tool install_daemon, or manually):
# macOS:
bun run src/daemon/launchd.ts  # generates plist + launchctl load

# Verify
launchctl list | grep claude-cron
tail -f ~/Library/Logs/claude-cron.log

# Uninstall
launchctl unload ~/Library/LaunchAgents/com.claude-cron.runner.plist
```

## Notifications

| Channel | Requirements | Env vars |
|---------|-------------|----------|
| Desktop | node-notifier (included) | — |
| Email | Gmail App Password | `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD` |
| Push (ntfy) | ntfy app on mobile/watch | `NTFY_TOPIC`, `NTFY_URL` (opt), `NTFY_TOKEN` (opt) |

## SQLite Schema

```sql
tasks (
  id TEXT PRIMARY KEY,          -- nanoid 12 chars
  name, type, status,           -- type: reminder|shell|claude|codex|copilot
  run_at INTEGER,               -- Unix ts (one-off)
  cron TEXT,                    -- Cron expression (recurring)
  payload TEXT,                 -- JSON per type
  notify_via TEXT,              -- JSON array: ["notification","email","push"]
  notify_to TEXT,               -- Destination email
  next_run, last_run,           -- Timestamps
  run_count, last_result,       -- Executions + JSON result
  created_at, created_by, tags  -- Metadata
)
```

## Dependencies

- `@modelcontextprotocol/sdk` — MCP protocol
- `chrono-node` — Natural language → Date
- `croner` — Cron parsing + next run
- `nanoid` — Short IDs
- `node-notifier` — Cross-platform desktop notifications
- `zod` — MCP input validation
- `bun:sqlite` — built-in, zero deps

## TODO

- [ ] Configure MCP in real settings.json and test end-to-end
- [ ] Install daemon with `install_daemon` and verify full cycle
- [ ] Set up ntfy for push to mobile/watch
- [ ] npm publish (name TBD)
- [ ] CI with tests on macOS + Linux
- [ ] README with real usage GIFs
