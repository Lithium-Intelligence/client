import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

interface DeviceView {
  id: string;
  name: string;
  enabled: boolean;
}

interface LoginInput {
  username: string;
  password: string;
}

type FetchLike = typeof fetch;

class MutedTerminalOutput extends Writable {
  muted = false;

  override _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (!this.muted) process.stdout.write(chunk, encoding);
    callback();
  }
}

function requireInteractiveTerminal(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Primeiro acesso requer terminal interativo ou LITHIUM_DEVICE_CREDENTIAL para automação.");
  }
}

async function promptVisible(label: string): Promise<string> {
  requireInteractiveTerminal();
  const readline = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    return (await readline.question(label)).trim();
  } finally {
    readline.close();
  }
}

async function promptHidden(label: string): Promise<string> {
  requireInteractiveTerminal();
  process.stdout.write(label);
  const output = new MutedTerminalOutput();
  const readline = createInterface({ input: process.stdin, output, terminal: true });
  output.muted = true;
  try {
    const value = await readline.question("");
    process.stdout.write("\n");
    return value;
  } finally {
    output.muted = false;
    readline.close();
  }
}

export async function promptLithiumAccountLogin(productLabel = "Lithium Client"): Promise<LoginInput> {
  console.log(`Primeiro acesso ao ${productLabel}.`);
  console.log("Entre com sua conta para registrar este computador. A senha não será salva.");
  const username = await promptVisible("Usuário: ");
  if (!username) throw new Error("Usuário é obrigatório.");
  const password = await promptHidden("Senha: ");
  if (!password) throw new Error("Senha é obrigatória.");
  return { username, password };
}

function apiBase(serverUrl: string): URL {
  const url = new URL(serverUrl);
  if (url.protocol === "wss:") url.protocol = "https:";
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("serverUrl inválida para onboarding.");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function endpoint(base: URL, path: string): string {
  return new URL(path, base).toString();
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) return body.error.trim();
  } catch {
    // Fall back to the HTTP status below.
  }
  return `HTTP ${response.status}`;
}

async function requestJson<T>(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<{ response: Response; body: T }> {
  const response = await fetchImpl(url, init);
  if (!response.ok) throw new Error(await responseError(response));
  return { response, body: await response.json() as T };
}

function cookiePair(setCookie: string | null): string {
  const pair = setCookie?.split(";", 1)[0]?.trim();
  if (!pair?.includes("=")) throw new Error("Servidor não retornou a sessão de onboarding.");
  return pair;
}

export async function revokeDeviceCredentialWithServer(options: {
  serverUrl: string;
  credential: string;
  fetchImpl?: FetchLike;
}): Promise<void> {
  const credential = options.credential.trim();
  if (!/^ldev_[A-Za-z0-9_-]{20,}$/.test(credential)) throw new Error("Device credential inválida.");
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = apiBase(options.serverUrl);
  const response = await fetchImpl(endpoint(base, "/server/api/device-auth/revoke"), {
    method: "POST",
    headers: { authorization: `Device ${credential}` },
  });
  if (!response.ok) throw new Error(await responseError(response));
}

export async function enrollDeviceWithAccount(options: {
  serverUrl: string;
  deviceName: string;
  username: string;
  password: string;
  fetchImpl?: FetchLike;
}): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = apiBase(options.serverUrl);
  const login = await requestJson<{ ok: boolean }>(fetchImpl, endpoint(base, "/server/api/auth/login"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: options.username, password: options.password }),
  });
  const cookie = cookiePair(login.response.headers.get("set-cookie"));
  const sessionHeaders = { cookie };

  try {
    const devices = await requestJson<{ devices?: DeviceView[] }>(fetchImpl, endpoint(base, "/server/api/devices"), {
      method: "GET",
      headers: sessionHeaders,
    });
    let device = devices.body.devices?.find((candidate) => candidate.enabled && candidate.name === options.deviceName);

    if (!device) {
      const created = await requestJson<{ device: DeviceView }>(fetchImpl, endpoint(base, "/server/api/devices"), {
        method: "POST",
        headers: { ...sessionHeaders, "content-type": "application/json" },
        body: JSON.stringify({ name: options.deviceName }),
      });
      device = created.body.device;
    }

    const issued = await requestJson<{ secret: string }>(fetchImpl, endpoint(base, `/server/api/devices/${encodeURIComponent(device.id)}/credentials`), {
      method: "POST",
      headers: sessionHeaders,
    });
    if (!/^ldev_[A-Za-z0-9_-]{20,}$/.test(issued.body.secret ?? "")) {
      throw new Error("Servidor retornou uma credencial de device inválida.");
    }
    return issued.body.secret;
  } finally {
    // The web session only exists to enroll the device. Revocation is best-effort;
    // the long-lived Client authentication is the separate ldev_ credential.
    try {
      await fetchImpl(endpoint(base, "/server/api/auth/logout"), { method: "POST", headers: sessionHeaders });
    } catch {
      // Do not turn a successful device enrollment into a failure because logout failed.
    }
  }
}
