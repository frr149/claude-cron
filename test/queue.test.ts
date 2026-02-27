import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { TaskQueue } from "../src/queue.js";

describe("TaskQueue", () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue(":memory:");
  });

  afterEach(() => {
    queue.close();
  });

  describe("create", () => {
    it("crea una tarea con todos los campos", () => {
      const task = queue.create({
        name: "Test reminder",
        type: "reminder",
        run_at: 1700000000,
        payload: { message: "Hola mundo" },
        notify_via: ["notification"],
        tags: ["test"],
        created_by: "claude-code",
      });

      expect(task.id).toHaveLength(12);
      expect(task.name).toBe("Test reminder");
      expect(task.type).toBe("reminder");
      expect(task.status).toBe("pending");
      expect(task.run_at).toBe(1700000000);
      expect(task.next_run).toBe(1700000000);
      expect(JSON.parse(task.payload)).toEqual({ message: "Hola mundo" });
      expect(JSON.parse(task.notify_via)).toEqual(["notification"]);
      expect(JSON.parse(task.tags)).toEqual(["test"]);
      expect(task.created_by).toBe("claude-code");
      expect(task.run_count).toBe(0);
    });

    it("genera IDs únicos", () => {
      const t1 = queue.create({ name: "A", type: "reminder", payload: {} });
      const t2 = queue.create({ name: "B", type: "reminder", payload: {} });
      expect(t1.id).not.toBe(t2.id);
    });

    it("defaults: notify_via vacío, tags vacío", () => {
      const task = queue.create({ name: "Test", type: "shell", payload: { command: "ls" } });
      expect(JSON.parse(task.notify_via)).toEqual([]);
      expect(JSON.parse(task.tags)).toEqual([]);
      expect(task.notify_to).toBeNull();
      expect(task.created_by).toBeNull();
    });
  });

  describe("get", () => {
    it("devuelve null para ID inexistente", () => {
      expect(queue.get("nonexistent")).toBeNull();
    });

    it("devuelve la tarea por ID", () => {
      const created = queue.create({ name: "Find me", type: "reminder", payload: {} });
      const found = queue.get(created.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe("Find me");
    });
  });

  describe("list", () => {
    it("lista todas las tareas sin filtros", () => {
      queue.create({ name: "A", type: "reminder", payload: {} });
      queue.create({ name: "B", type: "shell", payload: { command: "ls" } });
      const all = queue.list();
      expect(all).toHaveLength(2);
    });

    it("filtra por status", () => {
      const t = queue.create({ name: "A", type: "reminder", payload: {}, run_at: 1000 });
      queue.create({ name: "B", type: "reminder", payload: {} });
      queue.cancel(t.id);

      const cancelled = queue.list({ status: "cancelled" });
      expect(cancelled).toHaveLength(1);
      expect(cancelled[0].name).toBe("A");
    });

    it("filtra por upcoming (ordena por next_run)", () => {
      queue.create({ name: "Later", type: "reminder", payload: {}, run_at: 2000000000, next_run: 2000000000 });
      queue.create({ name: "Sooner", type: "reminder", payload: {}, run_at: 1000000000, next_run: 1000000000 });

      const upcoming = queue.list({ upcoming: true });
      expect(upcoming).toHaveLength(2);
      expect(upcoming[0].name).toBe("Sooner");
      expect(upcoming[1].name).toBe("Later");
    });

    it("filtra por tags", () => {
      queue.create({ name: "Tagged", type: "reminder", payload: {}, tags: ["important"] });
      queue.create({ name: "Untagged", type: "reminder", payload: {} });

      const filtered = queue.list({ tags: ["important"] });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("Tagged");
    });
  });

  describe("getDueTasks", () => {
    it("devuelve tareas con next_run <= now", () => {
      queue.create({ name: "Due", type: "reminder", payload: {}, run_at: 1000, next_run: 1000 });
      queue.create({ name: "Future", type: "reminder", payload: {}, run_at: 9999999999, next_run: 9999999999 });

      const due = queue.getDueTasks(2000);
      expect(due).toHaveLength(1);
      expect(due[0].name).toBe("Due");
    });

    it("no devuelve tareas canceladas", () => {
      const t = queue.create({ name: "Cancelled", type: "reminder", payload: {}, run_at: 1000, next_run: 1000 });
      queue.cancel(t.id);

      const due = queue.getDueTasks(2000);
      expect(due).toHaveLength(0);
    });
  });

  describe("status transitions", () => {
    it("markRunning cambia status", () => {
      const t = queue.create({ name: "Test", type: "reminder", payload: {} });
      queue.markRunning(t.id);
      expect(queue.get(t.id)!.status).toBe("running");
    });

    it("markCompleted actualiza status, last_run, run_count, last_result", () => {
      const t = queue.create({ name: "Test", type: "reminder", payload: {}, run_at: 1000 });
      queue.markCompleted(t.id, { success: true, output: "OK", duration_ms: 100 });

      const updated = queue.get(t.id)!;
      expect(updated.status).toBe("completed");
      expect(updated.run_count).toBe(1);
      expect(updated.last_run).not.toBeNull();
      expect(JSON.parse(updated.last_result!)).toEqual({
        success: true,
        output: "OK",
        duration_ms: 100,
      });
    });

    it("markFailed actualiza status", () => {
      const t = queue.create({ name: "Test", type: "shell", payload: { command: "false" } });
      queue.markFailed(t.id, { success: false, output: "Error", duration_ms: 50 });

      const updated = queue.get(t.id)!;
      expect(updated.status).toBe("failed");
      expect(updated.run_count).toBe(1);
    });

    it("cancel devuelve false para tarea ya completada", () => {
      const t = queue.create({ name: "Done", type: "reminder", payload: {} });
      queue.markCompleted(t.id, { success: true, output: "", duration_ms: 0 });
      expect(queue.cancel(t.id)).toBe(false);
    });

    it("cancel devuelve false para ID inexistente", () => {
      expect(queue.cancel("nope")).toBe(false);
    });
  });

  describe("updateNextRun", () => {
    it("actualiza next_run", () => {
      const t = queue.create({ name: "Test", type: "reminder", payload: {} });
      queue.updateNextRun(t.id, 5000);
      expect(queue.get(t.id)!.next_run).toBe(5000);
    });
  });
});
