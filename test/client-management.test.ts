import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureLithiumClientConfigFile,
  loadLithiumClientConfig,
  readLithiumClientConfigFile,
  updateLithiumClientConfigFile,
} from "../src/client/config";
import {
  clearDeviceCredential,
  loadDeviceCredential,
  saveDeviceCredential,
  type DeviceCredentialCodec,
} from "../src/client/credential-store";
import {
  inspectClientInstallation,
  relinkClientInstallation,
  unlinkClientInstallation,
} from "../src/client/management";
import { revokeDeviceCredentialWithServer } from "../src/client/onboarding";
import {
  disableWindowsStartup,
  enableWindowsStartup,
  windowsStartupCommand,
  windowsStartupStatus,
  type StartupProgramRunner,
} from "../src/client/windows-startup";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const testCodec: DeviceCredentialCodec = {
  protect(buffer) {
    return Buffer.concat([Buffer.from("TEST"), Buffer.from(buffer).reverse()]);
  },
  unprotect(buffer) {
    const value = Buffer.from(buffer);
    if (value.subarray(0, 4).toString("utf8") !== "TEST") throw new Error("invalid");
    return Buffer.from(value.subarray(4)).reverse();
  },
};

async function tempClient() {
  const root = await mkdtemp(join(tmpdir(), "lithium-client-management-"));
  roots.push(root);
  const configPath = join(root, "lithium-client.json");
  const credentialPath = join(root, "device-credential.bin");
  ensureLithiumClientConfigFile(configPath);
  return { root, configPath, credentialPath };
}

test("client config management writes atomically and keeps invalid edits out of the live file", async () => {
  const { root, configPath } = await tempClient();
  const before = await readFile(configPath, "utf8");

  const updated = updateLithiumClientConfigFile(configPath, {
    serverUrl: "https://server.example.test",
    deviceName: "desktop-flk",
    workspaceRoots: ["./one", "./two"],
    allowedExecutables: ["bun", "git"],
    enableUnsafeShell: true,
  });
  expect(updated.serverUrl).toBe("https://server.example.test");
  expect(updated.deviceName).toBe("desktop-flk");
  const runtime = loadLithiumClientConfig(configPath, {});
  expect(runtime.serverUrl).toBe("https://server.example.test/");
  expect(runtime.workspaceRoots).toEqual([join(root, "one"), join(root, "two")]);
  expect(runtime.allowedExecutables).toEqual(["bun", "git"]);
  expect(runtime.enableUnsafeShell).toBe(true);

  const stable = await readFile(configPath, "utf8");
  expect(stable).not.toBe(before);
  expect(() => updateLithiumClientConfigFile(configPath, { serverUrl: "ftp://invalid.example" })).toThrow("serverUrl");
  expect(await readFile(configPath, "utf8")).toBe(stable);

  const autoName = updateLithiumClientConfigFile(configPath, { deviceName: null });
  expect(autoName.deviceName).toBeUndefined();
  expect(readLithiumClientConfigFile(configPath)).not.toHaveProperty("deviceName");
});

test("credential clear is idempotent and protected storage never needs to expose the secret", async () => {
  const { credentialPath } = await tempClient();
  const secret = `ldev_${"A".repeat(43)}`;
  await saveDeviceCredential(secret, credentialPath, testCodec);
  expect((await readFile(credentialPath)).toString("utf8")).not.toContain(secret);
  expect(await clearDeviceCredential(credentialPath)).toBe(true);
  expect(await loadDeviceCredential(credentialPath, testCodec)).toBeUndefined();
  expect(await clearDeviceCredential(credentialPath)).toBe(false);
});

test("device self-revoke sends the ldev only in the authorization header", async () => {
  const secret = `ldev_${"B".repeat(43)}`;
  const calls: Array<{ url: string; authorization: string | null; body: BodyInit | null | undefined }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({
      url: String(input),
      authorization: new Headers(init.headers).get("authorization"),
      body: init.body,
    });
    return Response.json({ ok: true, deviceId: "device_test" });
  }) as typeof fetch;

  await revokeDeviceCredentialWithServer({ serverUrl: "https://ai.lithium.dev.br", credential: secret, fetchImpl });
  expect(calls).toHaveLength(1);
  expect(new URL(calls[0]!.url).pathname).toBe("/server/api/device-auth/revoke");
  expect(calls[0]!.authorization).toBe(`Device ${secret}`);
  expect(calls[0]!.body).toBeUndefined();
});

