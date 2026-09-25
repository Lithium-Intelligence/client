import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string };
const expected = `v${pkg.version}`;
const actual = (Bun.env.GITHUB_REF_NAME ?? Bun.argv[2] ?? "").trim();

if (!actual) {
  console.log(`Expected release tag: ${expected}`);
  process.exit(0);
}
if (actual !== expected) {
  throw new Error(`Release tag ${actual} does not match package version ${pkg.version}. Expected ${expected}.`);
}
console.log(`Release tag verified: ${actual}`);
