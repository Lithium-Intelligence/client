import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { decodeBase64, sha256Hex } from "../binary";
import type { DeviceRuntimeConfig } from "./config";
import { runProcess, type ProcessResult } from "../executor";
import { imageMetadata } from "../image";
import { assertRegularFile, resolveWorkspacePath, workspaceRootForPath } from "../security";
import type { TerminalManager } from "../terminal/manager";
import type { TerminalInfo, TerminalLogsResult } from "../terminal/types";
import { applyUnifiedPatch, replaceExactOccurrences } from "../text-patch";

export interface DeviceWorkspaceInfo {
  workspaceRoot: string;
  workspaceRoots: string[];
  allowedExecutables: string[];
  allowAllExecutables: boolean;
  allowAllChildEnv: boolean;
  unsafeShellEnabled: boolean;
  limits: {
    defaultTimeoutMs: number;
    maxTimeoutMs: number;
    maxOutputBytes: number;
    maxFileBytes: number;
    maxImageBytes: number;
    maxImagePixels: number;
    maxListEntries: number;
  };
  terminalLimits: {
    maxTerminals: number;
    maxLogBytes: number;
    stopGraceMs: number;
    historyLimit: number;
  };
}

export interface DeviceImageReadResult {
  path: string;
  workspaceRoot: string;
  size: number;
  width: number;
  height: number;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  sha256: string;
  resampled: false;
  base64: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function textBytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

async function listTree(options: {
  root: string;
  start: string;
  depth: number;
  maxEntries: number;
}): Promise<Array<{ path: string; type: "file" | "directory" | "symlink" | "other"; size?: number }>> {
  const entries: Array<{ path: string; type: "file" | "directory" | "symlink" | "other"; size?: number }> = [];

  async function walk(current: string, remainingDepth: number): Promise<void> {
    if (entries.length >= options.maxEntries) return;
    const children = await readdir(current, { withFileTypes: true });
    children.sort((a, b) => a.name.localeCompare(b.name));

    for (const child of children) {
      if (entries.length >= options.maxEntries) return;
      const absolute = join(current, child.name);
      const path = relative(options.root, absolute) || ".";

      if (child.isSymbolicLink()) {
        entries.push({ path, type: "symlink" });
        continue;
      }
      if (child.isDirectory()) {
        entries.push({ path, type: "directory" });
        if (remainingDepth > 1) await walk(absolute, remainingDepth - 1);
        continue;
      }
      if (child.isFile()) {
        const info = await stat(absolute);
        entries.push({ path, type: "file", size: info.size });
        continue;
      }
      entries.push({ path, type: "other" });
    }
  }

  await walk(options.start, options.depth);
  return entries;
}

export class DeviceRuntime {
  constructor(
    private readonly config: DeviceRuntimeConfig,
    private readonly terminalManager: TerminalManager,
  ) {}

  workspaceInfo(): DeviceWorkspaceInfo {
    const config = this.config;
    return {
      workspaceRoot: config.workspaceRoot,
      workspaceRoots: [...config.workspaceRoots],
      allowedExecutables: [...config.allowedExecutables],
      allowAllExecutables: config.allowAllExecutables,
      allowAllChildEnv: config.allowAllChildEnv,
      unsafeShellEnabled: config.enableUnsafeShell,
      limits: {
        defaultTimeoutMs: config.defaultTimeoutMs,
        maxTimeoutMs: config.maxTimeoutMs,
        maxOutputBytes: config.maxOutputBytes,
        maxFileBytes: config.maxFileBytes,
        maxImageBytes: config.maxImageBytes,
        maxImagePixels: config.maxImagePixels,
        maxListEntries: config.maxListEntries,
      },
      terminalLimits: {
        maxTerminals: config.maxTerminals,
        maxLogBytes: config.maxTerminalLogBytes,
        stopGraceMs: config.terminalStopGraceMs,
        historyLimit: config.terminalHistoryLimit,
      },
    };
  }

