import { randomUUID } from "node:crypto";
import type { DeviceRuntimeConfig } from "../device/config";
import { findPortsForProcessTree, invalidatePortSnapshot } from "./ports";
import { TerminalSession } from "./session";
import type { ProcessPort, TerminalInfo, TerminalLogsResult } from "./types";

export interface TerminalStartOptions {
  executable: string;
  args?: string[];
  cwd: string;
  name?: string;
}

interface PortCacheEntry {
  atMs: number;
  ports: ProcessPort[];
}

const PORT_CACHE_MS = 1_500;

export class TerminalManager {
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly portCache = new Map<string, PortCacheEntry>();

  constructor(private readonly config: DeviceRuntimeConfig) {}

  start(options: TerminalStartOptions): TerminalInfo {
    this.pruneHistory();
    const activeCount = [...this.sessions.values()].filter((session) => session.active).length;
    if (activeCount >= this.config.maxTerminals) {
      throw new Error(`Active terminal limit reached: ${this.config.maxTerminals}.`);
    }

    const id = `term_${randomUUID()}`;
    const session = TerminalSession.start({
      id,
      ...(options.name ? { name: options.name } : {}),
      executable: options.executable,
      args: options.args ?? [],
      cwd: options.cwd,
      config: this.config,
    });

    this.sessions.set(id, session);
    invalidatePortSnapshot();
    return session.info();
  }

  async list(): Promise<TerminalInfo[]> {
    this.pruneHistory();
    const sessions = [...this.sessions.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return Promise.all(sessions.map((session) => this.infoWithPorts(session)));
  }

  async get(id: string): Promise<TerminalInfo> {
    this.pruneHistory();
    return this.infoWithPorts(this.requireSession(id));
  }

  logs(id: string, options: { after?: number; limit?: number } = {}): TerminalLogsResult {
    this.pruneHistory();
    return this.requireSession(id).logs(options);
  }

  async stop(id: string, options: { force?: boolean } = {}): Promise<TerminalInfo> {
    const session = this.requireSession(id);
    this.portCache.delete(id);
    const info = await session.stop(options);
    this.pruneHistory();
    return info;
  }

  async shutdown(): Promise<void> {
    const active = [...this.sessions.values()].filter((session) => session.active);
    await Promise.allSettled(active.map((session) => session.stop()));
    this.portCache.clear();
    this.pruneHistory();
  }

  private requireSession(id: string): TerminalSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Terminal not found: ${id}.`);
    return session;
  }

  private pruneHistory(): void {
    const inactive = [...this.sessions.values()]
      .filter((session) => !session.active)
      .sort((a, b) => {
        const aTime = a.info().exitedAt ?? a.startedAt;
        const bTime = b.info().exitedAt ?? b.startedAt;
        return bTime.localeCompare(aTime);
      });

    for (const session of inactive) session.dispose();

    for (const session of inactive.slice(this.config.terminalHistoryLimit)) {
      this.sessions.delete(session.id);
      this.portCache.delete(session.id);
      session.dispose();
    }
  }

  private async infoWithPorts(session: TerminalSession): Promise<TerminalInfo> {
    const info = session.info();
    if (!session.active) {
      this.portCache.delete(session.id);
      return info;
    }

    const now = Date.now();
    const cached = this.portCache.get(session.id);
    const cacheMs = cached?.ports.length ? PORT_CACHE_MS : 250;
    if (cached && now - cached.atMs < cacheMs) {
      return { ...info, ports: cached.ports.map((port) => ({ ...port })) };
    }

    const ports = await findPortsForProcessTree(info.pid);
    this.portCache.set(session.id, { atMs: now, ports });
    return { ...info, ports };
  }
}
