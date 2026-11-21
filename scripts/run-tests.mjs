#!/usr/bin/env node
// Runs every `*.test.mjs` under src/ and src-tauri/ (excluding build output) as an isolated node process.
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const skipDirs = new Set(['node_modules', 'target', 'dist', 'gen']);

function collect(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (entry.endsWith('.test.mjs')) out.push(full);
  }
  return out;
}

const files = [...collect(join(root, 'src'), []), ...collect(join(root, 'src-tauri'), [])].sort();
const failed = [];
for (const file of files) {
  const rel = relative(root, file);
  const result = spawnSync(process.execPath, [file], { cwd: root, encoding: 'utf8' });
  if (result.status === 0) {
    console.log(`PASS ${rel}`);
  } else {
    failed.push(rel);
    console.log(`FAIL ${rel}`);
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
  }
}

console.log(`\n${files.length - failed.length}/${files.length} test files passed`);
if (failed.length > 0) process.exit(1);
