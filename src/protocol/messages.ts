import { z } from "zod";
import { DEVICE_CAPABILITIES } from "../device/contracts";

export const LITHIUM_PROTOCOL_VERSION = 1 as const;
export const MAX_PROTOCOL_MESSAGE_BYTES = 2_000_000;
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000;
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_INFLIGHT_CALLS = 32;
export const DEFAULT_STREAM_WINDOW = 8;

const capabilityNameSchema = z.enum(DEVICE_CAPABILITIES);
const identifierSchema = z.string().min(1).max(160);
const isoDateSchema = z.string().datetime({ offset: true });
const jsonRecordSchema = z.record(z.string(), z.unknown());

export const capabilityDescriptorSchema = z.object({
  name: capabilityNameSchema,
  description: z.string().max(2_000).optional(),
  inputSchema: jsonRecordSchema.optional(),
  supportsStreaming: z.boolean().optional(),
  cancellable: z.boolean().optional(),
}).strict();

export const workspacePolicySchema = z.object({
  allowedExecutables: z.array(z.string().min(1).max(200)).max(100),
  allowAllExecutables: z.boolean(),
  childEnvVars: z.array(z.string().min(1).max(200)).max(200),
  allowAllChildEnv: z.boolean(),
  unsafeShellEnabled: z.boolean(),
}).strict();

export const workspaceAnnouncementSchema = z.object({
  localKey: identifierSchema,
  name: z.string().min(1).max(160),
  root: z.string().min(1).max(4_096),
  policy: workspacePolicySchema,
  capabilities: z.array(capabilityDescriptorSchema).max(200),
}).strict();

export const callContextSchema = z.object({
  correlationId: identifierSchema,
  accountId: identifierSchema.optional(),
  deviceId: identifierSchema.optional(),
}).passthrough();

export const helloMessageSchema = z.object({
  type: z.literal("hello"),
  protocolVersion: z.literal(LITHIUM_PROTOCOL_VERSION),
  credential: z.string().min(16).max(512).refine((value) => value.startsWith("ldev_"), "Invalid device credential"),
  client: z.object({
    version: z.string().min(1).max(100),
    platform: z.string().min(1).max(100),
    architecture: z.string().min(1).max(100).optional(),
    hostname: z.string().min(1).max(255).optional(),
  }).strict(),
  capabilities: z.array(capabilityDescriptorSchema).max(200),
  workspaces: z.array(workspaceAnnouncementSchema).max(100).optional(),
}).strict();

export const welcomeMessageSchema = z.object({
  type: z.literal("welcome"),
  protocolVersion: z.literal(LITHIUM_PROTOCOL_VERSION),
  connectionId: identifierSchema,
  accountId: identifierSchema,
  deviceId: identifierSchema,
  deviceName: z.string().min(1).max(160),
  heartbeatIntervalMs: z.number().int().min(1_000).max(300_000),
  heartbeatTimeoutMs: z.number().int().min(2_000).max(600_000),
  maxInflightCalls: z.number().int().min(1).max(1_000),
  streamWindow: z.number().int().min(1).max(1_000),
}).strict();

export const callMessageSchema = z.object({
  type: z.literal("call"),
  id: identifierSchema,
  capability: capabilityNameSchema,
  arguments: jsonRecordSchema,
  context: callContextSchema.optional(),
  deadlineAt: isoDateSchema.optional(),
}).strict();

export const resultMessageSchema = z.object({
  type: z.literal("result"),
  id: identifierSchema,
  result: z.unknown(),
}).strict();

export const errorMessageSchema = z.object({
  type: z.literal("error"),
  id: identifierSchema,
  error: z.object({
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(8_000),
    retryable: z.boolean().optional(),
    details: z.unknown().optional(),
  }).strict(),
}).strict();

export const cancelMessageSchema = z.object({
  type: z.literal("cancel"),
  id: identifierSchema,
  reason: z.string().min(1).max(500).optional(),
}).strict();

export const pingMessageSchema = z.object({
  type: z.literal("ping"),
  nonce: identifierSchema,
  at: isoDateSchema,
}).strict();

export const pongMessageSchema = z.object({
  type: z.literal("pong"),
  nonce: identifierSchema,
  at: isoDateSchema,
}).strict();

export const workspaceRefreshMessageSchema = z.object({
  type: z.literal("workspace_refresh"),
  workspaces: z.array(workspaceAnnouncementSchema).max(100),
}).strict();

