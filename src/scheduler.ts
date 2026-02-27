import * as chrono from "chrono-node";
import { Cron } from "croner";

export interface ParsedSchedule {
  run_at: number | null; // Unix timestamp (one-time)
  cron: string | null; // Cron expression (recurring)
  next_run: number; // Calculated next execution
  human: string; // Human-readable description
}

/**
 * Parsea una expresión "when" y devuelve schedule estructurado.
 *
 * Soporta:
 * - ISO 8601: "2026-02-20T09:00:00"
 * - Lenguaje natural: "tomorrow 9:00", "in 30 minutes", "next monday at 8"
 * - Cron: "0 9 * * 1" (lunes a las 9), "REDACTED/5 * * * *" (cada 5 min)
 * - Shortcuts: "every monday at 8", "daily at 9:00"
 */
export function parseWhen(when: string, referenceDate?: Date): ParsedSchedule {
  const ref = referenceDate ?? new Date();

  // 1. Intentar como cron
  const cronResult = tryParseCron(when);
  if (cronResult) return cronResult;

  // 2. Intentar como ISO 8601
  const isoResult = tryParseISO(when);
  if (isoResult) return isoResult;

  // 3. Intentar shortcuts recurrentes ANTES de chrono-node
  //    (chrono captura "every monday at 8" como "monday at 8", robándonos el intent recurrente)
  const shortcutResult = tryParseShortcut(when);
  if (shortcutResult) return shortcutResult;

  // 4. Intentar con chrono-node (lenguaje natural)
  const chronoResult = tryParseChrono(when, ref);
  if (chronoResult) return chronoResult;

  throw new Error(`No se pudo interpretar "${when}" como fecha, hora o expresión cron`);
}

function tryParseCron(when: string): ParsedSchedule | null {
  // Expresiones cron tienen 5 campos separados por espacio y suelen empezar con número o *
  const parts = when.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  // Verificar que parece cron (cada parte es número, *, o expresión cron válida)
  const cronChars = /^[\d*,\-\/]+$/;
  if (!parts.every((p) => cronChars.test(p))) return null;

  try {
    const job = new Cron(when);
    const nextDate = job.nextRun();
    if (!nextDate) return null;

    return {
      run_at: null,
      cron: when,
      next_run: Math.floor(nextDate.getTime() / 1000),
      human: `Recurrente: ${when}`,
    };
  } catch {
    return null;
  }
}

function tryParseISO(when: string): ParsedSchedule | null {
  // ISO 8601: debe tener formato YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}/.test(when)) return null;

  const date = new Date(when);
  if (isNaN(date.getTime())) return null;

  const ts = Math.floor(date.getTime() / 1000);
  return {
    run_at: ts,
    cron: null,
    next_run: ts,
    human: date.toLocaleString(),
  };
}

function tryParseChrono(when: string, ref: Date): ParsedSchedule | null {
  const results = chrono.parse(when, ref, { forwardDate: true });
  if (results.length === 0) return null;

  const date = results[0].start.date();
  const ts = Math.floor(date.getTime() / 1000);

  return {
    run_at: ts,
    cron: null,
    next_run: ts,
    human: date.toLocaleString(),
  };
}

const DAY_MAP: Record<string, number> = {
  monday: 1, mon: 1,
  tuesday: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
  sunday: 0, sun: 0,
  lunes: 1, martes: 2, miércoles: 3, miercoles: 3,
  jueves: 4, viernes: 5, sábado: 6, sabado: 6, domingo: 0,
};

function tryParseShortcut(when: string): ParsedSchedule | null {
  const lower = when.toLowerCase().trim();

  // "every monday at 8" / "every friday at 14:30"
  const everyDayMatch = lower.match(
    /^every\s+(\w+)\s+at\s+(\d{1,2})(?::(\d{2}))?$/,
  );
  if (everyDayMatch) {
    const dayNum = DAY_MAP[everyDayMatch[1]];
    if (dayNum === undefined) return null;
    const hour = parseInt(everyDayMatch[2]);
    const minute = everyDayMatch[3] ? parseInt(everyDayMatch[3]) : 0;
    const cronExpr = `${minute} ${hour} * * ${dayNum}`;
    return tryParseCron(cronExpr);
  }

  // "daily at 9:00" / "daily at 9"
  const dailyMatch = lower.match(/^daily\s+at\s+(\d{1,2})(?::(\d{2}))?$/);
  if (dailyMatch) {
    const hour = parseInt(dailyMatch[1]);
    const minute = dailyMatch[2] ? parseInt(dailyMatch[2]) : 0;
    const cronExpr = `${minute} ${hour} * * *`;
    return tryParseCron(cronExpr);
  }

  // "every N minutes" / "every N hours"
  const intervalMatch = lower.match(/^every\s+(\d+)\s+(minute|hour|min|hr)s?$/);
  if (intervalMatch) {
    const n = parseInt(intervalMatch[1]);
    const unit = intervalMatch[2];
    let cronExpr: string;
    if (unit.startsWith("min")) {
      cronExpr = `*/${n} * * * *`;
    } else {
      cronExpr = `0 */${n} * * *`;
    }
    return tryParseCron(cronExpr);
  }

  return null;
}
