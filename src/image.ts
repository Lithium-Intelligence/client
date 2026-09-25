import { createHash } from "node:crypto";

export type SupportedImageMimeType = "image/png" | "image/jpeg" | "image/webp";

export interface ImageMetadata {
  mimeType: SupportedImageMimeType;
  width: number;
  height: number;
  sha256: string;
}

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

function assertRange(bytes: Uint8Array, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw new Error(`Imagem truncada ao ler ${label}.`);
  }
}

function matches(bytes: Uint8Array, offset: number, expected: Uint8Array): boolean {
  if (offset < 0 || offset + expected.byteLength > bytes.byteLength) return false;
  for (let index = 0; index < expected.byteLength; index += 1) {
    if (bytes[offset + index] !== expected[index]) return false;
  }
  return true;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  assertRange(bytes, offset, length, "identificador ASCII");
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  assertRange(bytes, offset, 2, "inteiro de 16 bits");
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  assertRange(bytes, offset, 4, "inteiro de 32 bits");
  return (
    ((bytes[offset] ?? 0) * 0x1000000)
    + ((bytes[offset + 1] ?? 0) << 16)
    + ((bytes[offset + 2] ?? 0) << 8)
    + (bytes[offset + 3] ?? 0)
  );
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  assertRange(bytes, offset, 4, "inteiro little-endian de 32 bits");
  return (
    (bytes[offset] ?? 0)
    + ((bytes[offset + 1] ?? 0) << 8)
    + ((bytes[offset + 2] ?? 0) << 16)
    + ((bytes[offset + 3] ?? 0) * 0x1000000)
  );
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  assertRange(bytes, offset, 3, "inteiro little-endian de 24 bits");
  return (
    (bytes[offset] ?? 0)
    + ((bytes[offset + 1] ?? 0) << 8)
    + ((bytes[offset + 2] ?? 0) << 16)
  );
}

function validateDimensions(width: number, height: number): { width: number; height: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Dimensões de imagem inválidas: ${width} × ${height}.`);
  }
  return { width, height };
}

function parsePng(bytes: Uint8Array): { mimeType: "image/png"; width: number; height: number } | undefined {
  if (!matches(bytes, 0, PNG_SIGNATURE)) return undefined;
  assertRange(bytes, 8, 16, "cabeçalho IHDR do PNG");
  const ihdrLength = readUint32BE(bytes, 8);
  const chunkType = ascii(bytes, 12, 4);
  if (ihdrLength !== 13 || chunkType !== "IHDR") {
    throw new Error("PNG inválido: o primeiro chunk não é um IHDR de 13 bytes.");
  }
  const { width, height } = validateDimensions(readUint32BE(bytes, 16), readUint32BE(bytes, 20));
  return { mimeType: "image/png", width, height };
}

function parseJpeg(bytes: Uint8Array): { mimeType: "image/jpeg"; width: number; height: number } | undefined {
  if (bytes.byteLength < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;

  let offset = 2;
  while (offset < bytes.byteLength) {
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) break;

    const marker = bytes[offset] ?? 0;
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;

    const segmentLength = readUint16BE(bytes, offset);
    if (segmentLength < 2) throw new Error("JPEG inválido: segmento com comprimento menor que 2.");
    assertRange(bytes, offset, segmentLength, "segmento JPEG");

    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 7) throw new Error("JPEG inválido: segmento SOF truncado.");
      const height = readUint16BE(bytes, offset + 3);
      const width = readUint16BE(bytes, offset + 5);
      validateDimensions(width, height);
      return { mimeType: "image/jpeg", width, height };
    }

    offset += segmentLength;
  }

  throw new Error("JPEG inválido: nenhum marcador SOF com dimensões foi encontrado.");
}

function parseWebpChunk(
  bytes: Uint8Array,
  chunkOffset: number,
  chunkType: string,
  chunkSize: number,
): { width: number; height: number } | undefined {
  const dataOffset = chunkOffset + 8;
  assertRange(bytes, dataOffset, chunkSize, `chunk ${chunkType} do WebP`);

  if (chunkType === "VP8X") {
    if (chunkSize < 10) throw new Error("WebP inválido: chunk VP8X truncado.");
    return validateDimensions(
      readUint24LE(bytes, dataOffset + 4) + 1,
      readUint24LE(bytes, dataOffset + 7) + 1,
    );
  }

  if (chunkType === "VP8 ") {
    if (chunkSize < 10) throw new Error("WebP inválido: chunk VP8 truncado.");
    if (!matches(bytes, dataOffset + 3, Uint8Array.from([0x9d, 0x01, 0x2a]))) {
      throw new Error("WebP inválido: assinatura do frame VP8 não encontrada.");
    }
    const width = readUint16BE(Uint8Array.from([
      bytes[dataOffset + 7] ?? 0,
      bytes[dataOffset + 6] ?? 0,
    ]), 0) & 0x3fff;
    const height = readUint16BE(Uint8Array.from([
      bytes[dataOffset + 9] ?? 0,
      bytes[dataOffset + 8] ?? 0,
    ]), 0) & 0x3fff;
    return validateDimensions(width, height);
  }

  if (chunkType === "VP8L") {
    if (chunkSize < 5 || bytes[dataOffset] !== 0x2f) {
      throw new Error("WebP inválido: cabeçalho VP8L truncado ou incorreto.");
    }
    const b1 = bytes[dataOffset + 1] ?? 0;
    const b2 = bytes[dataOffset + 2] ?? 0;
    const b3 = bytes[dataOffset + 3] ?? 0;
    const b4 = bytes[dataOffset + 4] ?? 0;
    const width = 1 + b1 + ((b2 & 0x3f) << 8);
    const height = 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10);
    return validateDimensions(width, height);
  }

  return undefined;
}

function parseWebp(bytes: Uint8Array): { mimeType: "image/webp"; width: number; height: number } | undefined {
  if (bytes.byteLength < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") {
    return undefined;
  }

  const riffSize = readUint32LE(bytes, 4);
  if (riffSize + 8 > bytes.byteLength) throw new Error("WebP inválido: RIFF declara mais bytes do que o arquivo contém.");

  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkType = ascii(bytes, offset, 4);
    const chunkSize = readUint32LE(bytes, offset + 4);
    const dimensions = parseWebpChunk(bytes, offset, chunkType, chunkSize);
    if (dimensions) return { mimeType: "image/webp", ...dimensions };
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  throw new Error("WebP inválido: nenhum chunk VP8X, VP8 ou VP8L foi encontrado.");
}

export function inspectImage(bytes: Uint8Array): Omit<ImageMetadata, "sha256"> {
  const parsed = parsePng(bytes) ?? parseJpeg(bytes) ?? parseWebp(bytes);
  if (!parsed) throw new Error("Formato não suportado. Use PNG, JPEG ou WebP válido.");
  return parsed;
}

export function imageMetadata(bytes: Uint8Array): ImageMetadata {
  const inspected = inspectImage(bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { ...inspected, sha256 };
}
