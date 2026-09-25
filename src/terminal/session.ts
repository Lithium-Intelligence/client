import type { DeviceRuntimeConfig } from "../device/config";
import { assertExecutableAllowed, childEnvironment } from "../executor";
import { TerminalLogBuffer, type TerminalLogReadOptions } from "./logs";
import { terminateProcessTree } from "./process-tree";
import type { TerminalInfo, TerminalLogsResult, TerminalLogStream, TerminalStatus } from "./types";

const FORCE_KILL_WAIT_MS = 5_000;

export interface TerminalSessionOptions {
  id: string;
  name?: string;
  executable: string;
  args?: string[];
  cwd: string;
  config: DeviceRuntimeConfig;
}

export class TerminalSession {
  readonly id: string;
  readonly name: string | undefined;
  readonly command: string[];
  readonly cwd: string;
  readonly startedAt: string;

  private readonly logBuffer: TerminalLogBuffer;
  private readonly stopGraceMs: number;
  private process: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
  private processPid?: number;
  private status: TerminalStatus = "starting";
  private exitedAt?: string;
  private exitCode?: number | null;
  private signalCode?: number | string | null;

  private constructor(options: TerminalSessionOptions) {
    this.id = options.id;
    this.name = options.name;
    this.command = [options.executable, ...(options.args ?? [])];
    this.cwd = options.cwd;
    this.startedAt = new Date().toISOString();
    this.logBuffer = new TerminalLogBuffer(options.config.maxTerminalLogBytes);
    this.stopGraceMs = options.config.terminalStopGraceMs;
  }

  static start(options: TerminalSessionOptions): TerminalSession {
    const session = new TerminalSession(options);
    session.spawn(options);
    return session;
  }

  get pid(): number {
    if (this.processPid === undefined) throw new Error(`Terminal ${this.id} ainda não possui PID.`);
    return this.processPid;
  }

  get currentStatus(): TerminalStatus {
    return this.status;
  }

  get active(): boolean {
    return this.status === "starting" || this.status === "running" || this.status === "stopping";
  }

  info(): TerminalInfo {
    return {
      id: this.id,
      ...(this.name ? { name: this.name } : {}),
      command: [...this.command],
      cwd: this.cwd,
      pid: this.pid,
      status: this.status,
      startedAt: this.startedAt,
      ...(this.exitedAt ? { exitedAt: this.exitedAt } : {}),
      ...(this.exitCode !== undefined ? { exitCode: this.exitCode } : {}),
      ...(this.signalCode !== undefined ? { signalCode: this.signalCode } : {}),
      ports: [],
    };
  }

  logs(options: TerminalLogReadOptions = {}): TerminalLogsResult {
    const result = this.logBuffer.read(options);
    return {
      id: this.id,
      status: this.status,
      nextSeq: result.nextSeq,
      entries: result.entries,
    };
  }

  async stop(options: { force?: boolean } = {}): Promise<TerminalInfo> {
    const process = this.process;
    if (!process || !this.active) return this.info();

    this.status = "stopping";

    if (options.force) {
      const treeHandled = await terminateProcessTree(process.pid, true);
      if (!treeHandled) this.killProcess(process, "SIGKILL");
      if (!(await this.waitForExit(process, FORCE_KILL_WAIT_MS))) {
        throw new Error(`Terminal ${this.id} não encerrou após force kill.`);
      }
      return this.info();
    }

    const treeHandled = await terminateProcessTree(process.pid, false);
    if (!treeHandled) this.killProcess(process, "SIGTERM");
    const exitedGracefully = await Promise.race([
      process.exited.then(() => true),
      Bun.sleep(this.stopGraceMs).then(() => false),
    ]);

    if (!exitedGracefully) {
      const forcedTreeHandled = await terminateProcessTree(process.pid, true);
      if (!forcedTreeHandled) this.killProcess(process, "SIGKILL");
      if (!(await this.waitForExit(process, FORCE_KILL_WAIT_MS))) {
        throw new Error(`Terminal ${this.id} não encerrou após force kill.`);
      }
    }

    return this.info();
  }

  private async waitForExit(
    process: Bun.Subprocess<"ignore", "pipe", "pipe">,
    timeoutMs: number,
  ): Promise<boolean> {
    return Promise.race([
      process.exited.then(() => true),
      Bun.sleep(timeoutMs).then(() => false),
    ]);
  }

  private killProcess(process: Bun.Subprocess<"ignore", "pipe", "pipe">, signal: NodeJS.Signals): void {
    try {
      process.kill(signal);
    } catch {
      // The process may have exited between the status check and kill call.
    }
  }

  dispose(): void {
    if (this.active) throw new Error(`Terminal ${this.id} ainda está ativo e não pode ser descartado.`);
    this.process = undefined;
  }

  private spawn(options: TerminalSessionOptions): void {
    assertExecutableAllowed(
      options.executable,
      options.config.allowedExecutables,
      options.config.allowAllExecutables,
    );

    try {
      const process = Bun.spawn({
        cmd: this.command,
        cwd: this.cwd,
        env: childEnvironment(options.config),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });

      this.process = process;
      this.processPid = process.pid;
      this.status = "running";

      void this.consumeStream(process.stdout, "stdout");
      void this.consumeStream(process.stderr, "stderr");
      void this.watchExit(process);
    } catch (error) {
      this.status = "failed";
      this.exitedAt = new Date().toISOString();
      throw error;
    }
  }

  private async consumeStream(stream: ReadableStream<Uint8Array>, channel: TerminalLogStream): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;

        const text = decoder.decode(value, { stream: true });
        if (text) this.logBuffer.append(channel, text);
      }

      const tail = decoder.decode();
      if (tail) this.logBuffer.append(channel, tail);
    } catch (error) {
      // Stream-reading failures should not crash the client. Preserve the failure in
      // stderr so callers can diagnose it while the process lifecycle continues.
      const message = error instanceof Error ? error.message : String(error);
      this.logBuffer.append("stderr", `[Lithium Client] Falha ao ler ${channel}: ${message}\n`);
    } finally {
      reader.releaseLock();
    }
  }

  private async watchExit(process: Bun.Subprocess<"ignore", "pipe", "pipe">): Promise<void> {
    const exitCode = await process.exited;
    this.exitCode = exitCode;
    this.signalCode = process.signalCode;
    this.exitedAt = new Date().toISOString();

    if (this.status === "stopping") {
      this.status = "exited";
      return;
    }

    this.status = exitCode === 0 ? "exited" : "failed";
  }
}