test("unlink revokes remotely before deleting DPAPI and preserves local recovery on remote failure", async () => {
  const { configPath, credentialPath } = await tempClient();
  const first = `ldev_${"C".repeat(43)}`;
  await saveDeviceCredential(first, credentialPath, testCodec);
  let remoteCalls = 0;
  const okFetch = (async () => {
    remoteCalls += 1;
    return Response.json({ ok: true, deviceId: "device_test" });
  }) as unknown as typeof fetch;

  expect(await unlinkClientInstallation({ configPath, credentialPath, codec: testCodec, fetchImpl: okFetch })).toEqual({
    hadCredential: true,
    serverRevoked: true,
    localRemoved: true,
  });
  expect(remoteCalls).toBe(1);
  expect(await loadDeviceCredential(credentialPath, testCodec)).toBeUndefined();

  const second = `ldev_${"D".repeat(43)}`;
  await saveDeviceCredential(second, credentialPath, testCodec);
  const failingFetch = (async () => Response.json({ ok: false, error: "offline" }, { status: 503 })) as unknown as typeof fetch;
  await expect(unlinkClientInstallation({ configPath, credentialPath, codec: testCodec, fetchImpl: failingFetch })).rejects.toThrow("offline");
  expect(await loadDeviceCredential(credentialPath, testCodec)).toBe(second);

  let localOnlyFetches = 0;
  expect(await unlinkClientInstallation({
    configPath,
    credentialPath,
    codec: testCodec,
    localOnly: true,
    fetchImpl: (async () => { localOnlyFetches += 1; return new Response(); }) as unknown as typeof fetch,
  })).toEqual({ hadCredential: true, serverRevoked: false, localRemoved: true });
  expect(localOnlyFetches).toBe(0);
});

