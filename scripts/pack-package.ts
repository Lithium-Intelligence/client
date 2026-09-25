import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const outputDir = join(root, "dist", "npm");
const output = join(outputDir, "lithium-client.tgz");

await mkdir(outputDir, { recursive: true });

const child = Bun.spawn([
  process.execPath,
  "pm",
  "pack",
  "--filename",
  output,
], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});

const code = await child.exited;
if (code !== 0) throw new Error(`Package pack failed with exit code ${code}.`);

console.log(output);
