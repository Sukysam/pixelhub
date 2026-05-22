import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, "..", "..");
const frontendOutDir = path.join(repoRoot, "frontend", "out");
const targetDir = path.join(repoRoot, "mobile", "www");

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyDir(src, dst) {
  mkdirp(dst);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

if (!fs.existsSync(frontendOutDir)) {
  process.stderr.write(
    `Missing frontend export output at ${frontendOutDir}\n` +
      `Run this first:\n` +
      `  cd frontend && npm install && npm run build:export\n`
  );
  process.exit(1);
}

rmrf(targetDir);
mkdirp(targetDir);
copyDir(frontendOutDir, targetDir);
process.stdout.write(`Synced ${frontendOutDir} -> ${targetDir}\n`);

