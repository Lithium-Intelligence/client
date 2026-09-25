import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LITHIUM_BRAIN_ASCII, LITHIUM_BRAIN_ASCII_COMPACT, renderLithiumClientBanner } from "../src/client/banner";
import {
  defaultLithiumClientConfigFile,
  ensureLithiumClientConfigFile,
  loadLithiumClientConfig,
  resolveLithiumClientConfigPath,
} from "../src/client/config";
import {
  loadDeviceCredential,
  resolveDeviceCredential,
  saveDeviceCredential,
  type DeviceCredentialCodec,
} from "../src/client/credential-store";
import { enrollDeviceWithAccount } from "../src/client/onboarding";

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

test("Lithium Client config contains only server endpoint and local machine policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "lithium-client-config-"));
  roots.push(root);
  const file = join(root, "lithium-client.json");
  ensureLithiumClientConfigFile(file);
  const raw = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;

  expect(raw).toEqual({ ...defaultLithiumClientConfigFile });
  expect(raw.serverUrl).toBe("https://ai.lithium.dev.br");
  await writeFile(file, JSON.stringify({ ...raw, unexpectedField: true }), "utf8");
  expect(() => loadLithiumClientConfig(file, {})).toThrow("unexpectedField");

  await writeFile(file, JSON.stringify({
    ...raw,
    serverUrl: "https://server.example.test/base?discard=true#fragment",
    workspaceRoots: ["./workspace-a", "./workspace-b"],
    allowedExecutables: ["bun", "git"],
    enableUnsafeShell: true,
    deviceName: "demo-workstation",
  }), "utf8");
  const loaded = loadLithiumClientConfig(file, { LITHIUM_SERVER_URL: "wss://relay.example.test" });
  expect(loaded.serverUrl).toBe("wss://relay.example.test/");
  expect(loaded.workspaceRoots).toEqual([resolve(root, "workspace-a"), resolve(root, "workspace-b")]);
  expect(loaded.workspaceRoot).toBe(resolve(root, "workspace-a"));
  expect(loaded.allowedExecutables).toEqual(["bun", "git"]);
  expect(loaded.enableUnsafeShell).toBe(true);
  expect(loaded.deviceName).toBe("demo-workstation");
});

test("Lithium Client standalone config lives beside the executable", () => {
  const path = resolveLithiumClientConfigPath({}, "C:\\Apps\\Lithium\\lithium-client.exe", "D:\\ignored");
  expect(path.replaceAll("/", "\\")).toBe("C:\\Apps\\Lithium\\lithium-client.json");
});

test("Lithium Client ships a compact standalone Lithium AI banner", () => {
  expect(LITHIUM_BRAIN_ASCII.length).toBeGreaterThan(0);
  const compactLines = LITHIUM_BRAIN_ASCII_COMPACT.split("\n");
  expect(compactLines.length).toBeLessThan(LITHIUM_BRAIN_ASCII.split("\n").length);
  expect(Math.max(...compactLines.map((line) => line.length))).toBeLessThan(80);
  const plainBanner = renderLithiumClientBanner(false);
  expect(plainBanner).toStartWith("\n");
  expect(plainBanner).not.toStartWith("\n\n");
  expect(plainBanner).toContain("LITHIUM AI // CLIENT · LOCAL EXECUTION NODE");
  expect(renderLithiumClientBanner(false)).not.toContain("\u001b[");
  expect(renderLithiumClientBanner(true)).toContain("\u001b[38;2;108;255;156m");
});

test("device credential bootstrap persists encrypted bytes and later loads without environment secret", async () => {
  const root = await mkdtemp(join(tmpdir(), "lithium-client-credential-"));
  roots.push(root);
  const path = join(root, "credential.bin");
  const secret = `ldev_${"A".repeat(43)}`;

  expect(await loadDeviceCredential(path, testCodec)).toBeUndefined();
  await resolveDeviceCredential({ bootstrapCredential: secret, path, codec: testCodec });
  const bytes = await readFile(path);
  expect(bytes.toString("utf8")).not.toContain(secret);
  expect(await loadDeviceCredential(path, testCodec)).toBe(secret);
  expect(await resolveDeviceCredential({ path, codec: testCodec })).toBe(secret);

  await writeFile(path, Buffer.from("corrupted"));
  await expect(loadDeviceCredential(path, testCodec)).rejects.toThrow("unreadable");
});