  async listFiles(options: { path?: string; depth?: number; maxEntries?: number } = {}) {
    const path = options.path ?? ".";
    const depth = options.depth ?? 2;
    const start = await resolveWorkspacePath(this.config.workspaceRoots, path);
    const workspaceRoot = await workspaceRootForPath(this.config.workspaceRoots, start);
    const effectiveLimit = Math.min(options.maxEntries ?? this.config.maxListEntries, this.config.maxListEntries);
    const entries = await listTree({ root: workspaceRoot, start, depth, maxEntries: effectiveLimit });
    return { path, workspaceRoot, entries, truncated: entries.length >= effectiveLimit };
  }

  async readFile(options: { path: string; maxBytes?: number }) {
    const absolute = await resolveWorkspacePath(this.config.workspaceRoots, options.path);
    await assertRegularFile(absolute);
    const info = await stat(absolute);
    const limit = Math.min(options.maxBytes ?? this.config.maxFileBytes, this.config.maxFileBytes);
    if (info.size > limit) throw new Error(`File with ${info.size} bytes exceeds the limit of ${limit}.`);
    return { path: options.path, size: info.size, content: await Bun.file(absolute).text() };
  }

  async readImage(options: { path: string; maxBytes?: number }): Promise<DeviceImageReadResult> {
    const absolute = await resolveWorkspacePath(this.config.workspaceRoots, options.path);
    await assertRegularFile(absolute);
    const workspaceRoot = await workspaceRootForPath(this.config.workspaceRoots, absolute);
    const info = await stat(absolute);
    const limit = Math.min(options.maxBytes ?? this.config.maxImageBytes, this.config.maxImageBytes);
    if (info.size > limit) throw new Error(`Image with ${info.size} bytes exceeds the limit of ${limit}.`);

    const bytes = new Uint8Array(await Bun.file(absolute).arrayBuffer());
    const metadata = imageMetadata(bytes);
    this.assertImagePixels(metadata.width, metadata.height);
    return {
      path: options.path,
      workspaceRoot,
      size: info.size,
      width: metadata.width,
      height: metadata.height,
      mimeType: metadata.mimeType,
      sha256: metadata.sha256,
      resampled: false,
      base64: Buffer.from(bytes).toString("base64"),
    };
  }

  async fileInfo(path: string) {
    const absolute = await resolveWorkspacePath(this.config.workspaceRoots, path);
    const workspaceRoot = await workspaceRootForPath(this.config.workspaceRoots, absolute);
    const info = await stat(absolute);
    const type = info.isFile() ? "file" as const : info.isDirectory() ? "directory" as const : "other" as const;
    return {
      path,
      workspaceRoot,
      type,
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
      createdAt: info.birthtime.toISOString(),
    };
  }

  async makeDirectory(options: { path: string; recursive?: boolean }) {
    const recursive = options.recursive ?? true;
    const absolute = await resolveWorkspacePath(this.config.workspaceRoots, options.path, { allowMissing: true });
    const existed = await pathExists(absolute);
    await mkdir(absolute, { recursive });
    return {
      path: options.path,
      workspaceRoot: await workspaceRootForPath(this.config.workspaceRoots, absolute),
      created: !existed,
    };
  }

  async writeFile(options: { path: string; content: string; overwrite?: boolean }) {
    const overwrite = options.overwrite ?? false;
    const bytes = textBytes(options.content);
    if (bytes > this.config.maxFileBytes) {
      throw new Error(`Content with ${bytes} bytes exceeds the limit of ${this.config.maxFileBytes}.`);
    }
    const absolute = await resolveWorkspacePath(this.config.workspaceRoots, options.path, { allowMissing: true });
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, options.content, { encoding: "utf8", flag: overwrite ? "w" : "wx" });
    return { path: options.path, bytes, overwritten: overwrite };
  }

