import { hostname } from "node:os";

import { enrollDeviceWithAccount, promptLithiumAccountLogin } from "./client/onboarding";
import {
  assertLithiumLinuxNodeWorkspaces,
  loadLithiumLinuxNodeConfig,
  resolveLithiumLinuxNodeConfigPath,
} from "./linux-node/config";
import {
  loadLithiumLinuxNodeCredential,
  resolveLithiumLinuxNodeCredential,
  resolveLithiumLinuxNodeCredentialPath,
  saveLithiumLinuxNodeCredential,
} from "./linux-node/credential-store";
import { LithiumLinuxNodeRuntime } from "./linux-node/runtime";

function requireLinux(): void {
  if (process.platform !== "linux") {
    throw new Error("Lithium Node headless deve executar em Linux.");
  }
}

async function enroll(configPath: string, credentialPath: string): Promise<void> {
  const config = loadLithiumLinuxNodeConfig(configPath);
  const nodeName = config.deviceName ?? hostname();
  const login = await promptLithiumAccountLogin("Lithium Node");
  const credential = await enrollDeviceWithAccount({
    serverUrl: config.serverUrl,
    deviceName: nodeName,
    username: login.username,
    password: login.password,
  });
  await saveLithiumLinuxNodeCredential(credential, credentialPath);
  console.log(`Lithium Node registrado como ${nodeName}. Credential persistida em arquivo privado.`);
}

async function status(configPath: string, credentialPath: string): Promise<void> {
  const config = loadLithiumLinuxNodeConfig(configPath);
  const credential = await loadLithiumLinuxNodeCredential(credentialPath);
  console.log(JSON.stringify({
    service: "lithium-node",
    endpoint: new URL(config.serverUrl).origin,
    nodeName: config.deviceName ?? hostname(),
    configPath,
    credentialPath,
    credentialPresent: Boolean(credential),
    workspaceRoots: config.workspaceRoots,
    unsafeShellEnabled: config.enableUnsafeShell,
  }, null, 2));
}

async function run(configPath: string, credentialPath: string): Promise<void> {
  const config = loadLithiumLinuxNodeConfig(configPath);
  await assertLithiumLinuxNodeWorkspaces(config);
  const credential = await resolveLithiumLinuxNodeCredential({
    path: credentialPath,
    ...(Bun.env.LITHIUM_DEVICE_CREDENTIAL?.trim()
      ? { bootstrapCredential: Bun.env.LITHIUM_DEVICE_CREDENTIAL.trim() }
      : {}),
  });
  const runtime = new LithiumLinuxNodeRuntime({
    config,
    credential,
    hostname: config.deviceName ?? hostname(),
  });
  runtime.start();

  console.log(JSON.stringify({
    service: "lithium-node",
    event: "starting",
    endpoint: new URL(config.serverUrl).origin,
    workspaces: config.workspaceRoots.length,
  }));

  let previous = "";
  const timer = setInterval(() => {
    const snapshot = runtime.snapshot();
    const fingerprint = `${snapshot.state}:${snapshot.deviceId ?? ""}:${snapshot.attempt}:${snapshot.lastError ?? ""}`;
    if (fingerprint === previous) return;
    previous = fingerprint;
    console.log(JSON.stringify({
      service: "lithium-node",
      state: snapshot.state,
      attempt: snapshot.attempt,
      ...(snapshot.deviceId ? { nodeId: snapshot.deviceId } : {}),
      ...(snapshot.deviceName ? { nodeName: snapshot.deviceName } : {}),
      ...(snapshot.lastError ? { error: snapshot.lastError } : {}),
    }));
  }, 1_000);
  timer.unref?.();

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(timer);
    console.log(JSON.stringify({ service: "lithium-node", event: "stopping", signal }));
    await runtime.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

async function main(): Promise<void> {
  requireLinux();
  const configPath = resolveLithiumLinuxNodeConfigPath();
  const credentialPath = resolveLithiumLinuxNodeCredentialPath();
  const command = (Bun.argv[2] ?? "run").trim().toLowerCase();

  if (command === "enroll") return enroll(configPath, credentialPath);
  if (command === "status") return status(configPath, credentialPath);
  if (command === "run") return run(configPath, credentialPath);
  throw new Error("Uso: lithium-node [run|enroll|status]");
}

void main().catch((error) => {
  console.error(`Lithium Node: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
