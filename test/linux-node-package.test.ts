import { describe, expect, test } from "bun:test";

describe("Lithium Linux client package", () => {
  test("entrypoint composes the shared local runtime", async () => {
    const entry = await Bun.file(new URL("../src/linux-node-entry.ts", import.meta.url)).text();
    const runtime = await Bun.file(new URL("../src/linux-node/runtime.ts", import.meta.url)).text();

    expect(entry).toContain("./linux-node/runtime");
    expect(runtime).toContain("../device/runtime");
    expect(runtime).toContain("../device/client");
  });

  test("ships a hardened systemd unit with no embedded device credential", async () => {
    const unit = await Bun.file(new URL("../deploy/linux-node/lithium-client.service", import.meta.url)).text();

    expect(unit).toContain("User=lithium-node");
    expect(unit).toContain("NoNewPrivileges=true");
    expect(unit).toContain("ProtectSystem=strict");
    expect(unit).toContain("CapabilityBoundingSet=");
    expect(unit).toContain("LITHIUM_NODE_CREDENTIAL_FILE=/var/lib/lithium-node/device-credential");
    expect(unit).toContain("ExecStart=/opt/lithium-client/lithium-node run");
    expect(unit).toContain("ReadWritePaths=/var/lib/lithium-node /srv/lithium-node/workspaces");
    expect(unit).not.toContain("LITHIUM_DEVICE_CREDENTIAL=");
    expect(unit).not.toContain("ldev_");
  });

  test("example config is conservative and contains only local execution policy", async () => {
    const config = JSON.parse(await Bun.file(
      new URL("../deploy/linux-node/lithium-node.example.json", import.meta.url),
    ).text()) as Record<string, unknown>;

    expect(config.deviceName).toBe("lithium-linux-node");
    expect(config.enableUnsafeShell).toBe(false);
    expect(config.allowAllExecutables).toBe(false);
    expect(config.workspaceRoots).toEqual([
      "/srv/lithium-node/workspaces",
    ]);
    expect(config).not.toHaveProperty("deviceCredential");
    expect(config).not.toHaveProperty("password");
  });
});
