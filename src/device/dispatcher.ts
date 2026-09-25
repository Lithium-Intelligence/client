import { z } from "zod";
import type { DeviceCapabilityName } from "./contracts";
import type { DeviceRuntime } from "./runtime";

const pathSchema = z.string().max(4_096);
const sha256Schema = z.string().regex(/^[a-fA-F0-9]{64}$/);
const executableSchema = z.string().min(1).max(200);
const argsSchema = z.array(z.string().max(20_000)).max(100).default([]);
const timeoutSchema = z.number().int().min(100).max(600_000).optional();
const terminalIdSchema = z.string().min(1).max(100);

export const deviceArgumentSchemas = {
  workspace_info: z.object({}).strict(),
  list_files: z.object({ path: pathSchema.optional(), depth: z.number().int().min(1).max(4).optional(), maxEntries: z.number().int().min(1).max(10_000).optional() }).strict(),
  read_file: z.object({ path: pathSchema, maxBytes: z.number().int().min(1).max(20_000_000).optional() }).strict(),
  read_image: z.object({ path: pathSchema, maxBytes: z.number().int().min(1).max(100_000_000).optional() }).strict(),
  file_info: z.object({ path: pathSchema }).strict(),
  make_directory: z.object({ path: pathSchema, recursive: z.boolean().optional() }).strict(),
  write_file: z.object({ path: pathSchema, content: z.string(), overwrite: z.boolean().optional() }).strict(),
  edit_file: z.object({ path: pathSchema, oldText: z.string().min(1), newText: z.string(), expectedOccurrences: z.number().int().min(1).max(10_000).optional() }).strict(),
  apply_patch: z.object({ path: pathSchema, patch: z.string().min(1) }).strict(),
  write_binary: z.object({ path: pathSchema, base64: z.string(), expectedSha256: sha256Schema.optional(), overwrite: z.boolean().optional() }).strict(),
  write_image: z.object({ path: pathSchema, base64: z.string(), mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]).optional(), expectedSha256: sha256Schema.optional(), overwrite: z.boolean().optional() }).strict(),
  move_file: z.object({ source: pathSchema, destination: pathSchema, overwrite: z.boolean().optional(), createParents: z.boolean().optional() }).strict(),
  delete_file: z.object({ path: pathSchema }).strict(),
  run_program: z.object({ executable: executableSchema, args: argsSchema, cwd: pathSchema.optional(), timeoutMs: timeoutSchema }).strict(),
  run_command: z.object({ command: z.string().min(1).max(20_000), cwd: pathSchema.optional(), timeoutMs: timeoutSchema }).strict(),
  terminal_start: z.object({ executable: executableSchema, args: argsSchema, cwd: pathSchema.optional(), name: z.string().min(1).max(200).optional() }).strict(),
  terminal_list: z.object({}).strict(),
  terminal_logs: z.object({ id: terminalIdSchema, after: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(1_000).optional() }).strict(),
  terminal_stop: z.object({ id: terminalIdSchema, force: z.boolean().optional() }).strict(),
} satisfies Record<DeviceCapabilityName, z.ZodTypeAny>;

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Operation cancelled.");
}

export class DeviceCapabilityDispatcher {
  constructor(private readonly runtime: DeviceRuntime) {}

  async execute(capability: DeviceCapabilityName, rawArguments: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    aborted(signal);
    const args = deviceArgumentSchemas[capability].parse(rawArguments) as any;
    let result: unknown;

    switch (capability) {
      case "workspace_info": result = this.runtime.workspaceInfo(); break;
      case "list_files": result = await this.runtime.listFiles(args); break;
      case "read_file": result = await this.runtime.readFile(args); break;
      case "read_image": result = await this.runtime.readImage(args); break;
      case "file_info": result = await this.runtime.fileInfo(args.path); break;
      case "make_directory": result = await this.runtime.makeDirectory(args); break;
      case "write_file": result = await this.runtime.writeFile(args); break;
      case "edit_file": result = await this.runtime.editFile(args); break;
      case "apply_patch": result = await this.runtime.applyPatch(args); break;
      case "write_binary": result = await this.runtime.writeBinary(args); break;
      case "write_image": result = await this.runtime.writeImage(args); break;
      case "move_file": result = await this.runtime.moveFile(args); break;
      case "delete_file": result = await this.runtime.deleteFile(args.path); break;
      case "run_program": result = await this.runtime.runProgram({ ...args, ...(signal ? { signal } : {}) }); break;
      case "run_command": result = await this.runtime.runCommand({ ...args, ...(signal ? { signal } : {}) }); break;
      case "terminal_start": result = await this.runtime.terminalStart(args); break;
      case "terminal_list": result = await this.runtime.terminalList(); break;
      case "terminal_logs": result = this.runtime.terminalLogs(args.id, { ...(args.after !== undefined ? { after: args.after } : {}), ...(args.limit !== undefined ? { limit: args.limit } : {}) }); break;
      case "terminal_stop": result = await this.runtime.terminalStop(args.id, { ...(args.force !== undefined ? { force: args.force } : {}) }); break;
      default: throw new Error(`Unsupported capability: ${capability satisfies never}`);
    }

    aborted(signal);
    return result;
  }
}
