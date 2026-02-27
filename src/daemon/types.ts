export interface DaemonInstaller {
  readonly platform: string;
  install(options: DaemonOptions): Promise<DaemonResult>;
  uninstall(): Promise<DaemonResult>;
  status(): Promise<"running" | "stopped" | "not_installed">;
}

export interface DaemonOptions {
  checkIntervalSeconds?: number;
  dbPath?: string;
  bunPath?: string;
  runnerPath?: string;
  logPath?: string;
}

export interface DaemonResult {
  success: boolean;
  message: string;
  details?: string;
}
