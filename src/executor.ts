import { basename } from "node:path";

export interface ExecutionConfig {
  allowedExecutables: string[];
  allowAllExecutables: boolean;
  childEnvVars: string[];
  allowAllChildEnv: boolean;
  maxOutputBytes: number;
}

export interface ProcessResult {
  command: string[];
  cwd: string;
  exitCode: number | null;
  signalCode: number | string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  outputTruncated: boolean;
}

export function childEnvironment(config: ExecutionConfig): Record<string, string> {
  if (config.allowAllChildEnv) {
    return Object.fromEntries(
      Object.entries(Bun.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
  }

  const allowed = new Set(["PATH", "LANG", "LC_ALL", "TERM", "TMPDIR", ...config.childEnvVars]);
  const env: Record<string, string> = {};

  for (const name of allowed) {
    const value = Bun.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

export function executableAllowed(
  executable: string,
  allowedExecutables: readonly string[],
  allowAllExecutables = false,
): boolean {
  if (allowAllExecutables) return true;
  const normalized = basename(executable);
  return allowedExecutables.includes(executable) || allowedExecutables.includes(normalized);
}

export function assertExecutableAllowed(
  executable: string,
  allowedExecutables: readonly string[],
  allowAllExecutables = false,
): void {
  if (executableAllowed(executable, allowedExecutables, allowAllExecutables)) return;
  throw new Error(
    `Executable not allowed: ${executable}. Allowed: ${allowedExecutables.join(", ")}`,
  );
}

async function collectStream(
  stream: ReadableStream<Uint8Array>,
  byteBudget: { remaining: number; truncated: boolean },
  kill: () => void,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      if (byteBudget.remaining <= 0) {
        byteBudget.truncated = true;
        kill();
        continue;
      }

      const accepted = value.byteLength <= byteBudget.remaining
        ? value
        : value.subarray(0, byteBudget.remaining);

      chunks.push(accepted);
      total += accepted.byteLength;
      byteBudget.remaining -= accepted.byteLength;

      if (accepted.byteLength < value.byteLength) {
        byteBudget.truncated = true;
        kill();
      }
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(output);
}

export async function runProcess(options: {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  config: ExecutionConfig;
  bypassAllowlist?: boolean;
  signal?: AbortSignal;
}): Promise<ProcessResult> {
  const { executable, args, cwd, timeoutMs, config, bypassAllowlist = false, signal } = options;
  if (!bypassAllowlist) {
    assertExecutableAllowed(executable, config.allowedExecutables, config.allowAllExecutables);
  }

  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Operation cancelled.");

  const command = [executable, ...args];
  const startedAt = performance.now();
  let timedOut = false;
  let killed = false;

  const proc = Bun.spawn({
    cmd: command,
    cwd,
    env: childEnvironment(config),
    stdout: "pipe",
    stderr: "pipe",
  });

  const kill = (): void => {
    if (killed) return;
    killed = true;
    try {
      proc.kill("SIGKILL");
    } catch {
      // The process may have already exited.
    }
  };

  const abort = (): void => kill();
  signal?.addEventListener("abort", abort, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, timeoutMs);

  const byteBudget = { remaining: config.maxOutputBytes, truncated: false };

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      collectStream(proc.stdout, byteBudget, kill),
      collectStream(proc.stderr, byteBudget, kill),
      proc.exited,
    ]);

    return {
      command,
      cwd,
      exitCode,
      signalCode: proc.signalCode,
      stdout,
      stderr,
      durationMs: Math.round(performance.now() - startedAt),
      timedOut,
      outputTruncated: byteBudget.truncated,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
