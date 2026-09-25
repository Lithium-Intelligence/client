import { DEVICE_CAPABILITIES, type DeviceCapabilityName } from "./contracts";
import {
  LITHIUM_PROTOCOL_VERSION,
  ProtocolMessageError,
  encodeProtocolMessage,
  parseServerMessage,
  type CapabilityDescriptor,
  type CallMessage,
  type ServerMessage,
  type WelcomeMessage,
  type WorkspaceAnnouncement,
} from "../protocol/messages";
import { RequestReplayGuard } from "../protocol/replay";

export type DeviceClientState = "stopped" | "connecting" | "handshaking" | "connected" | "retrying";

export interface DeviceCallExecutor {
  execute(capability: DeviceCapabilityName, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
}

export interface DeviceClientOptions {
  serverUrl: string;
  credential: string;
  clientVersion: string;
  dispatcher: DeviceCallExecutor;
  capabilities?: CapabilityDescriptor[];
  workspaces?: WorkspaceAnnouncement[];
  platform?: string;
  architecture?: string;
  hostname?: string;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  handshakeTimeoutMs?: number;
  webSocketFactory?: (url: string) => WebSocket;
}

export interface DeviceClientSnapshot {
  state: DeviceClientState;
  serverUrl: string;
  attempt: number;
  connectedAt?: string;
  accountId?: string;
  deviceId?: string;
  deviceName?: string;
  inflight: number;
  lastError?: string;
}

function normalizeAgentUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("Lithium Server URL must use http(s) or ws(s).");
  if (url.pathname === "/" || !url.pathname) url.pathname = "/agent/connect";
  return url.toString();
}

async function messagePayload(data: unknown): Promise<string | ArrayBuffer | Uint8Array> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.arrayBuffer();
  throw new Error("Unsupported WebSocket message payload.");
}

function errorCode(error: unknown): string {
  if (error instanceof ProtocolMessageError) return error.code;
  if (error && typeof error === "object" && "name" in error && error.name === "ZodError") return "INVALID_ARGUMENTS";
  return "DEVICE_EXECUTION_ERROR";
}

export class LithiumDeviceClient {
  private readonly serverUrl: string;
  private readonly reconnectMinMs: number;
  private readonly reconnectMaxMs: number;
  private readonly handshakeTimeoutMs: number;
  private readonly factory: (url: string) => WebSocket;
  private readonly capabilities: CapabilityDescriptor[];
  private workspaces: WorkspaceAnnouncement[];
  private readonly replay = new RequestReplayGuard();
  private readonly inflight = new Map<string, AbortController>();
  private state: DeviceClientState = "stopped";
  private socket: WebSocket | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;
  private stopped = true;
  private welcome: WelcomeMessage | undefined;
  private connectedAt: string | undefined;
  private lastError: string | undefined;
  private generation = 0;

  constructor(private readonly options: DeviceClientOptions) {
    this.serverUrl = normalizeAgentUrl(options.serverUrl);
    this.reconnectMinMs = Math.max(100, options.reconnectMinMs ?? 1_000);
    this.reconnectMaxMs = Math.max(this.reconnectMinMs, options.reconnectMaxMs ?? 30_000);
    this.handshakeTimeoutMs = Math.max(1_000, options.handshakeTimeoutMs ?? 10_000);
    this.factory = options.webSocketFactory ?? ((url) => new WebSocket(url));
    this.capabilities = options.capabilities ?? DEVICE_CAPABILITIES.map((name) => ({ name }));
    this.workspaces = (options.workspaces ?? []).map((workspace) => ({ ...workspace }));
  }

  refreshWorkspaces(workspaces: readonly WorkspaceAnnouncement[]): void {
    this.workspaces = workspaces.map((workspace) => ({ ...workspace }));
    if (this.state === "connected" && this.welcome) {
      this.send({ type: "workspace_refresh", workspaces: this.workspaces });
    }
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.state = "stopped";
    this.generation += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    this.reconnectTimer = undefined;
    this.handshakeTimer = undefined;
    this.abortInflight("client_stopped");
    try { this.socket?.close(1000, "client_stopped"); } catch {}
    this.socket = undefined;
    this.welcome = undefined;
    this.connectedAt = undefined;
  }

