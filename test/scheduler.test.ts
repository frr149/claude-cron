import { describe, it, expect } from "bun:test";
import { parseWhen } from "../src/scheduler.js";

describe("parseWhen", () => {
  // Fecha de referencia fija para tests deterministas
  const ref = new Date("2026-02-19T12:00:00Z");

  describe("cron expressions", () => {
    it("parsea cron de 5 campos", () => {
      const result = parseWhen("0 9 * * 1", ref);
      expect(result.cron).toBe("0 9 * * 1");
      expect(result.run_at).toBeNull();
      expect(result.next_run).toBeGreaterThan(0);
    });

    it("parsea */5 * * * *", () => {
      const result = parseWhen("*/5 * * * *", ref);
      expect(result.cron).toBe("*/5 * * * *");
    });

    it("rechaza cron de 6 campos", () => {
      // 6 campos no es cron estándar de 5
      expect(() => parseWhen("0 0 9 * * 1", ref)).toThrow();
    });
  });

  describe("ISO 8601", () => {
    it("parsea fecha ISO", () => {
      const result = parseWhen("2026-03-01T09:00:00Z", ref);
      expect(result.run_at).toBe(Math.floor(new Date("2026-03-01T09:00:00Z").getTime() / 1000));
      expect(result.cron).toBeNull();
    });

    it("parsea fecha ISO sin hora (midnight)", () => {
      const result = parseWhen("2026-03-01", ref);
      expect(result.run_at).not.toBeNull();
      expect(result.cron).toBeNull();
    });
  });

  describe("lenguaje natural (chrono-node)", () => {
    it("parsea 'tomorrow 9:00'", () => {
      const result = parseWhen("tomorrow 9:00", ref);
      expect(result.run_at).not.toBeNull();
      expect(result.cron).toBeNull();
      // Debería ser ~Feb 20 a las 9:00
      const date = new Date(result.next_run * 1000);
      expect(date.getDate()).toBe(20);
    });

    it("parsea 'in 30 minutes'", () => {
      const result = parseWhen("in 30 minutes", ref);
      expect(result.run_at).not.toBeNull();
      // ~30 min desde ref
      const diff = result.next_run - Math.floor(ref.getTime() / 1000);
      expect(diff).toBeGreaterThanOrEqual(29 * 60);
      expect(diff).toBeLessThanOrEqual(31 * 60);
    });

    it("parsea 'in 2 hours'", () => {
      const result = parseWhen("in 2 hours", ref);
      const diff = result.next_run - Math.floor(ref.getTime() / 1000);
      expect(diff).toBeGreaterThanOrEqual(119 * 60);
      expect(diff).toBeLessThanOrEqual(121 * 60);
    });

    it("parsea 'next friday at 3pm'", () => {
      const result = parseWhen("next friday at 3pm", ref);
      expect(result.run_at).not.toBeNull();
      const date = new Date(result.next_run * 1000);
      expect(date.getDay()).toBe(5); // Viernes
    });
  });

  describe("shortcuts recurrentes", () => {
    it("parsea 'every monday at 8'", () => {
      const result = parseWhen("every monday at 8", ref);
      expect(result.cron).toBe("0 8 * * 1");
    });

    it("parsea 'every friday at 14:30'", () => {
      const result = parseWhen("every friday at 14:30", ref);
      expect(result.cron).toBe("30 14 * * 5");
    });

    it("parsea 'daily at 9:00'", () => {
      const result = parseWhen("daily at 9:00", ref);
      expect(result.cron).toBe("0 9 * * *");
    });

    it("parsea 'daily at 9'", () => {
      const result = parseWhen("daily at 9", ref);
      expect(result.cron).toBe("0 9 * * *");
    });

    it("parsea 'every 5 minutes'", () => {
      const result = parseWhen("every 5 minutes", ref);
      expect(result.cron).toBe("*/5 * * * *");
    });

    it("parsea 'every 2 hours'", () => {
      const result = parseWhen("every 2 hours", ref);
      expect(result.cron).toBe("0 */2 * * *");
    });
  });

  describe("errores", () => {
    it("lanza error para input inválido", () => {
      expect(() => parseWhen("potato salad", ref)).toThrow();
    });

    it("lanza error para string vacío", () => {
      expect(() => parseWhen("", ref)).toThrow();
    });
  });
});
