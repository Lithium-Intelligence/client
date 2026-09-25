import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const scanRoots = ["src", "scripts", "deploy", "docs", ".github", "README.md", "SECURITY.md", "CONTRIBUTING.md", "THIRD_PARTY_NOTICES.md", "SOURCE_SYNC.md", "LICENSE.md", "package.json"];

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

const files = (await Promise.all(scanRoots.map((entry) => collect(join(root, entry))))).flat();
const textFiles = files.filter((file) => /\.(?:ts|js|json|md|yml|yaml|service)$/.test(file) || /README\.md$|SECURITY\.md$/.test(file));
const forbidden = [
  { label: "server import", pattern: /(?:from|import\()\s*["'][^"']*\/?server\// },
  { label: "web import", pattern: /(?:from|import\()\s*["'][^"']*\/?web\// },
  { label: "TaskManager", pattern: /\bTaskManager\b/ },
  { label: "server database", pattern: /platform\.sqlite|lithium\.sqlite/ },
];
const secretPatterns = [
  { label: "OpenAI key", pattern: /sk-[A-Za-z0-9_-]{20,}/ },
  { label: "GitHub token", pattern: /(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/ },
  { label: "MCP token", pattern: /lmcp_[A-Za-z0-9_-]{20,}/ },
  { label: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
];

const failures: string[] = [];
for (const file of textFiles) {
  const content = await readFile(file, "utf8");
  const rel = relative(root, file).replaceAll("\\", "/");
  if (rel.startsWith("src/")) {
    for (const rule of forbidden) if (rule.pattern.test(content)) failures.push(`${rel}: ${rule.label}`);
  }
  for (const rule of secretPatterns) if (rule.pattern.test(content)) failures.push(`${rel}: ${rule.label}`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Client boundary verified: ${textFiles.length} text files scanned; no server/web imports or secret-shaped values.`);
