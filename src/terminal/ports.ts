import { resolve } from "node:path";
import type { ProcessPort } from "./types";

interface ProcessRelation {
  pid: number;
  parentPid: number;
}

interface WindowsPortSnapshot {
  atMs: number;
  relations: ProcessRelation[];
  netstat: string;
}

const WINDOWS_PORT_SNAPSHOT_MS = 1_000;
let cachedPortSnapshot: WindowsPortSnapshot | undefined;
let portSnapshotInFlight: Promise<WindowsPortSnapshot> | undefined;

function windowsSystemPath(...parts: string[]): string {
  const systemRoot = Bun.env.SystemRoot || Bun.env.SYSTEMROOT || "C:\\Windows";
  return resolve(systemRoot, ...parts);
}

async function capture(command: string[]): Promise<{ code: number; stdout: string }> {
  const process = Bun.spawn({
    cmd: command,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });

  const [code, stdout] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
  ]);
  return { code, stdout };
}

function parseProcessRelations(text: string): ProcessRelation[] {
  const relations: ProcessRelation[] = [];

  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/[\s,]+/);
    if (parts.length < 2) continue;
    if (!/^\d+$/.test(parts[0] ?? "") || !/^\d+$/.test(parts[1] ?? "")) continue;

    const parentPid = Number(parts[0]);
    const pid = Number(parts[1]);
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(parentPid) || parentPid < 0) continue;
    relations.push({ pid, parentPid });
  }

  return relations;
}

async function windowsProcessRelations(): Promise<ProcessRelation[]> {
  const wmic = windowsSystemPath("System32", "wbem", "WMIC.exe");
  try {
    const result = await capture([wmic, "process", "get", "ProcessId,ParentProcessId"]);
    if (result.code === 0) {
      const parsed = parseProcessRelations(result.stdout);
      if (parsed.length > 0) return parsed;
    }
  } catch {
    // WMIC is deprecated and may not be installed on newer Windows versions.
  }

  const powershell = windowsSystemPath("System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = [
    "Get-CimInstance Win32_Process",
    "ForEach-Object { Write-Output (('{0},{1}' -f $_.ParentProcessId,$_.ProcessId)) }",
  ].join(" | ");

  try {
    const result = await capture([
      powershell,
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ]);
    return result.code === 0 ? parseProcessRelations(result.stdout) : [];
  } catch {
    return [];
  }
}

function collectProcessTreePids(rootPid: number, relations: readonly ProcessRelation[]): Set<number> {
  const result = new Set<number>([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const relation of relations) {
      if (!result.has(relation.parentPid) || result.has(relation.pid)) continue;
      result.add(relation.pid);
      changed = true;
    }
  }
  return result;
}

async function windowsPortSnapshot(): Promise<WindowsPortSnapshot> {
  const now = Date.now();
  if (cachedPortSnapshot && now - cachedPortSnapshot.atMs < WINDOWS_PORT_SNAPSHOT_MS) {
    return cachedPortSnapshot;
  }
  if (portSnapshotInFlight) return portSnapshotInFlight;

  portSnapshotInFlight = (async () => {
    const netstat = windowsSystemPath("System32", "netstat.exe");
    const [relations, netstatResult] = await Promise.all([
      windowsProcessRelations(),
      capture([netstat, "-ano"]).catch(() => ({ code: -1, stdout: "" })),
    ]);

    const snapshot: WindowsPortSnapshot = {
      atMs: Date.now(),
      relations,
      netstat: netstatResult.code === 0 ? netstatResult.stdout : "",
    };
    cachedPortSnapshot = snapshot;
    return snapshot;
  })();

  try {
    return await portSnapshotInFlight;
  } finally {
    portSnapshotInFlight = undefined;
  }
}

export function invalidatePortSnapshot(): void {
  cachedPortSnapshot = undefined;
}

export async function processTreePids(rootPid: number): Promise<Set<number>> {
  if (!Number.isInteger(rootPid) || rootPid <= 0) {
    throw new Error(`PID inválido para consulta de árvore: ${rootPid}.`);
  }

  if (process.platform !== "win32") return new Set([rootPid]);
  return collectProcessTreePids(rootPid, await windowsProcessRelations());
}

function parseLocalEndpoint(endpoint: string): { address: string; port: number } | undefined {
  const separator = endpoint.lastIndexOf(":");
  if (separator <= 0 || separator === endpoint.length - 1) return undefined;

  const port = Number(endpoint.slice(separator + 1));
  if (!Number.isInteger(port) || port < 0 || port > 65535) return undefined;

  return {
    address: endpoint.slice(0, separator),
    port,
  };
}

function parseNetstat(text: string, pids: ReadonlySet<number>): ProcessPort[] {
  const ports = new Map<string, ProcessPort>();

  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    const protocol = parts[0]?.toLowerCase();
    if (protocol !== "tcp" && protocol !== "udp") continue;

    const pidText = parts.at(-1);
    if (!pidText || !/^\d+$/.test(pidText)) continue;
    const pid = Number(pidText);
    if (!pids.has(pid)) continue;

    if (protocol === "tcp") {
      const state = parts.at(-2)?.toUpperCase();
      if (state !== "LISTENING" && state !== "LISTEN" && state !== "ESCUTANDO") continue;
    }

    const endpoint = parts[1] ? parseLocalEndpoint(parts[1]) : undefined;
    if (!endpoint || endpoint.port === 0) continue;

    const port: ProcessPort = {
      protocol,
      address: endpoint.address,
      port: endpoint.port,
      pid,
    };
    ports.set(`${port.protocol}|${port.address}|${port.port}|${port.pid}`, port);
  }

  return [...ports.values()].sort((a, b) =>
    a.port - b.port || a.pid - b.pid || a.protocol.localeCompare(b.protocol) || a.address.localeCompare(b.address)
  );
}

export async function findPortsForProcessTree(rootPid: number): Promise<ProcessPort[]> {
  if (!Number.isInteger(rootPid) || rootPid <= 0) {
    throw new Error(`PID inválido para consulta de portas: ${rootPid}.`);
  }
  if (process.platform !== "win32") return [];

  try {
    const snapshot = await windowsPortSnapshot();
    const pids = collectProcessTreePids(rootPid, snapshot.relations);
    return parseNetstat(snapshot.netstat, pids);
  } catch {
    return [];
  }
}
