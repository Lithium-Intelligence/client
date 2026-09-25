import { access, lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

async function normalizedRealpath(path: string): Promise<string> {
  const resolved = await realpath(path);
  // Bun on Windows returns drive roots as "C:", which node:path treats as
  // drive-relative instead of the absolute root "C:\\".
  return process.platform === "win32" && /^[A-Za-z]:$/.test(resolved)
    ? `${resolved}${sep}`
    : resolved;
}

async function nearestExistingParent(path: string): Promise<string> {
  let current = path;
  while (true) {
    try {
      await access(current);
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) throw new Error("Nenhum diretório pai acessível foi encontrado.");
      current = parent;
    }
  }
}

export async function resolveWorkspacePath(
  workspaceRoots: readonly string[],
  requestedPath: string,
  options: { allowMissing?: boolean } = {},
): Promise<string> {
  if (requestedPath.includes("\0")) throw new Error("Caminho inválido.");

  const roots = await Promise.all(workspaceRoots.map((root) => normalizedRealpath(root)));
  const defaultRoot = roots[0];
  if (!defaultRoot) throw new Error("No allowed workspace was configured.");
  const candidate = resolve(defaultRoot, requestedPath || ".");
  const root = roots.find((allowedRoot) => isInside(allowedRoot, candidate));
  if (!root) throw new Error("The path is outside the allowed workspaces.");

  try {
    const candidateReal = await normalizedRealpath(candidate);
    if (!isInside(root, candidateReal)) {
      throw new Error("O caminho resolve para fora do workspace permitido.");
    }
    return candidateReal;
  } catch (error) {
    if (!options.allowMissing) throw error;

    const existingParent = await nearestExistingParent(dirname(candidate));
    const existingParentReal = await normalizedRealpath(existingParent);
    if (!isInside(root, existingParentReal)) {
      throw new Error("O diretório pai resolve para fora do workspace permitido.");
    }
    return candidate;
  }
}

export async function workspaceRootForPath(workspaceRoots: readonly string[], path: string): Promise<string> {
  const candidate = await normalizedRealpath(path);
  const roots = await Promise.all(workspaceRoots.map((root) => normalizedRealpath(root)));
  const root = roots.find((allowedRoot) => isInside(allowedRoot, candidate));
  if (!root) throw new Error("The path is outside the allowed workspaces.");
  return root;
}

export async function assertRegularFile(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isFile()) throw new Error("O caminho não aponta para um arquivo regular.");
}
