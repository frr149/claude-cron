export interface AITaskOptions {
  model?: string;
  maxBudgetUsd?: number;
  timeoutMs?: number;
  workingDir?: string;
  mcpConfig?: Record<string, unknown>;
}

export interface AITaskResult {
  success: boolean;
  output: string;
  durationMs: number;
  cost?: number;
}

export interface AIAdapter {
  readonly name: string;
  readonly cliCommand: string;
  isInstalled(): Promise<boolean>;
  execute(prompt: string, options?: AITaskOptions): Promise<AITaskResult>;
}
