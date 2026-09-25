import { describe, expect, test } from "bun:test";

import { buildWorkspaceAnnouncements } from "../src/client/workspaces";
import type { DeviceRuntimeConfig } from "../src/device/config";

function config(workspaceRoots: string[]): DeviceRuntimeConfig {
  return {
    workspaceRoot: workspaceRoots[0] ?? "D:\\DEV",
    workspaceRoots,
    defaultTimeoutMs: 30_000,
    maxTimeoutMs: 60_000,
    maxOutputBytes: 1_000_000,
    maxFileBytes: 2_000_000,
    maxImageBytes: 5_000_000,
    maxImagePixels: 10_000_000,
    maxListEntries: 10_000,
    maxTerminals: 4,
    maxTerminalLogBytes: 1_000_000,
    terminalStopGraceMs: 5_000,
    terminalHistoryLimit: 20,
    allowedExecutables: ["bun", "git"],
    allowAllExecutables: false,
    childEnvVars: ["PATH"],
    allowAllChildEnv: false,
    enableUnsafeShell: false,
  };
}

describe("Lithium Client workspace announcements", () => {
  test("derives stable per-root keys and advertises only effective local policy/capabilities", () => {
    const first = buildWorkspaceAnnouncements(
      config(["D:\\DEV\\repo", "D:\\Docs", "D:\\DEV\\repo"]),
      [{ name: "read_file" }, { name: "run_program", cancellable: true }],
      "win32",
    );
    const second = buildWorkspaceAnnouncements(
      config(["D:\\DEV\\repo", "D:\\Docs"]),
      [{ name: "read_file" }, { name: "run_program", cancellable: true }],
      "win32",
    );

    expect(first).toHaveLength(2);
    expect(first.map((workspace) => workspace.localKey)).toEqual(second.map((workspace) => workspace.localKey));
    expect(new Set(first.map((workspace) => workspace.localKey)).size).toBe(2);
    expect(first.map((workspace) => workspace.name)).toEqual(["repo", "Docs"]);
    expect(first[0]?.policy).toEqual({
      allowedExecutables: ["bun", "git"],
      allowAllExecutables: false,
      childEnvVars: ["PATH"],
      allowAllChildEnv: false,
      unsafeShellEnabled: false,
    });
    expect(first[0]?.capabilities).toEqual([
      { name: "read_file" },
      { name: "run_program", cancellable: true },
    ]);
    expect(first[0]).not.toHaveProperty("accountId");
    expect(first[0]).not.toHaveProperty("ownerUserId");
    expect(first[0]).not.toHaveProperty("id");
  });
});