  async editFile(options: { path: string; oldText: string; newText: string; expectedOccurrences?: number }) {
    const absolute = await resolveWorkspacePath(this.config.workspaceRoots, options.path);
    await assertRegularFile(absolute);
    const info = await stat(absolute);
    if (info.size > this.config.maxFileBytes) {
      throw new Error(`File with ${info.size} bytes exceeds the limit of ${this.config.maxFileBytes}.`);
    }
    const original = await Bun.file(absolute).text();
    const edited = replaceExactOccurrences(original, options.oldText, options.newText, options.expectedOccurrences ?? 1);
    const bytes = textBytes(edited.content);
    if (bytes > this.config.maxFileBytes) {
      throw new Error(`Result with ${bytes} bytes exceeds the limit of ${this.config.maxFileBytes}.`);
    }
    await writeFile(absolute, edited.content, { encoding: "utf8", flag: "w" });
    return { path: options.path, bytes, replacements: edited.replacements };
  }

  async applyPatch(options: { path: string; patch: string }) {
    const patchBytes = textBytes(options.patch);
    if (patchBytes > this.config.maxFileBytes) {
      throw new Error(`Patch with ${patchBytes} bytes exceeds the limit of ${this.config.maxFileBytes}.`);
    }
    const absolute = await resolveWorkspacePath(this.config.workspaceRoots, options.path);
    await assertRegularFile(absolute);
    const info = await stat(absolute);
    if (info.size > this.config.maxFileBytes) {
      throw new Error(`File with ${info.size} bytes exceeds the limit of ${this.config.maxFileBytes}.`);
    }
    const applied = applyUnifiedPatch(await Bun.file(absolute).text(), options.patch);
    const bytes = textBytes(applied.content);
    if (bytes > this.config.maxFileBytes) {
      throw new Error(`Result with ${bytes} bytes exceeds the limit of ${this.config.maxFileBytes}.`);
    }
    await writeFile(absolute, applied.content, { encoding: "utf8", flag: "w" });
    return {
      path: options.path,
      bytes,
      hunks: applied.hunks,
      additions: applied.additions,
      deletions: applied.deletions,
    };
  }

