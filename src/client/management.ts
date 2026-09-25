import { createInterface } from "node:readline/promises";
import { hostname } from "node:os";
import {
  loadLithiumClientConfig,
  readLithiumClientConfigFile,
  updateLithiumClientConfigFile,
} from "./config";
import {
  clearDeviceCredential,
  defaultDeviceCredentialPath,
  loadDeviceCredential,
  saveDeviceCredential,
  type DeviceCredentialCodec,
} from "./credential-store";
import {
  enrollDeviceWithAccount,
  promptLithiumAccountLogin,
  revokeDeviceCredentialWithServer,
} from "./onboarding";
import {
  disableWindowsStartup,
  enableWindowsStartup,
  windowsStartupStatus,
  type StartupProgramRunner,
} from "./windows-startup";

type FetchLike = typeof fetch;

export interface ClientInstallStatus {
  serverUrl: string;
  deviceName: string;
  workspaceRoots: string[];
  credentialPresent: boolean;
  startupEnabled: boolean;
  serverReachable: boolean;
  serverStatus?: string;
  error?: string;
}

function httpBase(serverUrl: string): URL {
  const url = new URL(serverUrl);
  if (url.protocol === "wss:") url.protocol = "https:";
  if (url.protocol === "ws:") url.protocol = "http:";
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

async function fetchHealth(serverUrl: string, fetchImpl: FetchLike): Promise<{ reachable: boolean; status?: string; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    timer.unref?.();
    try {
      const response = await fetchImpl(new URL("/health", httpBase(serverUrl)), { signal: controller.signal });
      if (!response.ok) return { reachable: false, error: `HTTP ${response.status}` };
      const body = await response.json() as { status?: unknown };
      return {
        reachable: true,
        ...(typeof body.status === "string" ? { status: body.status } : {}),
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return { reachable: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function inspectClientInstallation(options: {
  configPath: string;
  credentialPath?: string;
  codec?: DeviceCredentialCodec;
  fetchImpl?: FetchLike;
  platform?: NodeJS.Platform;
  execPath?: string;
  runProgram?: StartupProgramRunner;
}): Promise<ClientInstallStatus> {
  const config = loadLithiumClientConfig(options.configPath);
  let credentialPresent = false;
  let credentialError: string | undefined;
  try {
    credentialPresent = Boolean(await loadDeviceCredential(options.credentialPath ?? defaultDeviceCredentialPath(), options.codec));
  } catch (error) {
    credentialError = error instanceof Error ? error.message : String(error);
  }
  let startupEnabled = false;
  if ((options.platform ?? process.platform) === "win32") {
    try {
      startupEnabled = (await windowsStartupStatus({
        ...(options.platform ? { platform: options.platform } : {}),
        ...(options.execPath ? { execPath: options.execPath } : {}),
        ...(options.runProgram ? { runProgram: options.runProgram } : {}),
      })).enabled;
    } catch {
      // Status remains usable even if Windows registry inspection is unavailable.
    }
  }
  const health = await fetchHealth(config.serverUrl, options.fetchImpl ?? fetch);
  return {
    serverUrl: config.serverUrl,
    deviceName: config.deviceName ?? hostname(),
    workspaceRoots: [...config.workspaceRoots],
    credentialPresent,
    startupEnabled,
    serverReachable: health.reachable,
    ...(health.status ? { serverStatus: health.status } : {}),
    ...(credentialError ? { error: credentialError } : !health.reachable && health.error ? { error: health.error } : {}),
  };
}

export async function unlinkClientInstallation(options: {
  configPath: string;
  credentialPath?: string;
  codec?: DeviceCredentialCodec;
  fetchImpl?: FetchLike;
  localOnly?: boolean;
}): Promise<{ hadCredential: boolean; serverRevoked: boolean; localRemoved: boolean }> {
  const path = options.credentialPath ?? defaultDeviceCredentialPath();
  const credential = await loadDeviceCredential(path, options.codec);
  if (!credential) return { hadCredential: false, serverRevoked: false, localRemoved: false };
  let serverRevoked = false;
  if (!options.localOnly) {
    const config = loadLithiumClientConfig(options.configPath);
    await revokeDeviceCredentialWithServer({
      serverUrl: config.serverUrl,
      credential,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    serverRevoked = true;
  }
  const localRemoved = await clearDeviceCredential(path);
  return { hadCredential: true, serverRevoked, localRemoved };
}

export async function relinkClientInstallation(options: {
  configPath: string;
  username: string;
  password: string;
  deviceName?: string;
  credentialPath?: string;
  codec?: DeviceCredentialCodec;
  fetchImpl?: FetchLike;
}): Promise<{ deviceName: string; replacedCredential: boolean }> {
  const path = options.credentialPath ?? defaultDeviceCredentialPath();
  const fetchOptions = options.fetchImpl ? { fetchImpl: options.fetchImpl } : {};
  const existing = await loadDeviceCredential(path, options.codec);
  let config = loadLithiumClientConfig(options.configPath);
  const deviceName = options.deviceName?.trim() || config.deviceName || hostname();
  if (deviceName !== config.deviceName) {
    updateLithiumClientConfigFile(options.configPath, { deviceName });
    config = loadLithiumClientConfig(options.configPath);
  }

  // Enroll first so a failed login never destroys the working credential. The
  // old credential is revoked only after the new secret has been persisted by
  // DPAPI. If revocation fails, restore the old local credential and best-effort
  // revoke the newly issued secret so relink remains fail-safe and recoverable.
  const credential = await enrollDeviceWithAccount({
    serverUrl: config.serverUrl,
    deviceName,
    username: options.username,
    password: options.password,
    ...fetchOptions,
  });
  await saveDeviceCredential(credential, path, options.codec);

  if (existing) {
    try {
      await revokeDeviceCredentialWithServer({ serverUrl: config.serverUrl, credential: existing, ...fetchOptions });
    } catch (error) {
      await saveDeviceCredential(existing, path, options.codec).catch(() => {});
      await revokeDeviceCredentialWithServer({ serverUrl: config.serverUrl, credential, ...fetchOptions }).catch(() => {});
      throw error;
    }
  }
  return { deviceName, replacedCredential: Boolean(existing) };
}

function requireInteractiveTerminal(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Este comando requer terminal interativo.");
}

async function promptDeviceName(current: string): Promise<string> {
  requireInteractiveTerminal();
  const readline = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    const value = (await readline.question(`Nome deste computador [${current}]: `)).trim();
    return value || current;
  } finally {
    readline.close();
  }
}

function parseBooleanAnswer(value: string, current: boolean): boolean {
  const answer = value.trim().toLowerCase();
  if (!answer) return current;
  if (["s", "sim", "y", "yes", "1", "true"].includes(answer)) return true;
  if (["n", "nao", "não", "no", "0", "false"].includes(answer)) return false;
  throw new Error(`Resposta booleana inválida: ${value}`);
}

async function configureInteractively(configPath: string): Promise<void> {
  requireInteractiveTerminal();
  const current = readLithiumClientConfigFile(configPath);
  const readline = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    const serverUrl = (await readline.question(`Endpoint [${current.serverUrl}]: `)).trim() || current.serverUrl;
    const deviceAnswer = (await readline.question(`Nome do device [${current.deviceName ?? hostname()}] ("auto" usa hostname): `)).trim();
    const deviceName = deviceAnswer.toLowerCase() === "auto" ? null : (deviceAnswer || current.deviceName || hostname());
    const workspaceAnswer = (await readline.question(`Workspaces separados por ; [${current.workspaceRoots.join(";")}]: `)).trim();
    const workspaceRoots = workspaceAnswer ? workspaceAnswer.split(";").map((value) => value.trim()).filter(Boolean) : current.workspaceRoots;
    const executableAnswer = (await readline.question(`Executáveis permitidos separados por , [${current.allowedExecutables.join(",")}]: `)).trim();
    const allowedExecutables = executableAnswer ? executableAnswer.split(",").map((value) => value.trim()).filter(Boolean) : current.allowedExecutables;
    const allowAllExecutables = parseBooleanAnswer(await readline.question(`Permitir qualquer executável? [${current.allowAllExecutables ? "S/n" : "s/N"}]: `), current.allowAllExecutables);
    const allowAllChildEnv = parseBooleanAnswer(await readline.question(`Repassar todo o ambiente para processos filhos? [${current.allowAllChildEnv ? "S/n" : "s/N"}]: `), current.allowAllChildEnv);
    const enableUnsafeShell = parseBooleanAnswer(await readline.question(`Habilitar shell irrestrito? [${current.enableUnsafeShell ? "S/n" : "s/N"}]: `), current.enableUnsafeShell);
    updateLithiumClientConfigFile(configPath, {
      serverUrl,
      deviceName,
      workspaceRoots,
      allowedExecutables,
      allowAllExecutables,
      allowAllChildEnv,
      enableUnsafeShell,
    });
    console.log(`Configuração salva: ${configPath}`);
  } finally {
    readline.close();
  }
}

function printHelp(): void {
  console.log(`Lithium Client\n\nUso:\n  lithium-client.exe                 Conecta ao endpoint Lithium; no primeiro boot pede login.\n  lithium-client.exe status          Mostra configuração, conectividade e vínculo sem exibir segredos.\n  lithium-client.exe configure       Wizard de configuração local.\n  lithium-client.exe relink          Revoga a credencial atual e entra com outra conta/device.\n  lithium-client.exe logout          Revoga a credencial remota e apaga a cópia DPAPI local.\n  lithium-client.exe logout --local-only  Apaga só a cópia local; use apenas se o endpoint antigo não existe mais.\n  lithium-client.exe startup status  Mostra se inicia com Windows.\n  lithium-client.exe startup enable  Adiciona o standalone ao HKCU Run.\n  lithium-client.exe startup disable Remove o início automático.\n  lithium-client.exe help            Mostra esta ajuda.\n\nAuto-update não faz parte desta versão.`);
}

export async function runClientManagementCommand(options: {
  args: string[];
  configPath: string;
}): Promise<boolean> {
  const [commandRaw, subcommandRaw, ...rest] = options.args;
  const command = commandRaw?.toLowerCase();
  if (!command || command === "--background") return false;
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return true;
  }
  if (command === "status") {
    const status = await inspectClientInstallation({ configPath: options.configPath });
    console.log("Lithium Client status");
    console.log(`  Endpoint: ${status.serverUrl} (${status.serverReachable ? status.serverStatus ?? "online" : "indisponível"})`);
    console.log(`  Device: ${status.deviceName}`);
    console.log(`  Credencial DPAPI: ${status.credentialPresent ? "presente" : "ausente"}`);
    console.log(`  Iniciar com Windows: ${status.startupEnabled ? "sim" : "não"}`);
    console.log(`  Workspaces: ${status.workspaceRoots.join(", ")}`);
    if (status.error) console.log(`  Atenção: ${status.error}`);
    return true;
  }
  if (command === "configure" || command === "config") {
    await configureInteractively(options.configPath);
    return true;
  }
  if (command === "logout" || command === "unlink") {
    const localOnly = [subcommandRaw, ...rest].some((value) => value === "--local-only");
    const result = await unlinkClientInstallation({ configPath: options.configPath, localOnly });
    if (!result.hadCredential) console.log("Este Windows já está sem credencial de device.");
    else if (localOnly) console.log("Credencial local removida sem revogação remota. A credencial antiga pode continuar válida no endpoint.");
    else console.log("Device desvinculado: credencial remota revogada e cópia DPAPI local removida.");
    return true;
  }
  if (command === "relink" || command === "login") {
    const current = loadLithiumClientConfig(options.configPath);
    const deviceName = await promptDeviceName(current.deviceName ?? hostname());
    const login = await promptLithiumAccountLogin();
    const result = await relinkClientInstallation({
      configPath: options.configPath,
      username: login.username,
      password: login.password,
      deviceName,
    });
    console.log(`${result.replacedCredential ? "Vínculo trocado" : "Vínculo criado"}: ${result.deviceName}. Execute o Client sem argumentos para conectar.`);
    return true;
  }
  if (command === "startup") {
    const subcommand = subcommandRaw?.toLowerCase() || "status";
    if (subcommand === "status") {
      const status = await windowsStartupStatus();
      console.log(`Iniciar com Windows: ${status.enabled ? "sim" : "não"}`);
      return true;
    }
    if (subcommand === "enable") {
      await enableWindowsStartup();
      console.log("Lithium Client configurado para iniciar com o Windows.");
      return true;
    }
    if (subcommand === "disable") {
      const removed = await disableWindowsStartup();
      console.log(removed ? "Início com Windows removido." : "Início com Windows já estava desabilitado.");
      return true;
    }
    throw new Error(`Comando startup desconhecido: ${subcommand}`);
  }
  throw new Error(`Comando desconhecido: ${command}. Use "help" para ver as opções.`);
}
