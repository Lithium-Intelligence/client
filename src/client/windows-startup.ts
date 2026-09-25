export interface StartupProgramResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type StartupProgramRunner = (executable: string, args: string[]) => Promise<StartupProgramResult>;

export interface WindowsStartupOptions {
  platform?: NodeJS.Platform;
  execPath?: string;
  runProgram?: StartupProgramRunner;
}

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const VALUE_NAME = "LithiumClient";

async function defaultRunProgram(executable: string, args: string[]): Promise<StartupProgramResult> {
  const child = Bun.spawn([executable, ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

function requireWindows(platform: NodeJS.Platform): void {
  if (platform !== "win32") throw new Error("Iniciar com Windows só está disponível no Lithium Client para Windows.");
}

function requireStandaloneExecutable(execPath: string): void {
  const normalized = execPath.toLowerCase().replaceAll("/", "\\");
  if (!normalized.endsWith(".exe") || normalized.endsWith("\\bun.exe")) {
    throw new Error("Configure o início com Windows usando o lithium-client.exe distribuível, não o runtime Bun de desenvolvimento.");
  }
}

export function windowsStartupCommand(execPath: string): string {
  return `"${execPath}" --background`;
}

export async function windowsStartupStatus(options: WindowsStartupOptions = {}): Promise<{ enabled: boolean; command?: string }> {
  const platform = options.platform ?? process.platform;
  requireWindows(platform);
  const runner = options.runProgram ?? defaultRunProgram;
  const result = await runner("reg.exe", ["query", RUN_KEY, "/v", VALUE_NAME]);
  if (result.exitCode !== 0) return { enabled: false };
  const line = result.stdout.split(/\r?\n/).find((value) => value.includes(VALUE_NAME) && value.includes("REG_SZ"));
  const command = line?.split(/REG_SZ\s+/i, 2)[1]?.trim();
  return { enabled: true, ...(command ? { command } : {}) };
}

export async function enableWindowsStartup(options: WindowsStartupOptions = {}): Promise<string> {
  const platform = options.platform ?? process.platform;
  const execPath = options.execPath ?? process.execPath;
  requireWindows(platform);
  requireStandaloneExecutable(execPath);
  const runner = options.runProgram ?? defaultRunProgram;
  const command = windowsStartupCommand(execPath);
  const result = await runner("reg.exe", ["add", RUN_KEY, "/v", VALUE_NAME, "/t", "REG_SZ", "/d", command, "/f"]);
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "Não foi possível configurar o início com Windows.");
  return command;
}

export async function disableWindowsStartup(options: WindowsStartupOptions = {}): Promise<boolean> {
  const platform = options.platform ?? process.platform;
  requireWindows(platform);
  const runner = options.runProgram ?? defaultRunProgram;
  const status = await windowsStartupStatus({ ...options, runProgram: runner });
  if (!status.enabled) return false;
  const result = await runner("reg.exe", ["delete", RUN_KEY, "/v", VALUE_NAME, "/f"]);
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "Não foi possível remover o início com Windows.");
  return true;
}