  async writeBinary(options: { path: string; base64: string; expectedSha256?: string; overwrite?: boolean }) {
    const overwrite = options.overwrite ?? false;
    const bytes = decodeBase64(options.base64, {
      maxBytes: this.config.maxFileBytes,
      ...(options.expectedSha256 ? { expectedSha256: options.expectedSha256 } : {}),
    });
    const absolute = await resolveWorkspacePath(this.config.workspaceRoots, options.path, { allowMissing: true });
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes, { flag: overwrite ? "w" : "wx" });
    return {
      path: options.path,
      bytes: bytes.byteLength,
      sha256: sha256Hex(bytes),
      overwritten: overwrite,
    };
  }

  async writeImage(options: {
    path: string;
    base64: string;
    mimeType?: "image/png" | "image/jpeg" | "image/webp";
    expectedSha256?: string;
    overwrite?: boolean;
  }) {
    const overwrite = options.overwrite ?? false;
    const bytes = decodeBase64(options.base64, {
      maxBytes: this.config.maxImageBytes,
      ...(options.expectedSha256 ? { expectedSha256: options.expectedSha256 } : {}),
    });
    const metadata = imageMetadata(bytes);
    this.assertImagePixels(metadata.width, metadata.height);
    if (options.mimeType && metadata.mimeType !== options.mimeType) {
      throw new Error(`MIME divergente: declarado ${options.mimeType}, detectado ${metadata.mimeType}.`);
    }
    const absolute = await resolveWorkspacePath(this.config.workspaceRoots, options.path, { allowMissing: true });
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes, { flag: overwrite ? "w" : "wx" });
    return {
      path: options.path,
      workspaceRoot: await workspaceRootForPath(this.config.workspaceRoots, absolute),
      size: bytes.byteLength,
      width: metadata.width,
      height: metadata.height,
      mimeType: metadata.mimeType,
      sha256: metadata.sha256,
      overwritten: overwrite,
      resampled: false as const,
    };
  }

  async moveFile(options: { source: string; destination: string; overwrite?: boolean; createParents?: boolean }) {
    const overwrite = options.overwrite ?? false;
    const createParents = options.createParents ?? true;
    const sourceAbsolute = await resolveWorkspacePath(this.config.workspaceRoots, options.source);
    await assertRegularFile(sourceAbsolute);
    const destinationAbsolute = await resolveWorkspacePath(this.config.workspaceRoots, options.destination, { allowMissing: true });
    if (sourceAbsolute === destinationAbsolute) throw new Error("Source and destination point to the same file.");

    const destinationExists = await pathExists(destinationAbsolute);
    if (destinationExists) {
      if (!overwrite) throw new Error("The destination file already exists; use overwrite=true to replace it.");
      await assertRegularFile(destinationAbsolute);
    }
    if (createParents) await mkdir(dirname(destinationAbsolute), { recursive: true });
    await rename(sourceAbsolute, destinationAbsolute);
    return {
      source: options.source,
      destination: options.destination,
      workspaceRoot: await workspaceRootForPath(this.config.workspaceRoots, destinationAbsolute),
      overwritten: destinationExists,
    };
  }

  async deleteFile(path: string) {
    const absolute = await resolveWorkspacePath(this.config.workspaceRoots, path);
    await assertRegularFile(absolute);
    await rm(absolute);
    return { path, deleted: true as const };
  }

  async runProgram(options: { executable: string; args?: string[]; cwd?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<ProcessResult> {
    const absoluteCwd = await resolveWorkspacePath(this.config.workspaceRoots, options.cwd ?? ".");
    return runProcess({
      executable: options.executable,
      args: options.args ?? [],
      cwd: absoluteCwd,
      timeoutMs: this.clampTimeout(options.timeoutMs),
      config: this.config,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  async runCommand(options: { command: string; cwd?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<ProcessResult> {
    if (!this.config.enableUnsafeShell) throw new Error("Unsafe shell is disabled.");
    const absoluteCwd = await resolveWorkspacePath(this.config.workspaceRoots, options.cwd ?? ".");
    return runProcess({
      executable: "/bin/sh",
      args: ["-lc", options.command],
      cwd: absoluteCwd,
      timeoutMs: this.clampTimeout(options.timeoutMs),
      config: this.config,
      bypassAllowlist: true,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  async terminalStart(options: { executable: string; args?: string[]; cwd?: string; name?: string }): Promise<TerminalInfo> {
    const absoluteCwd = await resolveWorkspacePath(this.config.workspaceRoots, options.cwd ?? ".");
    return this.terminalManager.start({
      executable: options.executable,
      args: options.args ?? [],
      cwd: absoluteCwd,
      ...(options.name ? { name: options.name } : {}),
    });
  }

  terminalList(): Promise<TerminalInfo[]> {
    return this.terminalManager.list();
  }

  terminalLogs(id: string, options: { after?: number; limit?: number } = {}): TerminalLogsResult {
    return this.terminalManager.logs(id, options);
  }

  terminalStop(id: string, options: { force?: boolean } = {}): Promise<TerminalInfo> {
    return this.terminalManager.stop(id, options);
  }

  private clampTimeout(requested: number | undefined): number {
    return Math.min(requested ?? this.config.defaultTimeoutMs, this.config.maxTimeoutMs);
  }

  private assertImagePixels(width: number, height: number): void {
    const pixels = width * height;
    if (!Number.isSafeInteger(pixels) || pixels > this.config.maxImagePixels) {
      throw new Error(`Image with ${width} × ${height} pixels exceeds the limit of ${this.config.maxImagePixels} pixels.`);
    }
  }
}
