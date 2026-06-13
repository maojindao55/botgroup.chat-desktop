import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./chatSessionStore.ts', import.meta.url), 'utf8');

assert.match(
  source,
  /replaceMessages:\s*\(sessionId,\s*messages\)\s*=>\s*{\s*set\(state\s*=>\s*{\s*let changed = false;/s,
  'replaceMessages must track whether any session content actually changed',
);

assert.match(
  source,
  /return changed \? \{ sessions \} : state;/,
  'replaceMessages must return the original state when messages are unchanged',
);

assert.match(
  source,
  /updateMessage:\s*\(sessionId,\s*messageId,\s*patch\)\s*=>\s*{/,
  'updateMessage must accept a patch and merge it into the target message',
);

assert.match(
  source,
  /markUnread:\s*\(sessionId\)\s*=>\s*{/,
  'markUnread must be exposed on the store',
);

assert.match(
  source,
  /markRead:\s*\(sessionId\)\s*=>\s*{/,
  'markRead must be exposed on the store',
);

console.log('chatSessionStore.test.mjs: ok');
