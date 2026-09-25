import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, posix, resolve } from "node:path";

type Environment = Record<string, string | undefined>;

export function validateLinuxNodeCredential(input: string): string {
  const credential = input.trim();
  if (!/^ldev_[A-Za-z0-9_-]{20,}$/.test(credential)) {
    throw new Error("Linux Node device credential inválida.");
  }
  return credential;
}

export function resolveLithiumLinuxNodeCredentialPath(
  environment: Environment = Bun.env,
  platform: NodeJS.Platform = process.platform,
  cwd = process.cwd(),
): string {
  const explicit = environment.LITHIUM_NODE_CREDENTIAL_FILE?.trim();
  if (explicit) return platform === "linux" ? posix.resolve(cwd, explicit) : resolve(cwd, explicit);
  return platform === "linux"
    ? "/var/lib/lithium-node/device-credential"
    : resolve(cwd, ".lithium-node-device-credential");
}

export function isPrivateCredentialMode(mode: number): boolean {
  return (mode & 0o077) === 0;
}

export async function loadLithiumLinuxNodeCredential(
  path: string,
  options: { platform?: NodeJS.Platform } = {},
): Promise<string | undefined> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if ((options.platform ?? process.platform) !== "win32") {
    const info = await stat(path);
    if (!isPrivateCredentialMode(info.mode)) {
      throw new Error("Linux Node credential file deve ter mode 0600/privado.");
    }
  }
  return validateLinuxNodeCredential(content);
}

export async function saveLithiumLinuxNodeCredential(
  credentialInput: string,
  path: string,
): Promise<string> {
  const credential = validateLinuxNodeCredential(credentialInput);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, `${credential}\n`, { encoding: "utf8", mode: 0o600, flag: "w" });
  await chmod(temp, 0o600);
  await rename(temp, path);
  await chmod(path, 0o600);
  return credential;
}

export async function clearLithiumLinuxNodeCredential(path: string): Promise<boolean> {
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function resolveLithiumLinuxNodeCredential(options: {
  path: string;
  bootstrapCredential?: string;
  platform?: NodeJS.Platform;
}): Promise<string> {
  const bootstrap = options.bootstrapCredential?.trim();
  if (bootstrap) return saveLithiumLinuxNodeCredential(bootstrap, options.path);
  const stored = await loadLithiumLinuxNodeCredential(options.path, {
    ...(options.platform ? { platform: options.platform } : {}),
  });
  if (stored) return stored;
  throw new Error(
    "Linux Node credential ausente. Execute 'lithium-node enroll' em TTY ou provisione LITHIUM_DEVICE_CREDENTIAL uma vez por secret store.",
  );
}
