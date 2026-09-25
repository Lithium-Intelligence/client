import { mkdir, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { printLithiumClientBanner } from "./client/banner";
import {
  ensureLithiumClientConfigFile,
  loadLithiumClientConfig,
  resolveLithiumClientConfigPath,
} from "./client/config";
import { resolveDeviceCredential } from "./client/credential-store";
import { runClientManagementCommand } from "./client/management";
import { buildWorkspaceAnnouncements } from "./client/workspaces";
import { enrollDeviceWithAccount, promptLithiumAccountLogin } from "./client/onboarding";
import { LithiumDeviceClient, type DeviceClientSnapshot } from "./device/client";
import { DEVICE_CAPABILITIES } from "./device/contracts";
import { DeviceCapabilityDispatcher } from "./device/dispatcher";
import { DeviceRuntime } from "./device/runtime";
import { TerminalManager } from "./terminal/manager";

function connectionHint(error: string | undefined): string | undefined {
  if (!error) return undefined;
  if (error.includes("INVALID_DEVICE_CREDENTIAL")) return 'Credencial inválida ou revogada. Execute "lithium-client.exe relink".';
  if (error.includes("Handshake timeout") || error.includes("WebSocket transport error")) return "Verifique rede, DNS/TLS e se o Lithium Server está acessível.";
  return error;
}

function printConnectionState(snapshot: DeviceClientSnapshot, background: boolean): void {
  if (background) {
    console.log(JSON.stringify({
      service: "lithium-client",
      state: snapshot.state,
      attempt: snapshot.attempt,
      ...(snapshot.deviceId ? { deviceId: snapshot.deviceId } : {}),
      ...(snapshot.deviceName ? { deviceName: snapshot.deviceName } : {}),
      ...(snapshot.lastError ? { error: snapshot.lastError } : {}),
    }));
    return;
  }

  if (snapshot.state === "connected") {
    console.log(`[OK] Conectado como ${snapshot.deviceName ?? "device"}${snapshot.deviceId ? ` (${snapshot.deviceId})` : ""}.`);
    return;
  }
  if (snapshot.state === "handshaking") {
    console.log("Autenticando este device no Lithium Server...");
    return;
  }
  if (snapshot.state === "retrying") {
    const hint = connectionHint(snapshot.lastError);
    console.log(`[!] Reconectando (tentativa ${snapshot.attempt})${hint ? ` — ${hint}` : "..."}`);
    return;
  }
  if (snapshot.state === "connecting") console.log("Conectando ao Lithium Server...");
}

async function main(): Promise<void> {
  const configPath = ensureLithiumClientConfigFile(resolveLithiumClientConfigPath());
  // Bun keeps the bundled entrypoint as argv[1] even in --compile executables
  // (for example B:/~BUN/root/lithium-client.exe). User arguments always start at argv[2].
  const args = Bun.argv.slice(2);
  const background = args.includes("--background");
  if (!background) printLithiumClientBanner();
  if (await runClientManagementCommand({ args, configPath })) return;

  const config = loadLithiumClientConfig(configPath);
  const clientHostname = config.deviceName ?? hostname();
  const bootstrapCredential = Bun.env.LITHIUM_DEVICE_CREDENTIAL?.trim();
  const credential = await resolveDeviceCredential({
    ...(bootstrapCredential ? { bootstrapCredential } : {}),
    acquireCredential: async () => {
      const login = await promptLithiumAccountLogin();
      console.log(`Registrando device ${clientHostname} em ${new URL(config.serverUrl).origin}...`);
      return enrollDeviceWithAccount({
        serverUrl: config.serverUrl,
        deviceName: clientHostname,
        username: login.username,
        password: login.password,
      });
    },
  });

  await Promise.all(config.workspaceRoots.map(async (root) => {
    try {
      const info = await stat(root);
      if (!info.isDirectory()) throw new Error(`Workspace root não é um diretório: ${root}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(root, { recursive: true });
    }
  }));

  const terminalManager = new TerminalManager(config);
  const runtime = new DeviceRuntime(config, terminalManager);
  const dispatcher = new DeviceCapabilityDispatcher(runtime);
  const capabilities = DEVICE_CAPABILITIES
    .filter((name) => name !== "run_command" || config.enableUnsafeShell)
    .map((name) => ({
      name,
      ...(name === "run_program" || name === "run_command" ? { cancellable: true } : {}),
      ...(name === "terminal_logs" ? { supportsStreaming: true } : {}),
    }));

  const workspaces = buildWorkspaceAnnouncements(config, capabilities, process.platform);

  const client = new LithiumDeviceClient({
    serverUrl: config.serverUrl,
    credential,
    clientVersion: config.clientVersion,
    platform: process.platform,
    hostname: clientHostname,
    dispatcher,
    capabilities,
    workspaces: [...workspaces],
  });

  if (!background) {
    console.log("");
    console.log(`  Server: ${new URL(config.serverUrl).origin}`);
    console.log(`  Device: ${clientHostname}`);
    console.log(`  Config: ${configPath}`);
    console.log(`  Workspaces: ${config.workspaceRoots.join(", ")}`);
    console.log(`  Unsafe shell: ${config.enableUnsafeShell ? "habilitado" : "desabilitado"}`);
    console.log('  Comandos: execute "lithium-client.exe help" em outro terminal para gerenciar este Client.');
  }

  client.start();
  let previousState = "";
  const stateTimer = setInterval(() => {
    const snapshot = client.snapshot();
    const fingerprint = `${snapshot.state}:${snapshot.deviceId ?? ""}:${snapshot.lastError ?? ""}:${snapshot.attempt}`;
    if (fingerprint === previousState) return;
    previousState = fingerprint;
    printConnectionState(snapshot, background);
  }, 1_000);
  stateTimer.unref?.();

  let shuttingDown = false;
  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(stateTimer);
    if (!background) console.log(`Encerrando Lithium Client (${signal})...`);
    client.stop();
    await terminalManager.shutdown();
    process.exit(0);
  }

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Lithium Client: ${message}`);
  if (/credential|credencial/i.test(message)) console.error('Dica: execute "lithium-client.exe relink" para registrar este computador novamente.');
  process.exit(1);
});
