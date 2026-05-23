import assert from 'node:assert/strict';
import { formatSseContentLine, formatSseDoneLine } from './llmClient.ts';

assert.equal(formatSseContentLine('hi'), 'data: {"content":"hi"}\n\n');
assert.equal(formatSseDoneLine(), 'data: [DONE]\n\n');
console.log('llmClient.test.mjs: ok');
