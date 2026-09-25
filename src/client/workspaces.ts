import { createHash } from "node:crypto";
import { posix, win32 } from "node:path";

import type { DeviceRuntimeConfig } from "../device/config";
import type { CapabilityDescriptor, WorkspaceAnnouncement } from "../protocol/messages";

function pathApi(platform: NodeJS.Platform): typeof posix | typeof win32 {
  return platform === "win32" ? win32 : posix;
}

function canonicalWorkspaceRoot(root: string, platform: NodeJS.Platform): string {
  return pathApi(platform).resolve(root);
}

function localWorkspaceKey(root: string, platform: NodeJS.Platform): string {
  const canonical = canonicalWorkspaceRoot(root, platform);
  const identity = platform === "win32" ? canonical.toLowerCase() : canonical;
  return `root_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

function workspaceName(root: string, platform: NodeJS.Platform): string {
  const canonical = canonicalWorkspaceRoot(root, platform);
  return pathApi(platform).basename(canonical) || canonical || root;
}

export function buildWorkspaceAnnouncements(
  config: DeviceRuntimeConfig,
  capabilities: readonly CapabilityDescriptor[],
  platform: NodeJS.Platform = process.platform,
): readonly WorkspaceAnnouncement[] {
  const seen = new Set<string>();
  const roots: string[] = [];

  for (const root of config.workspaceRoots) {
    const canonical = canonicalWorkspaceRoot(root, platform);
    const identity = platform === "win32" ? canonical.toLowerCase() : canonical;
    if (seen.has(identity)) continue;
    seen.add(identity);
    roots.push(canonical);
  }

  return roots.map((root) => ({
    localKey: localWorkspaceKey(root, platform),
    name: workspaceName(root, platform),
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
