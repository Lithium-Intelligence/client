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
    throw new Error(`Base64 excede o limite de ${options.maxBytes} bytes decodificados.`);
  }
  if (base64.length % 4 !== 0 || !BASE64_PATTERN.test(base64)) {
    throw new Error("Base64 inválido. Use Base64 padrão com padding quando necessário.");
  }

  const bytes = Buffer.from(base64, "base64");
  if (bytes.byteLength > options.maxBytes) {
    throw new Error(`Conteúdo com ${bytes.byteLength} bytes excede o limite de ${options.maxBytes}.`);
  }

  if (options.expectedSha256) {
    const actualSha256 = sha256Hex(bytes);
    if (actualSha256 !== options.expectedSha256.toLowerCase()) {
      throw new Error(`SHA-256 divergente: esperado ${options.expectedSha256.toLowerCase()}, recebido ${actualSha256}.`);
    }
  }

  return bytes;
}
