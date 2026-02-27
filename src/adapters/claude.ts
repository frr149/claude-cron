import type { AIAdapter, AITaskOptions, AITaskResult } from "./types.js";

export class ClaudeAdapter implements AIAdapter {
  readonly name = "claude";
  readonly cliCommand = "claude";

  async isInstalled(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["claude", "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  async execute(prompt: string, options?: AITaskOptions): Promise<AITaskResult> {
    const args = ["claude", "-p", "--output-format", "text"];

    if (options?.model) {
      args.push("--model", options.model);
    }

    if (options?.maxBudgetUsd !== undefined) {
      args.push("--max-turns", String(Math.ceil(options.maxBudgetUsd * 100)));
    }

    const start = Date.now();

    const proc = Bun.spawn(args, {
      stdin: new Response(prompt).body!,
      stdout: "pipe",
      stderr: "pipe",
      cwd: options?.workingDir,
      env: { ...process.env },
      timeout: options?.timeoutMs,
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    await proc.exited;
    const durationMs = Date.now() - start;

    return {
      success: proc.exitCode === 0,
      output: proc.exitCode === 0 ? stdout.trim() : `ERROR: ${stderr.trim()}\n${stdout.trim()}`,
      durationMs,
    };
  }
}
