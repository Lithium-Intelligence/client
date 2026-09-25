import { copyFile, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const dist = join(root, "dist");
const stage = join(dist, "linux-x64");
const archive = join(dist, "lithium-client-linux-x64.tar.gz");

await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

const output = join(stage, "lithium-node");
const child = Bun.spawn([
  process.execPath,
  "build",
  "--compile",
  "--target=bun-linux-x64",
  "--no-compile-autoload-dotenv",
  "--no-compile-autoload-bunfig",
  "--no-compile-autoload-package-json",
  "src/linux-node-entry.ts",
  "--outfile",
  output,
], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});
const code = await child.exited;
if (code !== 0) throw new Error(`Linux build failed with exit code ${code}.`);

await copyFile(join(root, "deploy", "linux-node", "lithium-node.example.json"), join(stage, "lithium-node.example.json"));
await copyFile(join(root, "deploy", "linux-node", "lithium-client.service"), join(stage, "lithium-client.service"));
await copyFile(join(root, "docs", "LINUX_NODE.md"), join(stage, "README-LINUX.md"));

const tar = Bun.spawn([
  "tar", "-czf", archive,
  "-C", stage,
  "lithium-node",
  "lithium-node.example.json",
  "lithium-client.service",
  "README-LINUX.md",
], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});
const tarCode = await tar.exited;
if (tarCode !== 0) throw new Error(`Linux archive failed with exit code ${tarCode}.`);

console.log(archive);
