import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";

import type { DeviceRuntimeConfig } from "../device/config";
import type { CapabilityDescriptor, WorkspaceAnnouncement } from "../protocol/messages";

function localWorkspaceKey(root: string, platform: NodeJS.Platform): string {
  const canonical = resolve(root);
  const identity = platform === "win32" ? canonical.toLowerCase() : canonical;
  return `root_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

function workspaceName(root: string): string {
  const trimmed = root.replace(/[\\/]+$/u, "");
  return basename(trimmed) || trimmed || root;
}

export function buildWorkspaceAnnouncements(
  config: DeviceRuntimeConfig,
  capabilities: readonly CapabilityDescriptor[],
  platform: NodeJS.Platform = process.platform,
): readonly WorkspaceAnnouncement[] {
  const roots = [...new Set(config.workspaceRoots.map((root) => resolve(root)))];
  return roots.map((root) => ({
    localKey: localWorkspaceKey(root, platform),
    name: workspaceName(root),
    root,
    policy: {
      allowedExecutables: [...config.allowedExecutables],
      allowAllExecutables: config.allowAllExecutables,
      childEnvVars: [...config.childEnvVars],
      allowAllChildEnv: config.allowAllChildEnv,
      unsafeShellEnabled: config.enableUnsafeShell,
    },
    capabilities: capabilities.map((capability) => ({ ...capability })),
  }));
}
