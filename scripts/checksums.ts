import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const dir = resolve(Bun.argv[2] ?? join(import.meta.dir, "..", "dist"));
const expected = new Set([
  "lithium-client-windows-x64.exe",
  "lithium-client-linux-x64.tar.gz",
]);

const entries = await readdir(dir).catch(() => []);
const files: string[] = [];
for (const name of entries) {
  if (!expected.has(name)) continue;
  const path = join(dir, name);
  if ((await stat(path)).isFile()) files.push(name);
}
files.sort();
if (!files.length) throw new Error(`No release assets found in ${dir}.`);

const lines: string[] = [];
for (const name of files) {
  const bytes = await readFile(join(dir, name));
  lines.push(`${createHash("sha256").update(bytes).digest("hex")}  ${name}`);
}
const output = join(dir, "SHA256SUMS");
await writeFile(output, lines.join("\n") + "\n", "utf8");
console.log(lines.join("\n"));
