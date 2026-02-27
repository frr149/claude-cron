import type { AIAdapter, AITaskOptions, AITaskResult } from "./types.js";

export class CopilotAdapter implements AIAdapter {
  readonly name = "copilot";
  readonly cliCommand = "gh";

  async isInstalled(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["gh", "copilot", "--version"], {
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
    const args = ["gh", "copilot", "suggest", prompt];

    const start = Date.now();

    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      cwd: options?.workingDir,
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
      output: proc.exitCode === 0 ? stdout.trim() : `ERROR: ${stderr.trim()}`,
      durationMs,
    };
  }
}
