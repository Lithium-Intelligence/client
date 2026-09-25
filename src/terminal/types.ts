export type TerminalStatus =
  | "starting"
  | "running"
  | "stopping"
  | "exited"
  | "failed";

export type TerminalLogStream = "stdout" | "stderr";

export interface ProcessPort {
  protocol: "tcp" | "udp";
  address: string;
  port: number;
  pid: number;
}

export interface TerminalLogEntry {
  seq: number;
  at: string;
  stream: TerminalLogStream;
  text: string;
}

export interface TerminalInfo {
  id: string;
  name?: string;
  command: string[];
  cwd: string;
  pid: number;
  status: TerminalStatus;
  startedAt: string;
  exitedAt?: string;
  exitCode?: number | null;
  signalCode?: number | string | null;
  ports: ProcessPort[];
}

export interface TerminalLogsResult {
  id: string;
  status: TerminalStatus;
  nextSeq: number;
  entries: TerminalLogEntry[];
}
