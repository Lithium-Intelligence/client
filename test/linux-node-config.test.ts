import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadLithiumLinuxNodeConfig,
  resolveLithiumLinuxNodeConfigPath,
} from "../src/linux-node/config";
import {
  isPrivateCredentialMode,
  loadLithiumLinuxNodeCredential,
  resolveLithiumLinuxNodeCredential,
  resolveLithiumLinuxNodeCredentialPath,
  saveLithiumLinuxNodeCredential,
} from "../src/linux-node/credential-store";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Lithium Linux Node config and credential storage", () => {
  test("uses Linux system paths by default and supports explicit provisioning paths", () => {
    expect(resolveLithiumLinuxNodeConfigPath({}, "linux", "/tmp")).toBe("/etc/lithium-node/config.json");
    expect(resolveLithiumLinuxNodeCredentialPath({}, "linux", "/tmp")).toBe("/var/lib/lithium-node/device-credential");
    expect(resolveLithiumLinuxNodeConfigPath({ LITHIUM_NODE_CONFIG_FILE: "./node.json" }, "linux", "/srv"))
      .toBe("/srv/node.json");
    expect(resolveLithiumLinuxNodeCredentialPath({ LITHIUM_NODE_CREDENTIAL_FILE: "./secret" }, "linux", "/srv"))
      .toBe("/srv/secret");
  });

  test("loads the shared DeviceRuntime policy contract from a Linux Node config", async () => {
    const root = await mkdtemp(join(tmpdir(), "lithium-linux-node-config-"));
    roots.push(root);
    const workspace = join(root, "workspace");
    await Bun.write(join(root, "config.json"), JSON.stringify({
      serverUrl: "https://ai.lithium.dev.br",
      clientVersion: "0.1.0",
      deviceName: "linux-node-test",
      workspaceRoots: ["./workspace"],
      allowedExecutables: ["bun", "git"],
      enableUnsafeShell: false
    }));
    const config = loadLithiumLinuxNodeConfig(join(root, "config.json"), {});
    expect(config).toMatchObject({
      serverUrl: "https://ai.lithium.dev.br/",
      deviceName: "linux-node-test",
      workspaceRoot: workspace,
      workspaceRoots: [workspace],
      allowedExecutables: ["bun", "git"],
      enableUnsafeShell: false,
    });
  });

  test("persists only ldev credentials in a private file and rejects broad Linux permissions", async () => {
    const root = await mkdtemp(join(tmpdir(), "lithium-linux-node-credential-"));
    roots.push(root);
    const path = join(root, "device-credential");
    const secret = "ldev_abcdefghijklmnopqrstuvwxyz0123456789";
    await saveLithiumLinuxNodeCredential(secret, path);
    expect(isPrivateCredentialMode(0o100600)).toBe(true);
    expect(isPrivateCredentialMode(0o100644)).toBe(false);
    expect(await loadLithiumLinuxNodeCredential(path, { platform: process.platform })).toBe(secret);

    if (process.platform !== "win32") {
      const info = await stat(path);
      expect(isPrivateCredentialMode(info.mode)).toBe(true);
      await chmod(path, 0o644);
      await expect(loadLithiumLinuxNodeCredential(path, { platform: "linux" }))
        .rejects.toThrow("0600");
    }

    await expect(saveLithiumLinuxNodeCredential("not-a-device-credential", path))
      .rejects.toThrow("device credential");
  });

  test("one-shot bootstrap persists the device credential and later runs without the environment secret", async () => {
    const root = await mkdtemp(join(tmpdir(), "lithium-linux-node-bootstrap-"));
    roots.push(root);
    const path = join(root, "device-credential");
    const secret = "ldev_0123456789abcdefghijklmnopqrstuvwxyz";
    expect(await resolveLithiumLinuxNodeCredential({
      path,
      bootstrapCredential: secret,
      platform: "linux",
    })).toBe(secret);
    expect(await resolveLithiumLinuxNodeCredential({ path, platform: process.platform })).toBe(secret);
  });
});
