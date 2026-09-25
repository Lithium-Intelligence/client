import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createWindowsDpapiCodec } from "./windows-dpapi";

interface StoredCredential {
  v: 1;
  credential: string;
}

export interface DeviceCredentialCodec {
  protect(buffer: Uint8Array): Uint8Array;
  unprotect(buffer: Uint8Array): Uint8Array;
}

function validateCredential(value: string): string {
  const credential = value.trim();
  if (!/^ldev_[A-Za-z0-9_-]{20,}$/.test(credential)) throw new Error("Invalid device credential.");
  return credential;
}

function defaultCodec(): DeviceCredentialCodec {
  return createWindowsDpapiCodec();
}

export function defaultDeviceCredentialPath(environment: Record<string, string | undefined> = Bun.env): string {
  if (process.platform !== "win32") throw new Error("Lithium Client credential storage requires Windows DPAPI.");
  const localAppData = environment.LOCALAPPDATA?.trim() || join(homedir(), "AppData", "Local");
  return join(localAppData, "Lithium", "client", "device-credential.bin");
}

export async function loadDeviceCredential(
  path = defaultDeviceCredentialPath(),
  codec: DeviceCredentialCodec = defaultCodec(),
): Promise<string | undefined> {
  let encrypted: Buffer;
  try {
    encrypted = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let payload: StoredCredential;
  try {
    payload = JSON.parse(Buffer.from(codec.unprotect(encrypted)).toString("utf8")) as StoredCredential;
  } catch {
    throw new Error("Device credential storage is unreadable or belongs to another Windows user.");
  }
  if (payload?.v !== 1 || typeof payload.credential !== "string") {
    throw new Error("Device credential storage has an unsupported format.");
  }
  return validateCredential(payload.credential);
}

export async function saveDeviceCredential(
  credentialInput: string,
  path = defaultDeviceCredentialPath(),
  codec: DeviceCredentialCodec = defaultCodec(),
): Promise<string> {
  const credential = validateCredential(credentialInput);
  const encrypted = codec.protect(Buffer.from(JSON.stringify({ v: 1, credential } satisfies StoredCredential), "utf8"));
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, encrypted, { flag: "w" });
  await rename(temp, path);
  return credential;
}

export async function clearDeviceCredential(path = defaultDeviceCredentialPath()): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function resolveDeviceCredential(options: {
  bootstrapCredential?: string;
  path?: string;
  codec?: DeviceCredentialCodec;
  acquireCredential?: () => Promise<string>;
} = {}): Promise<string> {
  const path = options.path ?? defaultDeviceCredentialPath();
  const codec = options.codec ?? defaultCodec();
  const bootstrap = options.bootstrapCredential?.trim();
  if (bootstrap) return saveDeviceCredential(bootstrap, path, codec);
  const stored = await loadDeviceCredential(path, codec);
  if (stored) return stored;
  if (options.acquireCredential) {
    return saveDeviceCredential(await options.acquireCredential(), path, codec);
  }
  throw new Error("Device credential is missing. Run the Client in an interactive terminal to sign in, or use LITHIUM_DEVICE_CREDENTIAL for automation.");
}