export const streamMessageSchema = z.object({
  type: z.literal("stream"),
  id: identifierSchema,
  seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  channel: z.enum(["data", "stdout", "stderr"]).default("data"),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
  chunk: z.string().max(128_000),
}).strict();

export const streamEndMessageSchema = z.object({
  type: z.literal("stream_end"),
  id: identifierSchema,
  seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict();

export const streamAckMessageSchema = z.object({
  type: z.literal("stream_ack"),
  id: identifierSchema,
  seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict();

export const protocolErrorMessageSchema = z.object({
  type: z.literal("protocol_error"),
  code: z.string().min(1).max(100),
  message: z.string().min(1).max(2_000),
}).strict();

export const clientMessageSchema = z.discriminatedUnion("type", [
  helloMessageSchema,
  resultMessageSchema,
  errorMessageSchema,
  pongMessageSchema,
  workspaceRefreshMessageSchema,
  streamMessageSchema,
  streamEndMessageSchema,
]);

export const serverMessageSchema = z.discriminatedUnion("type", [
  welcomeMessageSchema,
  callMessageSchema,
  cancelMessageSchema,
  pingMessageSchema,
  streamAckMessageSchema,
  protocolErrorMessageSchema,
]);

export type CapabilityDescriptor = z.infer<typeof capabilityDescriptorSchema>;
export type WorkspacePolicyAnnouncement = z.infer<typeof workspacePolicySchema>;
export type WorkspaceAnnouncement = z.infer<typeof workspaceAnnouncementSchema>;
export type WorkspaceRefreshMessage = z.infer<typeof workspaceRefreshMessageSchema>;
export type CallContext = z.infer<typeof callContextSchema>;
export type HelloMessage = z.infer<typeof helloMessageSchema>;
export type WelcomeMessage = z.infer<typeof welcomeMessageSchema>;
export type CallMessage = z.infer<typeof callMessageSchema>;
export type ResultMessage = z.infer<typeof resultMessageSchema>;
export type ErrorMessage = z.infer<typeof errorMessageSchema>;
export type CancelMessage = z.infer<typeof cancelMessageSchema>;
export type PingMessage = z.infer<typeof pingMessageSchema>;
export type PongMessage = z.infer<typeof pongMessageSchema>;
export type StreamMessage = z.infer<typeof streamMessageSchema>;
export type StreamEndMessage = z.infer<typeof streamEndMessageSchema>;
export type StreamAckMessage = z.infer<typeof streamAckMessageSchema>;
export type ProtocolErrorMessage = z.infer<typeof protocolErrorMessageSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;

export class ProtocolMessageError extends Error {
  constructor(readonly code: "MESSAGE_TOO_LARGE" | "INVALID_JSON" | "INVALID_MESSAGE", message: string) {
    super(message);
  }
}

function decodePayload(payload: string | Uint8Array | ArrayBuffer): string {
  if (typeof payload === "string") {
    if (Buffer.byteLength(payload, "utf8") > MAX_PROTOCOL_MESSAGE_BYTES) {
      throw new ProtocolMessageError("MESSAGE_TOO_LARGE", "Protocol message exceeds the byte limit.");
    }
    return payload;
  }
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  if (bytes.byteLength > MAX_PROTOCOL_MESSAGE_BYTES) {
    throw new ProtocolMessageError("MESSAGE_TOO_LARGE", "Protocol message exceeds the byte limit.");
  }
  return new TextDecoder().decode(bytes);
}

function parseJson(payload: string | Uint8Array | ArrayBuffer): unknown {
  const text = decodePayload(payload);
  try {
    return JSON.parse(text);
  } catch {
    throw new ProtocolMessageError("INVALID_JSON", "Protocol message is not valid JSON.");
  }
}

export function parseClientMessage(payload: string | Uint8Array | ArrayBuffer): ClientMessage {
  const parsed = clientMessageSchema.safeParse(parseJson(payload));
  if (!parsed.success) throw new ProtocolMessageError("INVALID_MESSAGE", parsed.error.issues[0]?.message ?? "Invalid client message.");
  return parsed.data;
}

export function parseServerMessage(payload: string | Uint8Array | ArrayBuffer): ServerMessage {
  const parsed = serverMessageSchema.safeParse(parseJson(payload));
  if (!parsed.success) throw new ProtocolMessageError("INVALID_MESSAGE", parsed.error.issues[0]?.message ?? "Invalid server message.");
  return parsed.data;
}

export function encodeProtocolMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}
