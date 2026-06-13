import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function importTsModule(url, transform = (source) => source) {
  const source = transform(await readFile(url, 'utf8'));
  const compiled = ts.transpileModule(`${source}\n// cache-bust:${Date.now()}:${Math.random()}`, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`;
  return import(moduleUrl);
}

const mod = await importTsModule(
  new URL('./agentWorkflowOutputPolicy.ts', import.meta.url),
  source => source
    .replace(
      "import type { AgentWorkflowAgentOutput, AgentWorkflowOutputPolicy } from '@/config/agentWorkflow';",
      '',
    )
    .replace(
      "import { resolveLlmCredentials } from '@/utils/resolveLlmCredentials';",
      'const resolveLlmCredentials = async () => ({ model: "stub" });',
    )
    .replace(
      "import { llmChatComplete } from '@/utils/llmClient';",
      'const llmChatComplete = async () => "stubbed";',
    ),
);

const { extractFindings, extractDiffBlocks, applyOutputPolicy, summarizeWithLLM } = mod;

// ---------- extractFindings ----------
assert.equal(extractFindings(''), '');
{
  const text = `Some intro.

- First finding
- Second finding
* Third finding
1. Numbered one

Random paragraph.

  - Indented finding`;
  const result = extractFindings(text);
  assert.match(result, /First finding/);
  assert.match(result, /Second finding/);
  assert.match(result, /Third finding/);
  assert.match(result, /Numbered one/);
  assert.match(result, /Indented finding/);
  assert.doesNotMatch(result, /Random paragraph/);
}
{
  // dedup
  const text = `- A\n- A\n- B`;
  const result = extractFindings(text);
  const lines = result.split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
}

// ---------- extractDiffBlocks ----------
assert.equal(extractDiffBlocks(''), '');
{
  const text = `Intro.

\`\`\`diff
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
-old
+new
\`\`\`

More text.

\`\`\`patch
+ another
\`\`\`

\`\`\`
not a diff
\`\`\``;
  const result = extractDiffBlocks(text);
  assert.match(result, /old/);
  assert.match(result, /new/);
  assert.match(result, /another/);
  assert.doesNotMatch(result, /not a diff/);
}

// ---------- applyOutputPolicy: full ----------
{
  const outputs = [
    { agentId: 'a', agentName: 'A', content: 'First answer', isError: false },
  ];
  const result = await applyOutputPolicy(outputs, { policy: 'full' });
  assert.equal(result, 'First answer');
}
{
  const outputs = [
    { agentId: 'a', agentName: 'A', content: 'First', isError: false },
    { agentId: 'b', agentName: 'B', content: 'Second', isError: false },
  ];
  const result = await applyOutputPolicy(outputs, { policy: 'full' });
  assert.match(result, /### A/);
  assert.match(result, /First/);
  assert.match(result, /### B/);
  assert.match(result, /Second/);
}

// ---------- applyOutputPolicy: findings ----------
{
  const outputs = [
    { agentId: 'a', agentName: 'A', content: '- Issue 1\n- Issue 2', isError: false },
    { agentId: 'b', agentName: 'B', content: '* Issue 3', isError: false },
  ];
  const result = await applyOutputPolicy(outputs, { policy: 'findings' });
  assert.match(result, /Issue 1/);
  assert.match(result, /Issue 2/);
  assert.match(result, /Issue 3/);
}
{
  // findings fallback to full when no bullets
  const outputs = [
    { agentId: 'a', agentName: 'A', content: 'No bullets here', isError: false },
  ];
  const result = await applyOutputPolicy(outputs, { policy: 'findings' });
  assert.equal(result, 'No bullets here');
}

// ---------- applyOutputPolicy: diff ----------
{
  const outputs = [
    {
      agentId: 'a', agentName: 'A',
      content: 'Here is my patch:\n\n```diff\n-old\n+new\n```\n\nDone.',
      isError: false,
    },
  ];
  const result = await applyOutputPolicy(outputs, { policy: 'diff' });
  assert.match(result, /-old/);
  assert.match(result, /\+new/);
  assert.doesNotMatch(result, /Done\./);
}
{
  // diff fallback to full when no fenced diff
  const outputs = [
    { agentId: 'a', agentName: 'A', content: 'I made changes but no diff block', isError: false },
  ];
  const result = await applyOutputPolicy(outputs, { policy: 'diff' });
  assert.match(result, /I made changes/);
}

// ---------- applyOutputPolicy: summary, no llm credentials -> truncate ----------
{
  const long = 'word '.repeat(200);
  const outputs = [{ agentId: 'a', agentName: 'A', content: long, isError: false }];
  const result = await applyOutputPolicy(outputs, {
    policy: 'summary',
    summary: {},
    maxSummaryChars: 100,
  });
  assert.ok(result.length <= 100 + 30, `expected truncated <= ~130 got ${result.length}`);
}

// ---------- applyOutputPolicy: summary with stubbed caller ----------
{
  const outputs = [{ agentId: 'a', agentName: 'A', content: 'Long content here', isError: false }];
  const stubCaller = async (text, opts, maxChars) => {
    return `STUBBED-SUMMARY[${maxChars}]`;
  };
  const result = await applyOutputPolicy(outputs, {
    policy: 'summary',
    summary: { providerId: 'p', model: 'm' },
    maxSummaryChars: 80,
    caller: stubCaller,
  });
  assert.equal(result, 'STUBBED-SUMMARY[80]');
}

// ---------- summarizeWithLLM: caller errors fall back to truncation ----------
{
  const errorCaller = async () => { throw new Error('llm exploded'); };
  const result = await summarizeWithLLM('original text', { providerId: 'p', model: 'm' }, 50, errorCaller);
  assert.match(result, /original text/);
}

// ---------- empty outputs ----------
{
  const result = await applyOutputPolicy([], { policy: 'full' });
  assert.equal(result, '');
}

console.log('agentWorkflowOutputPolicy.test.mjs: ok');