test("device credential can be acquired interactively once and then reused from protected storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "lithium-client-onboarding-credential-"));
  roots.push(root);
  const path = join(root, "credential.bin");
  const secret = `ldev_${"B".repeat(43)}`;
  let acquisitions = 0;

  expect(await resolveDeviceCredential({
    path,
    codec: testCodec,
    acquireCredential: async () => {
      acquisitions += 1;
      return secret;
    },
  })).toBe(secret);
  expect(acquisitions).toBe(1);

  expect(await resolveDeviceCredential({
    path,
    codec: testCodec,
    acquireCredential: async () => {
      acquisitions += 1;
      throw new Error("não deveria pedir novamente");
    },
  })).toBe(secret);
  expect(acquisitions).toBe(1);
});

test("first-run account enrollment creates a device credential and revokes the temporary account session", async () => {
  const secret = `ldev_${"C".repeat(43)}`;
  const calls: Array<{ url: string; method: string; cookie: string | null; body: string }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const headers = new Headers(init.headers);
    const body = typeof init.body === "string" ? init.body : "";
    calls.push({ url, method: init.method ?? "GET", cookie: headers.get("cookie"), body });

    if (url.endsWith("/server/api/auth/login")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "lithium_session=temporary-session; Path=/; HttpOnly; Secure",
        },
      });
    }
    if (url.endsWith("/server/api/devices") && (init.method ?? "GET") === "GET") {
      return Response.json({ ok: true, devices: [] });
    }
    if (url.endsWith("/server/api/devices") && init.method === "POST") {
      return Response.json({ ok: true, device: { id: "device_test", name: "demo-workstation", enabled: true } }, { status: 201 });
    }
    if (url.endsWith("/server/api/devices/device_test/credentials")) {
      return Response.json({ ok: true, secret }, { status: 201 });
    }
    if (url.endsWith("/server/api/auth/logout")) {
      return Response.json({ ok: true });
    }
    return Response.json({ ok: false, error: "unexpected request" }, { status: 500 });
  }) as typeof fetch;

  expect(await enrollDeviceWithAccount({
    serverUrl: "https://ai.lithium.dev.br",
    deviceName: "demo-workstation",
    username: "demo-user",
    password: "not-persisted-password",
    fetchImpl,
  })).toBe(secret);

  expect(calls.map((call) => [new URL(call.url).pathname, call.method])).toEqual([
    ["/server/api/auth/login", "POST"],
    ["/server/api/devices", "GET"],
    ["/server/api/devices", "POST"],
    ["/server/api/devices/device_test/credentials", "POST"],
    ["/server/api/auth/logout", "POST"],
  ]);
  expect(calls[0]!.body).toContain("not-persisted-password");
  expect(calls.slice(1).every((call) => !call.body.includes("not-persisted-password"))).toBe(true);
  expect(calls.slice(1).every((call) => call.cookie === "lithium_session=temporary-session")).toBe(true);
});

test("device credential validation rejects non-device secrets before persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "lithium-client-credential-"));
  roots.push(root);
  await expect(saveDeviceCredential("not-a-device-token", join(root, "credential.bin"), testCodec)).rejects.toThrow("inválida");
});

test("Lithium Client entrypoint composes only local runtime modules", async () => {
  const source = await Bun.file(new URL("../src/client-entry.ts", import.meta.url)).text();
  const specifiers = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)]
    .map((match) => match[1]!)
    .filter((specifier) => specifier.startsWith("."));

  expect(specifiers.length).toBeGreaterThan(0);
  expect(specifiers.every((specifier) =>
    specifier.startsWith("./client/") || specifier.startsWith("./device/") || specifier.startsWith("./terminal/")
  )).toBe(true);
  expect(specifiers).toContain("./client/config");
  expect(specifiers).toContain("./client/credential-store");
  expect(specifiers).toContain("./device/client");
  expect(specifiers).toContain("./device/runtime");
});
