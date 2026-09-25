import { describe, expect, test } from "bun:test";
import { TerminalLogBuffer } from "../src/terminal/logs";

describe("TerminalLogBuffer", () => {
  test("keeps monotonic seq and supports incremental reads", () => {
    const buffer = new TerminalLogBuffer(1024);
    buffer.append("stdout", "one\n");
    buffer.append("stderr", "two\n");
    buffer.append("stdout", "three\n");

    const first = buffer.read({ limit: 2 });
    expect(first.entries.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(first.nextSeq).toBe(2);
    expect(first.entries.map((entry) => entry.stream)).toEqual(["stdout", "stderr"]);

    const next = buffer.read({ after: first.nextSeq });
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]?.seq).toBe(3);
    expect(next.entries[0]?.text).toBe("three\n");
  });

  test("evicts old bytes without killing the producer", () => {
    const buffer = new TerminalLogBuffer(10);
    buffer.append("stdout", "12345");
    buffer.append("stderr", "67890");
    buffer.append("stdout", "abc");

    const result = buffer.read();
    expect(result.entries.map((entry) => entry.seq)).toEqual([2, 3]);
    expect(buffer.sizeBytes).toBeLessThanOrEqual(10);
  });

  test("keeps only the tail of a chunk larger than the budget", () => {
    const buffer = new TerminalLogBuffer(4);
    buffer.append("stdout", "abcdef");

    expect(buffer.read().entries[0]?.text).toBe("cdef");
    expect(buffer.sizeBytes).toBe(4);
  });
});
