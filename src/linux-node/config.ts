import { access, stat } from "node:fs/promises";
import { posix, resolve } from "node:path";

import {
  loadLithiumClientConfig,
  type LithiumClientConfig,
} from "../client/config";

type Environment = Record<string, string | undefined>;

export type LithiumLinuxNodeConfig = LithiumClientConfig;

export function resolveLithiumLinuxNodeConfigPath(
  environment: Environment = Bun.env,
  platform: NodeJS.Platform = process.platform,
  cwd = process.cwd(),
): string {
  const explicit = environment.LITHIUM_NODE_CONFIG_FILE?.trim();
  if (explicit) return platform === "linux" ? posix.resolve(cwd, explicit) : resolve(cwd, explicit);
  return platform === "linux" ? "/etc/lithium-node/config.json" : resolve(cwd, "lithium-node.json");
}

export function loadLithiumLinuxNodeConfig(
  path: string,
  environment: Environment = Bun.env,
): LithiumLinuxNodeConfig {
  return loadLithiumClientConfig(path, environment);
}

export async function assertLithiumLinuxNodeWorkspaces(config: LithiumLinuxNodeConfig): Promise<void> {
  for (const root of config.workspaceRoots) {
    const info = await stat(root);
    if (!info.isDirectory()) throw new Error(`Linux Node workspace root is not a directory: ${root}`);
    await access(root);
  }
}
