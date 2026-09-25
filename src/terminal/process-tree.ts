import { resolve } from "node:path";

export async function terminateProcessTree(rootPid: number, force: boolean): Promise<boolean> {
  if (!Number.isInteger(rootPid) || rootPid <= 0) {
    throw new Error(`PID inválido para encerramento de árvore: ${rootPid}.`);
  }

  if (process.platform !== "win32") return false;

  const systemRoot = Bun.env.SystemRoot || Bun.env.SYSTEMROOT || "C:\\Windows";
  const taskkill = resolve(systemRoot, "System32", "taskkill.exe");
  const args = ["/PID", String(rootPid), "/T", ...(force ? ["/F"] : [])];

  try {
    const process = Bun.spawn({
      cmd: [taskkill, ...args],
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    return (await process.exited) === 0;
  } catch {
    return false;
  }
}
