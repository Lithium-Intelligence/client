import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const dist = join(root, "dist");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string };
const versionParts = pkg.version.split(".").map((value) => Number.parseInt(value, 10) || 0);
const windowsVersion = [...versionParts.slice(0, 3), 0].join(".");
const output = join(dist, "lithium-client-windows-x64.exe");

await mkdir(dist, { recursive: true });

const child = Bun.spawn([
  process.execPath,
  "build",
  "--compile",
  "--target=bun-windows-x64",
  "--no-compile-autoload-dotenv",
  "--no-compile-autoload-bunfig",
  "--no-compile-autoload-package-json",
  "--windows-title=Lithium Client",
  "--windows-description=Lithium Intelligence Client",
  `--windows-version=${windowsVersion}`,
  "src/client-entry.ts",
  "--outfile",
  output,
], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});

const code = await child.exited;
if (code !== 0) throw new Error(`Windows build failed with exit code ${code}.`);
console.log(output);