function relinkFetch(options: { oldSecret: string; newSecret: string; failOldRevoke?: boolean }) {
  const calls: Array<{ path: string; method: string; authorization: string | null; body: string }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? init.body : "";
    calls.push({ path: url.pathname, method, authorization: headers.get("authorization"), body });
    if (url.pathname === "/server/api/auth/login") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json", "set-cookie": "lithium_session=temp; Path=/; HttpOnly" },
      });
    }
    if (url.pathname === "/server/api/devices" && method === "GET") {
      return Response.json({ devices: [{ id: "device_test", name: "desktop-new", enabled: true }] });
    }
    if (url.pathname === "/server/api/devices/device_test/credentials") {
      return Response.json({ secret: options.newSecret }, { status: 201 });
    }
    if (url.pathname === "/server/api/auth/logout") return Response.json({ ok: true });
    if (url.pathname === "/server/api/device-auth/revoke") {
      if (headers.get("authorization") === `Device ${options.oldSecret}` && options.failOldRevoke) {
        return Response.json({ ok: false, error: "cannot revoke old" }, { status: 503 });
      }
      return Response.json({ ok: true, deviceId: "device_test" });
    }
    return Response.json({ ok: false, error: `unexpected ${method} ${url.pathname}` }, { status: 500 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

test("relink is transactional: new enrollment does not destroy the working credential on rotation failure", async () => {
  const { configPath, credentialPath } = await tempClient();
  const oldSecret = `ldev_${"E".repeat(43)}`;
  const newSecret = `ldev_${"F".repeat(43)}`;
  await saveDeviceCredential(oldSecret, credentialPath, testCodec);

  const success = relinkFetch({ oldSecret, newSecret });
  const result = await relinkClientInstallation({
    configPath,
    username: "flk",
    password: "temporary-password",
    deviceName: "desktop-new",
    credentialPath,
    codec: testCodec,
    fetchImpl: success.fetchImpl,
  });
  expect(result).toEqual({ deviceName: "desktop-new", replacedCredential: true });
  expect(await loadDeviceCredential(credentialPath, testCodec)).toBe(newSecret);
  expect(success.calls.find((call) => call.path === "/server/api/device-auth/revoke")?.authorization).toBe(`Device ${oldSecret}`);
  expect(success.calls[0]?.body).toContain("temporary-password");
  expect(success.calls.slice(1).every((call) => !call.body.includes("temporary-password"))).toBe(true);

  await saveDeviceCredential(oldSecret, credentialPath, testCodec);
  const failed = relinkFetch({ oldSecret, newSecret, failOldRevoke: true });
  await expect(relinkClientInstallation({
    configPath,
    username: "flk",
    password: "temporary-password",
    deviceName: "desktop-new",
    credentialPath,
    codec: testCodec,
    fetchImpl: failed.fetchImpl,
  })).rejects.toThrow("cannot revoke old");
  expect(await loadDeviceCredential(credentialPath, testCodec)).toBe(oldSecret);
  const revokeHeaders = failed.calls.filter((call) => call.path === "/server/api/device-auth/revoke").map((call) => call.authorization);
  expect(revokeHeaders).toEqual([`Device ${oldSecret}`, `Device ${newSecret}`]);
});

test("Windows startup uses HKCU Run, no shell, and targets the standalone with --background", async () => {
  const execPath = "C:\\Apps\\Lithium\\lithium-client.exe";
  let command: string | undefined;
  const invocations: Array<{ executable: string; args: string[] }> = [];
  const runner: StartupProgramRunner = async (executable, args) => {
    invocations.push({ executable, args: [...args] });
    if (args[0] === "query") {
      return command
        ? { exitCode: 0, stdout: `    LithiumClient    REG_SZ    ${command}\r\n`, stderr: "" }
        : { exitCode: 1, stdout: "", stderr: "not found" };
    }
    if (args[0] === "add") {
      command = args[args.indexOf("/d") + 1];
      return { exitCode: 0, stdout: "OK", stderr: "" };
    }
    if (args[0] === "delete") {
      command = undefined;
      return { exitCode: 0, stdout: "OK", stderr: "" };
    }
    return { exitCode: 2, stdout: "", stderr: "unexpected" };
  };

  expect(windowsStartupCommand(execPath)).toBe(`"${execPath}" --background`);
  expect(await windowsStartupStatus({ platform: "win32", execPath, runProgram: runner })).toEqual({ enabled: false });
  expect(await enableWindowsStartup({ platform: "win32", execPath, runProgram: runner })).toBe(`"${execPath}" --background`);
  expect(await windowsStartupStatus({ platform: "win32", execPath, runProgram: runner })).toEqual({ enabled: true, command: windowsStartupCommand(execPath) });
  expect(await disableWindowsStartup({ platform: "win32", execPath, runProgram: runner })).toBe(true);
  expect(await windowsStartupStatus({ platform: "win32", execPath, runProgram: runner })).toEqual({ enabled: false });
  expect(invocations.every((entry) => entry.executable === "reg.exe")).toBe(true);
});

test("status inspection reports reachability and credential presence without returning secrets", async () => {
  const { configPath, credentialPath } = await tempClient();
  const secret = `ldev_${"G".repeat(43)}`;
  await saveDeviceCredential(secret, credentialPath, testCodec);
  updateLithiumClientConfigFile(configPath, { deviceName: "desktop-status", workspaceRoots: ["./workspace-status"] });
  const status = await inspectClientInstallation({
    configPath,
    credentialPath,
    codec: testCodec,
    platform: "win32",
    execPath: "C:\\Apps\\Lithium\\lithium-client.exe",
    runProgram: async () => ({ exitCode: 1, stdout: "", stderr: "" }),
    fetchImpl: (async () => Response.json({ ok: true, status: "ok" })) as unknown as typeof fetch,
  });
  expect(status).toMatchObject({
    deviceName: "desktop-status",
    credentialPresent: true,
    startupEnabled: false,
    serverReachable: true,
    serverStatus: "ok",
  });
  expect(JSON.stringify(status)).not.toContain(secret);
});
