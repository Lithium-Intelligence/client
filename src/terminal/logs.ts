import type { TerminalLogEntry, TerminalLogStream } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface TerminalLogReadOptions {
  after?: number;
  limit?: number;
}

export interface TerminalLogReadResult {
  entries: TerminalLogEntry[];
  nextSeq: number;
}

interface BufferedLogEntry {
  entry: TerminalLogEntry;
  bytes: number;
}

function clampTextToByteLimit(text: string, maxBytes: number): { text: string; bytes: number } {
  const encoded = encoder.encode(text);
  if (encoded.byteLength <= maxBytes) return { text, bytes: encoded.byteLength };

  let tail = decoder.decode(encoded.subarray(encoded.byteLength - maxBytes));
  let tailBytes = encoder.encode(tail).byteLength;

  // If the byte slice started in the middle of a UTF-8 sequence, TextDecoder may
  // insert U+FFFD. Trim from the beginning until the retained text fits exactly.
  while (tailBytes > maxBytes && tail.length > 0) {
    tail = tail.slice(1);
    tailBytes = encoder.encode(tail).byteLength;
  }

  return { text: tail, bytes: tailBytes };
}

export class TerminalLogBuffer {
  private readonly entries: BufferedLogEntry[] = [];
  private totalBytes = 0;
  private lastSeq = 0;

  constructor(readonly maxBytes: number) {
    if (!Number.isInteger(maxBytes) || maxBytes < 1) {
      throw new Error("TerminalLogBuffer maxBytes deve ser um inteiro positivo.");
    }
  }

  get sizeBytes(): number {
    return this.totalBytes;
  }

  get sizeEntries(): number {
    return this.entries.length;
  }

  append(stream: TerminalLogStream, text: string): TerminalLogEntry | undefined {
    if (text.length === 0) return undefined;

    const retained = clampTextToByteLimit(text, this.maxBytes);
    const seq = ++this.lastSeq;

    // A very small byte budget may be unable to hold even one UTF-8 code point.
    // The sequence still advances so cursors remain monotonic even when content
    // has to be dropped entirely.
    if (retained.bytes === 0) {
      return undefined;
    }

    const entry: TerminalLogEntry = {
      seq,
      at: new Date().toISOString(),
      stream,
      text: retained.text,
    };

    this.entries.push({ entry, bytes: retained.bytes });
    this.totalBytes += retained.bytes;
    this.evictOldEntries();
    return entry;
  }

  read(options: TerminalLogReadOptions = {}): TerminalLogReadResult {
    const after = options.after ?? 0;
    const limit = options.limit ?? 200;

    if (!Number.isInteger(after) || after < 0) {
      throw new Error("after deve ser um inteiro não negativo.");
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("limit deve ser um inteiro positivo.");
    }

    const entries: TerminalLogEntry[] = [];
    for (const buffered of this.entries) {
      if (buffered.entry.seq <= after) continue;
      entries.push(buffered.entry);
      if (entries.length >= limit) break;
    }

    return {
      entries,
      nextSeq: entries.at(-1)?.seq ?? Math.max(after, this.lastSeq),
    };
  }

  private evictOldEntries(): void {
    while (this.totalBytes > this.maxBytes && this.entries.length > 0) {
      const removed = this.entries.shift();
      if (!removed) break;
      this.totalBytes -= removed.bytes;
    }
  }
}
