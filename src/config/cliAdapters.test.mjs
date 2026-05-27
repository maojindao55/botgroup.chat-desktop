import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function importTsModule(url) {
  const source = await readFile(url, 'utf8');
  const compiled = ts.transpileModule(`${source}\n// cache-bust:${Date.now()}:${Math.random()}`, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`;
  return import(moduleUrl);
}

const mod = await importTsModule(new URL('./cliAdapters.ts', import.meta.url));

assert.equal(mod.getCLIAdapterDefinition('codex').label, 'Codex');
assert.equal(mod.getCLIAdapterDefinition('codex').defaultBinary, 'codex');
assert.equal(mod.getCLIAdapterDefinition('codex').streamMode, 'codex-json');
assert.equal(mod.supportsCliToolSession('codex'), true);
assert.equal(mod.supportsCliToolSession('claude'), true);
assert.equal(mod.supportsCliToolSession('opencode'), true);
assert.equal(mod.supportsCliToolSession('cursor'), true);
assert.equal(mod.supportsCliToolSession('aider'), false);
assert.equal(mod.supportsCliToolSession('gemini'), false);
assert.equal(mod.supportsCliToolSession('generic'), false);

assert.equal(mod.adapterUsesOpenCodeSessionTitle('opencode'), true);
assert.equal(mod.adapterUsesOpenCodeSessionTitle('codex'), false);

assert.equal(mod.hasExplicitToolSessionArg('opencode', ['--pure']), false);
assert.equal(mod.hasExplicitToolSessionArg('opencode', ['--session', 'ses_old']), true);
assert.equal(mod.hasExplicitToolSessionArg('opencode', ['--session=ses_old']), true);
assert.equal(mod.hasExplicitToolSessionArg('codex', ['resume', 'manual-session']), true);
assert.equal(mod.hasExplicitToolSessionArg('claude', ['--resume', 'manual-session']), true);
assert.equal(mod.hasExplicitToolSessionArg('cursor', ['--continue']), true);

const unknown = mod.getCLIAdapterDefinition('custom-cli');
assert.equal(unknown.id, 'custom-cli');
assert.equal(unknown.label, 'custom-cli');
assert.equal(unknown.streamMode, 'raw');
assert.equal(unknown.defaultBinary, undefined);
assert.equal(mod.supportsCliToolSession('custom-cli'), false);

console.log('cliAdapters.test.mjs: ok');
