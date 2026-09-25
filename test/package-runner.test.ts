import { expect, test } from "bun:test";

test("package exposes one Bun-backed lithium-client executable for npx and bunx", async () => {
  const pkg = JSON.parse(await Bun.file(new URL("../package.json", import.meta.url)).text()) as {
    bin?: Record<string, string>;
    dependencies?: Record<string, string>;
    files?: string[];
  };
  const runner = await Bun.file(new URL("../bin/lithium-client.ts", import.meta.url)).text();

  expect(pkg.bin).toEqual({ "lithium-client": "./bin/lithium-client.ts" });
  expect(pkg.dependencies?.bun).toBe("1.4.2");
  expect(pkg.files).toContain("bin/");
  expect(pkg.files).toContain("src/");
  expect(runner.startsWith("#!/usr/bin/env bun")).toBe(true);
  expect(runner).toContain("npx github:Lithium-Intelligence/client");
  expect(runner).toContain("bunx github:Lithium-Intelligence/client");
  expect(runner).toContain('process.platform === "win32"');
  expect(runner).toContain('process.platform === "linux"');
});

test("Linux package-runner mode uses per-user state and cwd configuration", async () => {
  const runner = await Bun.file(new URL("../bin/lithium-client.ts", import.meta.url)).text();

  expect(runner).toContain('resolve(process.cwd(), "lithium-client.json")');
  expect(runner).toContain('join(homedir(), ".local", "state")');
  expect(runner).toContain('Bun.env.LITHIUM_NODE_CONFIG_FILE = configPath');
  expect(runner).toContain('Bun.env.LITHIUM_NODE_CREDENTIAL_FILE = linuxCredentialPath()');
});
