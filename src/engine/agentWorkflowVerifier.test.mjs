import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function importTsModule(url) {
  const source = await readFile(url, 'utf8');
  const compiled = ts.transpileModule(`${source}\n// cache-bust:${Date.now()}`, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`;
  return import(moduleUrl);
}

const mod = await importTsModule(
  new URL('./agentWorkflowVerifier.ts', import.meta.url),
  source => source.replace(
    "import type { AgentWorkflowPhase, AgentWorkflowRun } from '@/config/agentWorkflow';",
    '',
  ),
);

const { wrapVerifierPrompt, parseVerdict } = mod;

function makeRun(phaseOverrides = {}, stateOverrides = {}) {
  return {
    plan: {
      phases: [
        {
          id: 'impl',
          label: 'Implementation',
          mode: 'write',
          schedule: 'single',
          agentSelection: { type: 'specific', agentIds: ['coder'] },
          prompt: 'Implement the feature.',
        },
        {
          id: 'verify',
          label: 'Verify',
          mode: 'verifier',
          schedule: 'single',
          agentSelection: { type: 'specific', agentIds: ['critic'] },
          prompt: 'Check that the implementation has tests.',
          dependsOn: ['impl'],
          ...phaseOverrides,
        },
      ],
    },
    phaseStates: {
      impl: {
        phaseId: 'impl',
        status: 'completed',
        selectedAgentIds: ['coder'],
        outputs: [{ agentId: 'coder', agentName: 'Coder', content: 'I added the feature.' }],
        summary: 'Feature implemented.',
        ...stateOverrides.impl,
      },
      verify: {
        phaseId: 'verify',
        status: 'pending',
        selectedAgentIds: [],
        outputs: [],
        ...stateOverrides.verify,
      },
    },
  };
}

// wrapVerifierPrompt includes criteria, user request, and upstream summaries
{
  const prompt = wrapVerifierPrompt({
    phase: makeRun().plan.phases[1],
    run: makeRun(),
    userMessage: 'Add login',
  });
  assert.match(prompt, /Check that the implementation has tests/);
  assert.match(prompt, /Add login/);
  assert.match(prompt, /Implementation/);
  assert.match(prompt, /Feature implemented/);
  assert.match(prompt, /PASS or FAIL/);
}

// wrapVerifierPrompt falls back to error when summary missing
{
  const run = makeRun({}, { impl: { summary: undefined, error: 'impl failed' } });
  const prompt = wrapVerifierPrompt({ phase: run.plan.phases[1], run, userMessage: 'x' });
  assert.match(prompt, /impl failed/);
}

// parseVerdict: explicit PASS
{
  const result = parseVerdict('PASS\nAll checks passed.');
  assert.equal(result.verdict, 'pass');
  assert.match(result.reasoning, /All checks passed/);
}

// parseVerdict: explicit FAIL
{
  const result = parseVerdict('FAIL\n- missing tests\n- missing docs');
  assert.equal(result.verdict, 'fail');
  assert.match(result.reasoning, /missing tests/);
}

// parseVerdict: case-insensitive first line
{
  assert.equal(parseVerdict('Pass\nok').verdict, 'pass');
  assert.equal(parseVerdict('fail\nno').verdict, 'fail');
}

// parseVerdict: empty output defaults to pass
{
  const result = parseVerdict('');
  assert.equal(result.verdict, 'pass');
  assert.match(result.reasoning, /empty output/);
}

// parseVerdict: fallback keywords
{
  assert.equal(parseVerdict('This looks good to me.').verdict, 'pass');
  assert.equal(parseVerdict('LGTM').verdict, 'pass');
  assert.equal(parseVerdict('Insufficient testing, missing error handling.').verdict, 'fail');
  assert.equal(parseVerdict('不通过，缺少测试').verdict, 'fail');
  assert.equal(parseVerdict('符合要求').verdict, 'pass');
}

console.log('agentWorkflowVerifier.test.mjs: ok');
