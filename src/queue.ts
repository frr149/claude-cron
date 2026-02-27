import { Database } from "bun:sqlite";
import { nanoid } from "nanoid";

export type TaskType = "reminder" | "shell" | "claude" | "codex" | "copilot";
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface Task {
  id: string;
  name: string;
  type: TaskType;
  status: TaskStatus;
  run_at: number | null;
  cron: string | null;
  payload: string; // JSON
  notify_via: string; // JSON array
  notify_to: string | null;
  next_run: number | null;
  last_run: number | null;
  run_count: number;
  last_result: string | null; // JSON
  created_at: number;
  created_by: string | null;
  tags: string; // JSON array
}

export interface TaskInput {
  name: string;
  type: TaskType;
  run_at?: number | null;
  cron?: string | null;
  payload: Record<string, unknown>;
  notify_via?: string[];
  notify_to?: string;
  next_run?: number | null;
  created_by?: string;
  tags?: string[];
}

export interface TaskResult {
  success: boolean;
  output: string;
  duration_ms: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK(type IN ('reminder','shell','claude','codex','copilot')),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','cancelled')),
  run_at      INTEGER,
  cron        TEXT,
  payload     TEXT NOT NULL,
  notify_via  TEXT DEFAULT '[]',
  notify_to   TEXT,
  next_run    INTEGER,
  last_run    INTEGER,
  run_count   INTEGER DEFAULT 0,
  last_result TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  created_by  TEXT,
  tags        TEXT DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_tasks_next_run ON tasks(next_run) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
`;

export class TaskQueue {
  private db: Database;

  constructor(dbPath: string = ":memory:") {
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(SCHEMA);
  }

  create(input: TaskInput): Task {
    const id = nanoid(12);
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, name, type, run_at, cron, payload, notify_via, notify_to, next_run, created_by, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      input.name,
      input.type,
      input.run_at ?? null,
      input.cron ?? null,
      JSON.stringify(input.payload),
      JSON.stringify(input.notify_via ?? []),
      input.notify_to ?? null,
      input.next_run ?? input.run_at ?? null,
      input.created_by ?? null,
      JSON.stringify(input.tags ?? []),
    );
    return this.get(id)!;
  }

  get(id: string): Task | null {
    const stmt = this.db.prepare("SELECT * FROM tasks WHERE id = ?");
    return stmt.get(id) as Task | null;
  }

  list(filters?: { status?: TaskStatus; upcoming?: boolean; tags?: string[] }): Task[] {
    let query = "SELECT * FROM tasks WHERE 1=1";
    const params: string[] = [];

    if (filters?.status) {
      query += " AND status = ?";
      params.push(filters.status);
    }

    if (filters?.upcoming) {
      query += " AND status = 'pending' AND next_run IS NOT NULL";
      query += " ORDER BY next_run ASC";
    } else {
      query += " ORDER BY created_at DESC";
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Task[];

    if (filters?.tags && filters.tags.length > 0) {
      return rows.filter((row) => {
        const rowTags: string[] = JSON.parse(row.tags);
        return filters.tags!.some((t) => rowTags.includes(t));
      });
    }

    return rows;
  }

  getDueTasks(now: number = Math.floor(Date.now() / 1000)): Task[] {
    const stmt = this.db.prepare(
      "SELECT * FROM tasks WHERE status = 'pending' AND next_run IS NOT NULL AND next_run <= ? ORDER BY next_run ASC",
    );
    return stmt.all(now) as Task[];
  }

  markRunning(id: string): void {
    this.db.prepare("UPDATE tasks SET status = 'running' WHERE id = ?").run(id);
  }

  markCompleted(id: string, result: TaskResult): void {
    const now = Math.floor(Date.now() / 1000);
    const task = this.get(id);
    if (!task) return;

    if (task.cron) {
      // Recurrente: calcular next_run y volver a pending
      const { Cron } = require("croner") as typeof import("croner");
      const job = new Cron(task.cron);
      const nextDate = job.nextRun();
      const nextRun = nextDate ? Math.floor(nextDate.getTime() / 1000) : null;

      this.db
        .prepare(
          `UPDATE tasks SET status = 'pending', last_run = ?, run_count = run_count + 1,
         last_result = ?, next_run = ? WHERE id = ?`,
        )
        .run(now, JSON.stringify(result), nextRun, id);
    } else {
      this.db
        .prepare(
          `UPDATE tasks SET status = 'completed', last_run = ?, run_count = run_count + 1,
         last_result = ? WHERE id = ?`,
        )
        .run(now, JSON.stringify(result), id);
    }
  }

  markFailed(id: string, result: TaskResult): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `UPDATE tasks SET status = 'failed', last_run = ?, run_count = run_count + 1,
       last_result = ? WHERE id = ?`,
      )
      .run(now, JSON.stringify(result), id);
  }

  cancel(id: string): boolean {
    const task = this.get(id);
    if (!task || task.status === "cancelled" || task.status === "completed") return false;
    this.db.prepare("UPDATE tasks SET status = 'cancelled' WHERE id = ?").run(id);
    return true;
  }

  updateNextRun(id: string, nextRun: number | null): void {
    this.db.prepare("UPDATE tasks SET next_run = ? WHERE id = ?").run(nextRun, id);
  }

  close(): void {
    this.db.close();
  }
}
