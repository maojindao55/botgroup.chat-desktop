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

const mod = await importTsModule(new URL('./cliTaskTitleCandidates.ts', import.meta.url));

const candidates = mod.buildTitleModelCandidates([
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    apiKeyRef: 'provider:deepseek',
    models: ['deepseek-reasoner', 'deepseek-chat'],
    source: 'builtin',
    enabled: true,
  },
  {
    id: 'user-qwen',
    name: 'Qwen Custom',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyRef: 'provider:user-qwen',
    models: ['qwen-max', 'qwen-turbo'],
    source: 'user',
    enabled: true,
  },
  {
    id: 'disabled',
    name: 'Disabled',
    baseURL: 'https://example.com',
    apiKeyRef: 'provider:disabled',
    models: ['disabled-turbo'],
    source: 'user',
    enabled: false,
  },
  {
    id: 'unmapped-x',
    name: 'Unmapped',
    baseURL: 'https://example.com',
    apiKeyRef: 'provider:unmapped-x',
    models: ['fast-chat'],
    source: 'user',
    enabled: true,
  },
]);

assert.deepEqual(
  candidates.map(item => `${item.providerId}:${item.model}`),
  ['user-qwen:qwen-turbo', 'user-qwen:qwen-max', 'deepseek:deepseek-chat', 'deepseek:deepseek-reasoner'],
);

