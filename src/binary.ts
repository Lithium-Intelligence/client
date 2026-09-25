import { createHash } from "node:crypto";

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function decodeBase64(
  value: string,
  options: { maxBytes: number; expectedSha256?: string },
): Uint8Array {
  const base64 = value.trim();
  const maxEncodedLength = Math.ceil(options.maxBytes / 3) * 4;

  if (base64.length > maxEncodedLength) {
    throw new Error(`Base64 exceeds the decoded size limit of ${options.maxBytes} bytes.`);
  }
  if (base64.length % 4 !== 0 || !BASE64_PATTERN.test(base64)) {
    throw new Error("Invalid Base64. Use standard Base64 with padding when required.");
  }

  const bytes = Buffer.from(base64, "base64");
  if (bytes.byteLength > options.maxBytes) {
    throw new Error(`Content with ${bytes.byteLength} bytes exceeds the limit of ${options.maxBytes}.`);
  }

  if (options.expectedSha256) {
    const actualSha256 = sha256Hex(bytes);
    if (actualSha256 !== options.expectedSha256.toLowerCase()) {
      throw new Error(`SHA-256 mismatch: expected ${options.expectedSha256.toLowerCase()}, received ${actualSha256}.`);
    }
  }

  return bytes;
}
