import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { DeviceRuntimeConfig } from "../device/config";

export interface LithiumClientConfig extends DeviceRuntimeConfig {
  serverUrl: string;
  clientVersion: string;
  deviceName?: string;
}

export interface LithiumClientConfigFile {
  serverUrl: string;
  clientVersion: string;
  deviceName?: string;
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

type Environment = Record<string, string | undefined>;

export const defaultLithiumClientConfigFile: LithiumClientConfigFile = Object.freeze({
  serverUrl: "https://ai.lithium.dev.br",
  clientVersion: "0.1.0",
  workspaceRoots: ["./workspace"],
  defaultTimeoutMs: 15_000,
  maxTimeoutMs: 60_000,
  maxOutputBytes: 200_000,
  maxFileBytes: 1_000_000,
  maxImageBytes: 20_000_000,
  maxImagePixels: 100_000_000,
  maxListEntries: 500,
  maxTerminals: 10,
  maxTerminalLogBytes: 2_000_000,
  terminalStopGraceMs: 3_000,
  terminalHistoryLimit: 50,
  allowedExecutables: ["bun", "node", "python3", "python", "go", "git"],
  allowAllExecutables: false,
  childEnvVars: [],
  allowAllChildEnv: false,
  enableUnsafeShell: false,
});

function isStandaloneExecutable(execPath = process.execPath): boolean {
  const lower = execPath.toLowerCase();
  return lower.endsWith(".exe") && !lower.endsWith("\\bun.exe") && !lower.endsWith("/bun.exe");
}

export function resolveLithiumClientConfigPath(
  environment: Environment = Bun.env,
  execPath = process.execPath,
  cwd = process.cwd(),
): string {
  const explicit = environment.LITHIUM_CLIENT_CONFIG_FILE?.trim();
  if (explicit) return resolve(cwd, explicit);
  return isStandaloneExecutable(execPath) ? join(dirname(execPath), "lithium-client.json") : resolve(cwd, "lithium-client.json");
}

export function ensureLithiumClientConfigFile(path: string): string {
  if (!existsSync(path)) {
    requireParent(path);
    writeFileSync(path, `${JSON.stringify(defaultLithiumClientConfigFile, null, 2)}\n`, "utf8");
  }
  return path;
}

function requireParent(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function numberField(value: unknown, name: string, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} deve ser um inteiro entre ${min} e ${max}.`);
  }
  return value;
}

function booleanField(value: unknown, name: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${name} deve ser boolean.`);
  return value;
}

