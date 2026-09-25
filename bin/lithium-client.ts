#!/usr/bin/env bun

import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { ensureLithiumClientConfigFile } from "../src/client/config";

function linuxConfigPath(): string {
  const explicit = Bun.env.LITHIUM_CLIENT_CONFIG_FILE?.trim() || Bun.env.LITHIUM_NODE_CONFIG_FILE?.trim();
  return explicit ? resolve(process.cwd(), explicit) : resolve(process.cwd(), "lithium-client.json");
}

function linuxCredentialPath(): string {
  const explicit = Bun.env.LITHIUM_NODE_CREDENTIAL_FILE?.trim();
  if (explicit) return resolve(process.cwd(), explicit);
  const stateRoot = Bun.env.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state");
  return join(stateRoot, "lithium-client", "device-credential");
}

function printPackageHelp(): void {
  console.log(`Lithium Client package runner

Run directly from GitHub:
  npx github:Lithium-Intelligence/client [command]
  bunx github:Lithium-Intelligence/client [command]

Common commands:
  help        Show this help.
  status      Show local configuration and enrollment state.

Windows commands:
  configure   Edit local Client configuration interactively.
  relink      Enroll with another account/device.
  logout      Revoke and remove the local device credential.
  startup     Manage Windows startup.

Linux commands:
  run         Connect and expose local capabilities (default).
  enroll      Sign in and store a private device credential.
  login       Alias for enroll.
  relink      Alias for enroll.`);
}

async function main(): Promise<void> {
  Bun.env.LITHIUM_CLIENT_RUNNER = "package";

  const command = (Bun.argv[2] ?? "").trim().toLowerCase();
  if (command === "help" || command === "--help" || command === "-h") {
    printPackageHelp();
    return;
  }

  if (process.platform === "win32") {
    await import("../src/client-entry");
    return;
  }

  if (process.platform === "linux") {
    const configPath = ensureLithiumClientConfigFile(linuxConfigPath());
    Bun.env.LITHIUM_NODE_CONFIG_FILE = configPath;
    Bun.env.LITHIUM_NODE_CREDENTIAL_FILE = linuxCredentialPath();
    await import("../src/linux-node-entry");
    return;
  }

  throw new Error(
    `Lithium Client package runner supports Windows and Linux. Unsupported platform: ${process.platform}.`,
  );
}

void main().catch((error) => {
  console.error(`Lithium Client: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
