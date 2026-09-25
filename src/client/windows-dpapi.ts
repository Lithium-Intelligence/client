import { dlopen, FFIType, ptr, toBuffer } from "bun:ffi";

const DATA_BLOB_SIZE_64 = 16;
const DATA_BLOB_POINTER_OFFSET_64 = 8;
const CRYPTPROTECT_UI_FORBIDDEN = 0x00000001;

let libraries: any = null;

function pointerNumber(value: unknown): number {
  return typeof value === "bigint" ? Number(value) : Number(value || 0);
}

function writePointer(buffer: Buffer, offset: number, value: unknown): void {
  buffer.writeBigUInt64LE(BigInt(Math.trunc(pointerNumber(value))), offset);
}

function createLibraries(): any {
  if (libraries) return libraries;
  const crypt32 = dlopen("crypt32.dll", {
    CryptProtectData: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr],
      returns: FFIType.i32,
    },
    CryptUnprotectData: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr],
      returns: FFIType.i32,
    },
  });
  const kernel32 = dlopen("kernel32.dll", {
    LocalFree: {
      args: [FFIType.ptr],
      returns: FFIType.ptr,
    },
  });
  libraries = { crypt32, kernel32 };
  return libraries;
}

function createDataBlob(value: Uint8Array) {
  const input = Buffer.from(value);
  const storage = input.length ? input : Buffer.alloc(1);
  const blob = Buffer.alloc(DATA_BLOB_SIZE_64);
  blob.writeUInt32LE(input.length, 0);
  writePointer(blob, DATA_BLOB_POINTER_OFFSET_64, ptr(storage));
  return { blob, storage };
}

function readAndFreeDataBlob(blob: Buffer, kernel32: ReturnType<typeof createLibraries>["kernel32"]): Buffer {
  const byteLength = blob.readUInt32LE(0);
  const dataPointer = pointerNumber(blob.readBigUInt64LE(DATA_BLOB_POINTER_OFFSET_64));
  if (!dataPointer && byteLength) throw new Error("DPAPI returned an invalid data pointer.");
  try {
    if (!byteLength) return Buffer.alloc(0);
    return Buffer.from(toBuffer(dataPointer as any, 0, byteLength));
  } finally {
    if (dataPointer) kernel32.symbols.LocalFree(dataPointer);
  }
}

function transform(value: Uint8Array, operation: "protect" | "unprotect"): Buffer {
  if (process.platform !== "win32") throw new Error("Windows DPAPI is only available on Windows.");
  if (process.arch !== "x64" && process.arch !== "arm64") throw new Error(`Unsupported Windows architecture for DPAPI: ${process.arch}.`);

  const { crypt32, kernel32 } = createLibraries();
  const { blob: inputBlob, storage } = createDataBlob(value);
  const outputBlob = Buffer.alloc(DATA_BLOB_SIZE_64);
  const fn = operation === "protect" ? crypt32.symbols.CryptProtectData : crypt32.symbols.CryptUnprotectData;

  void storage;
  const ok = fn(
    ptr(inputBlob),
    null,
    null,
    null,
    null,
    CRYPTPROTECT_UI_FORBIDDEN,
    ptr(outputBlob),
  );
  if (!ok) throw new Error(`Windows DPAPI ${operation} failed.`);
  return readAndFreeDataBlob(outputBlob, kernel32);
}

export interface WindowsDpapiCodec {
  readonly name: "windows-dpapi-current-user";
  protect(buffer: Uint8Array): Buffer;
  unprotect(buffer: Uint8Array): Buffer;
}

export function createWindowsDpapiCodec(): WindowsDpapiCodec {
  if (process.platform !== "win32") throw new Error("Windows DPAPI is only available on Windows.");
  return Object.freeze({
    name: "windows-dpapi-current-user" as const,
    protect(buffer: Uint8Array) {
      return transform(buffer, "protect");
    },
    unprotect(buffer: Uint8Array) {
      return transform(buffer, "unprotect");
    },
  });
}
