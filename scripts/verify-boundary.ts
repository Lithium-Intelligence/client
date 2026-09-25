import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const srcRoot = resolve(root, "src");
const scanRoots = [
  "src",
  "scripts",
  "test",
  "deploy",
  "docs",
  ".github",
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "THIRD_PARTY_NOTICES.md",
  "CHANGELOG.md",
  "LICENSE.md",
  "package.json",
];

async function collect(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) files.push(...await collect(child));
      else if (entry.isFile()) files.push(child);
    }
    return files;
  } catch {
    return [path];
  }
}

function allowedRuntimeSource(rel: string): boolean {
  if (
    rel === "src/client-entry.ts"
    || rel === "src/linux-node-entry.ts"
    || rel === "src/binary.ts"
    || rel === "src/executor.ts"
    || rel === "src/image.ts"
    || rel === "src/security.ts"
    || rel === "src/text-patch.ts"
  ) return true;

  return [
    "src/client/",
    "src/device/",
    "src/terminal/",
    "src/protocol/",
    "src/linux-node/",
  ].some((prefix) => rel.startsWith(prefix));
}

const files = (await Promise.all(scanRoots.map((entry) => collect(join(root, entry))))).flat();
const textFiles = files.filter((file) =>
  /\.(?:ts|js|json|md|yml|yaml|service)$/.test(file)
  || /README\.md$|SECURITY\.md$/.test(file)
);

const failures: string[] = [];
const sourceFiles = textFiles.filter((file) => file.endsWith(".ts") && file.startsWith(srcRoot));

for (const file of sourceFiles) {
  const rel = relative(root, file).replaceAll("\\", "/");
  if (!allowedRuntimeSource(rel)) failures.push(`${rel}: source path is outside the Client runtime boundary`);

  const content = await readFile(file, "utf8");
  const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^"'\n]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const match of content.matchAll(importPattern)) {
    const specifier = match[1]!;
    if (!specifier.startsWith(".")) continue;
    const resolved = resolve(dirname(file), specifier);
    if (!(resolved === srcRoot || resolved.startsWith(srcRoot + "\\") || resolved.startsWith(srcRoot + "/"))) {
      failures.push(`${rel}: local import escapes src boundary (${specifier})`);
    }
  }
}

const secretPatterns = [
  { label: "device credential", pattern: /ldev_[A-Za-z0-9_-]{30,}/ },
  { label: "GitHub token", pattern: /(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/ },
  { label: "OpenAI key", pattern: /sk-[A-Za-z0-9_-]{20,}/ },
  { label: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
];

for (const file of textFiles) {
  const content = await readFile(file, "utf8");
  const rel = relative(root, file).replaceAll("\\", "/");
  for (const rule of secretPatterns) {
    if (rel.startsWith("test/") && rule.label === "device credential") continue;
    if (rule.pattern.test(content)) failures.push(`${rel}: ${rule.label}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `Client boundary verified: ${sourceFiles.length} runtime source files and ${textFiles.length} text files scanned; no boundary escapes or secret-shaped values.`,
);