  snapshot(): DeviceClientSnapshot {
    return {
      state: this.state,
      serverUrl: this.serverUrl,
      attempt: this.attempt,
      ...(this.connectedAt ? { connectedAt: this.connectedAt } : {}),
      ...(this.welcome ? {
        accountId: this.welcome.accountId,
        deviceId: this.welcome.deviceId,
        deviceName: this.welcome.deviceName,
      } : {}),
      inflight: this.inflight.size,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  private connect(): void {
    if (this.stopped) return;
    const generation = ++this.generation;
    this.state = this.attempt ? "retrying" : "connecting";
    let socket: WebSocket;
    try {
      socket = this.factory(this.serverUrl);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.scheduleReconnect(generation);
      return;
    }
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (generation !== this.generation || this.stopped) return;
      this.state = "handshaking";
      this.send({
        type: "hello",
        protocolVersion: LITHIUM_PROTOCOL_VERSION,
        credential: this.options.credential,
        client: {
          version: this.options.clientVersion,
          platform: this.options.platform ?? process.platform,
          architecture: this.options.architecture ?? process.arch,
          ...(this.options.hostname ? { hostname: this.options.hostname } : {}),
        },
        capabilities: this.capabilities,
        workspaces: this.workspaces,
      });
      this.handshakeTimer = setTimeout(() => {
        if (generation !== this.generation || this.state === "connected") return;
        this.lastError = "Handshake timeout";
        try { socket.close(4408, "HANDSHAKE_TIMEOUT"); } catch {}
      }, this.handshakeTimeoutMs);
      this.handshakeTimer.unref?.();
    });

    socket.addEventListener("message", (event) => {
      if (generation !== this.generation || this.stopped) return;
      void this.handleIncoming(event.data, generation);
    });

    socket.addEventListener("error", () => {
      if (generation !== this.generation || this.stopped) return;
      this.lastError = "WebSocket transport error";
    });

    socket.addEventListener("close", (event) => {
      if (generation !== this.generation) return;
      if (!this.stopped && event.code !== 1000 && event.reason) this.lastError = `${event.code}: ${event.reason}`;
      if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
      this.handshakeTimer = undefined;
      this.socket = undefined;
      this.welcome = undefined;
      this.connectedAt = undefined;
      this.abortInflight("device_disconnected");
      if (this.stopped) {
        this.state = "stopped";
        return;
      }
      this.scheduleReconnect(generation);
    });
  }

  private async handleIncoming(data: unknown, generation: number): Promise<void> {
    let message: ServerMessage;
    try {
      message = parseServerMessage(await messagePayload(data));
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      try { this.socket?.close(4400, "INVALID_SERVER_MESSAGE"); } catch {}
      return;
    }
    if (generation !== this.generation || this.stopped) return;

    if (message.type === "welcome") {
      if (this.state !== "handshaking") {
        try { this.socket?.close(4400, "UNEXPECTED_WELCOME"); } catch {}
        return;
      }
      if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
      this.handshakeTimer = undefined;
      this.welcome = message;
      this.connectedAt = new Date().toISOString();
      this.state = "connected";
      this.attempt = 0;
      this.lastError = undefined;
      return;
    }

    if (message.type === "protocol_error") {
      this.lastError = `${message.code}: ${message.message}`;
      try { this.socket?.close(4400, message.code); } catch {}
      return;
    }

    if (message.type === "ping") {
      this.send({ type: "pong", nonce: message.nonce, at: new Date().toISOString() });
      return;
    }

    if (message.type === "cancel") {
      const controller = this.inflight.get(message.id);
      if (controller) {
        this.inflight.delete(message.id);
        controller.abort(new Error(message.reason ?? "Cancelled by server."));
      }
      return;
    }

    if (message.type === "stream_ack") {
      // Stream producers use the server-advertised window. Existing capabilities return bounded results,
      // so ACKs are accepted for forward compatibility without changing capability semantics.
      return;
    }

    if (message.type === "call") await this.handleCall(message);
  }

  private async handleCall(message: CallMessage): Promise<void> {
    if (this.state !== "connected" || !this.welcome) {
      this.sendError(message.id, "NOT_READY", "Device handshake is not complete.", true);
      return;
    }
    if ((message.context?.accountId && message.context.accountId !== this.welcome.accountId)
      || (message.context?.deviceId && message.context.deviceId !== this.welcome.deviceId)) {
      this.sendError(message.id, "CONTEXT_MISMATCH", "Server call context does not match this authenticated device.");
      try { this.socket?.close(4403, "CONTEXT_MISMATCH"); } catch {}
      return;
    }
    if (!this.replay.accept(message.id)) {
      this.sendError(message.id, "REPLAY_DETECTED", `Call id was already processed: ${message.id}`);
      return;
    }
    if (message.deadlineAt && Date.parse(message.deadlineAt) <= Date.now()) {
      this.sendError(message.id, "DEADLINE_EXCEEDED", "Call deadline has already expired.", true);
      return;
    }

    const controller = new AbortController();
    this.inflight.set(message.id, controller);
    try {
      const result = await this.options.dispatcher.execute(message.capability, message.arguments, controller.signal);
      if (controller.signal.aborted || !this.inflight.has(message.id)) return;
      this.inflight.delete(message.id);
      this.send({ type: "result", id: message.id, result });
    } catch (error) {
      if (controller.signal.aborted || !this.inflight.has(message.id)) return;
      this.inflight.delete(message.id);
      this.sendError(message.id, errorCode(error), error instanceof Error ? error.message : String(error));
    }
  }

  private sendError(id: string, code: string, message: string, retryable = false): void {
    this.send({ type: "error", id, error: { code, message, ...(retryable ? { retryable } : {}) } });
  }

  private send(message: Parameters<typeof encodeProtocolMessage>[0]): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) throw new Error("WebSocket is not open.");
    socket.send(encodeProtocolMessage(message));
  }

  private abortInflight(reason: string): void {
    for (const controller of this.inflight.values()) controller.abort(new Error(reason));
    this.inflight.clear();
  }

  private scheduleReconnect(generation: number): void {
    if (this.stopped || generation !== this.generation) return;
    this.attempt += 1;
    this.state = "retrying";
    const delay = Math.min(this.reconnectMaxMs, this.reconnectMinMs * 2 ** Math.max(0, this.attempt - 1));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.stopped && generation === this.generation) this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }
}
