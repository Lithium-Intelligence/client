export interface DeviceRuntimeConfig {
  workspaceRoot: string;
  workspaceRoots: string[];
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  maxOutputBytes: number;
  maxFileBytes: number;
  maxImageBytes: number;
  maxImagePixels: number;
  maxListEntries: number;
  maxTerminals: number;
  maxTerminalLogBytes: number;
  terminalStopGraceMs: number;
  terminalHistoryLimit: number;
  allowedExecutables: string[];
  allowAllExecutables: boolean;
  childEnvVars: string[];
  allowAllChildEnv: boolean;
  enableUnsafeShell: boolean;
}