function stringList(value: unknown, name: string, fallback: string[]): string[] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${name} deve ser uma lista de strings não vazias.`);
  }
  return value.map((item) => item.trim());
}

function normalizeServerUrl(input: unknown): string {
  const value = String(input ?? "").trim();
  if (!value) throw new Error("serverUrl é obrigatório.");
  const url = new URL(value);
  if (!["https:", "http:", "wss:", "ws:"].includes(url.protocol)) {
    throw new Error("serverUrl deve usar http(s) ou ws(s).");
  }
  url.hash = "";
  url.search = "";
  return url.toString();
}

export function loadLithiumClientConfig(path: string, environment: Environment = Bun.env): LithiumClientConfig {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const allowedKeys = new Set([
    "serverUrl", "clientVersion", "deviceName", "workspaceRoots",
    "defaultTimeoutMs", "maxTimeoutMs", "maxOutputBytes", "maxFileBytes", "maxImageBytes", "maxImagePixels",
    "maxListEntries", "maxTerminals", "maxTerminalLogBytes", "terminalStopGraceMs", "terminalHistoryLimit",
    "allowedExecutables", "allowAllExecutables", "childEnvVars", "allowAllChildEnv", "enableUnsafeShell",
  ]);
  const unknown = Object.keys(raw).filter((key) => !allowedKeys.has(key));
  if (unknown.length) throw new Error(`Campo(s) não suportado(s) no Lithium Client config: ${unknown.join(", ")}.`);
  const baseDir = dirname(path);
  const defaults = defaultLithiumClientConfigFile;
  const workspaceRoots = stringList(raw.workspaceRoots, "workspaceRoots", defaults.workspaceRoots).map((entry) => resolve(baseDir, entry));
  if (!workspaceRoots.length) throw new Error("workspaceRoots deve conter ao menos um diretório.");
  const serverUrl = normalizeServerUrl(environment.LITHIUM_SERVER_URL?.trim() || raw.serverUrl || defaults.serverUrl);
  const clientVersion = String(raw.clientVersion ?? defaults.clientVersion).trim();
  if (!clientVersion || clientVersion.length > 64) throw new Error("clientVersion inválido.");
  const deviceNameRaw = raw.deviceName === undefined ? undefined : String(raw.deviceName).trim();
  if (deviceNameRaw !== undefined && (!deviceNameRaw || deviceNameRaw.length > 160)) throw new Error("deviceName inválido.");

  return Object.freeze({
    serverUrl,
    clientVersion,
    ...(deviceNameRaw ? { deviceName: deviceNameRaw } : {}),
    workspaceRoot: workspaceRoots[0]!,
    workspaceRoots,
    defaultTimeoutMs: numberField(raw.defaultTimeoutMs, "defaultTimeoutMs", defaults.defaultTimeoutMs, 100, 600_000),
    maxTimeoutMs: numberField(raw.maxTimeoutMs, "maxTimeoutMs", defaults.maxTimeoutMs, 100, 600_000),
    maxOutputBytes: numberField(raw.maxOutputBytes, "maxOutputBytes", defaults.maxOutputBytes, 1, 100_000_000),
    maxFileBytes: numberField(raw.maxFileBytes, "maxFileBytes", defaults.maxFileBytes, 1, 100_000_000),
    maxImageBytes: numberField(raw.maxImageBytes, "maxImageBytes", defaults.maxImageBytes, 1, 500_000_000),
    maxImagePixels: numberField(raw.maxImagePixels, "maxImagePixels", defaults.maxImagePixels, 1, 1_000_000_000),
    maxListEntries: numberField(raw.maxListEntries, "maxListEntries", defaults.maxListEntries, 1, 100_000),
    maxTerminals: numberField(raw.maxTerminals, "maxTerminals", defaults.maxTerminals, 1, 100),
    maxTerminalLogBytes: numberField(raw.maxTerminalLogBytes, "maxTerminalLogBytes", defaults.maxTerminalLogBytes, 1, 100_000_000),
    terminalStopGraceMs: numberField(raw.terminalStopGraceMs, "terminalStopGraceMs", defaults.terminalStopGraceMs, 0, 60_000),
    terminalHistoryLimit: numberField(raw.terminalHistoryLimit, "terminalHistoryLimit", defaults.terminalHistoryLimit, 0, 10_000),
    allowedExecutables: stringList(raw.allowedExecutables, "allowedExecutables", defaults.allowedExecutables),
    allowAllExecutables: booleanField(raw.allowAllExecutables, "allowAllExecutables", defaults.allowAllExecutables),
    childEnvVars: stringList(raw.childEnvVars, "childEnvVars", defaults.childEnvVars),
    allowAllChildEnv: booleanField(raw.allowAllChildEnv, "allowAllChildEnv", defaults.allowAllChildEnv),
    enableUnsafeShell: booleanField(raw.enableUnsafeShell, "enableUnsafeShell", defaults.enableUnsafeShell),
  });
}

export function readLithiumClientConfigFile(path: string): LithiumClientConfigFile {
  ensureLithiumClientConfigFile(path);
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<LithiumClientConfigFile>;
  // Reuse the runtime validator before exposing/editing the raw file representation.
  loadLithiumClientConfig(path, {});
  return { ...defaultLithiumClientConfigFile, ...raw } as LithiumClientConfigFile;
}

export function updateLithiumClientConfigFile(
  path: string,
  patch: Partial<Omit<LithiumClientConfigFile, "deviceName">> & { deviceName?: string | null },
): LithiumClientConfigFile {
  const current = readLithiumClientConfigFile(path);
  const next: Record<string, unknown> = { ...current, ...patch };
  if (patch.deviceName === null) delete next.deviceName;
  requireParent(path);
  const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  try {
    loadLithiumClientConfig(temp, {});
    renameSync(temp, path);
  } catch (error) {
    try { unlinkSync(temp); } catch {}
    throw error;
  }
  return readLithiumClientConfigFile(path);
}
