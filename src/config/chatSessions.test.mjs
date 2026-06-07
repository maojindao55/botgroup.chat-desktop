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

const mod = await importTsModule(new URL('./chatSessions.ts', import.meta.url));

const {
  MAX_MESSAGES_PER_SESSION,
  MAX_SESSIONS_PER_GROUP,
  truncateSessionTitle,
  cleanGeneratedTitle,
  clampSessionMessages,
  sanitizeMessageForStorage,
  sanitizeMessagesForStorage,
  createChatSession,
  sortChatSessions,
  filterChatSessions,
  getGroupSessions,
  getSessionsToEvict,
  isUntitledSession,
  shouldGenerateTitle,
} = mod;

// ---- sanitizeMessageForStorage: must drop bulky fields (e.g. base64 avatar) ----
{
  const bigAvatar = `data:image/png;base64,${'A'.repeat(5000)}`;
  const input = {
    id: 'm1',
    sender: { id: 'u', name: 'Me', avatar: bigAvatar },
    content: 'hello',
    isAI: false,
    isError: false,
    createdAt: '2026-05-30T00:00:00.000Z',
    extra: 'should be dropped',
  };
  const out = sanitizeMessageForStorage(input);
  assert.equal(out.sender.avatar, undefined, 'avatar must be stripped from stored messages');
  assert.equal('extra' in out, false, 'unknown fields dropped');
  assert.equal(out.id, 'm1');
  assert.equal(out.sender.id, 'u');
  assert.equal(out.sender.name, 'Me');
  assert.equal(out.content, 'hello');
  assert.equal(out.createdAt, '2026-05-30T00:00:00.000Z');
  // isError omitted when false
  assert.equal('isError' in out, false, 'falsy isError omitted');
  const errOut = sanitizeMessageForStorage({ ...input, isError: true });
  assert.equal(errOut.isError, true);
  const serialized = JSON.stringify(sanitizeMessagesForStorage([input]));
  assert.ok(!serialized.includes('base64'), 'serialized stored messages contain no base64 avatar');
}

// ---- sanitizeMessageForStorage: preserves agentTaskId + adapter round-trip ----
{
  const msg = {
    id: 'm2',
    sender: { id: 'cli-agent', name: 'Codex' },
    content: 'done',
    isAI: true,
    agentTaskId: 'task_abc123',
    adapter: 'codex',
  };
  const sanitized = sanitizeMessageForStorage(msg);
  assert.equal(sanitized.agentTaskId, 'task_abc123', 'agentTaskId preserved');
  assert.equal(sanitized.adapter, 'codex', 'adapter preserved');

  // round-trip: serialize → parse → sanitize again
  const json = JSON.stringify(sanitized);
  const parsed = JSON.parse(json);
  const resanitized = sanitizeMessageForStorage(parsed);
  assert.equal(resanitized.agentTaskId, 'task_abc123', 'agentTaskId survives JSON round-trip');
  assert.equal(resanitized.adapter, 'codex', 'adapter survives JSON round-trip');

  // omit when not present
  const plain = { id: 'm3', sender: { id: 'u', name: 'Me' }, content: 'hi', isAI: false };
  const plainSanitized = sanitizeMessageForStorage(plain);
  assert.equal('agentTaskId' in plainSanitized, false, 'agentTaskId omitted when absent');
  assert.equal('adapter' in plainSanitized, false, 'adapter omitted when absent');
}

// ---- sanitizeMessageForStorage: preserves safe attachment metadata ----
{
  const msg = {
    id: 'm-att',
    sender: { id: 'u', name: 'Me' },
    content: 'see files',
    isAI: false,
    attachments: [
      {
        id: 'att-1',
        kind: 'image',
        name: 'screen.png',
        path: '/Users/me/Desktop/screen.png',
        mimeType: 'image/png',
        size: 1200,
        extension: 'png',
        dataUrl: `data:image/png;base64,${'A'.repeat(5000)}`,
      },
      {
        id: 'att-2',
        kind: 'code',
        name: 'main.ts',
        path: '/Users/me/project/main.ts',
        extension: 'ts',
        unknown: 'drop me',
      },
      {
        id: '',
        kind: 'image',
        name: 'bad.png',
        path: '/tmp/bad.png',
      },
    ],
  };

  const sanitized = sanitizeMessageForStorage(msg);
  assert.deepEqual(sanitized.attachments, [
    {
      id: 'att-1',
      kind: 'image',
      name: 'screen.png',
      path: '/Users/me/Desktop/screen.png',
      mimeType: 'image/png',
      size: 1200,
      extension: 'png',
    },
    {
      id: 'att-2',
      kind: 'code',
      name: 'main.ts',
      path: '/Users/me/project/main.ts',
      extension: 'ts',
    },
  ]);
  assert.ok(!JSON.stringify(sanitized).includes('base64'), 'attachment payload bytes must not be stored');
}

// ---- sanitizeMessageForStorage: omits attachments when absent or empty ----
{
  const legacy = {
    id: 'legacy',
    sender: { id: 'u', name: 'Me' },
    content: 'plain text',
    isAI: false,
  };
  const sanitizedLegacy = sanitizeMessageForStorage(legacy);
  assert.equal('attachments' in sanitizedLegacy, false, 'legacy messages stay compact');

  const emptyAttachments = sanitizeMessageForStorage({ ...legacy, attachments: [] });
  assert.equal('attachments' in emptyAttachments, false, 'empty attachment arrays are omitted');
}

// ---- truncateSessionTitle ----
assert.equal(truncateSessionTitle('hello world'), 'hello world');
assert.equal(truncateSessionTitle('  line1\nline2  '), 'line1', 'takes first non-empty line, trimmed');
assert.equal(truncateSessionTitle('', 48, 'FALLBACK'), 'FALLBACK', 'empty falls back');
assert.equal(truncateSessionTitle('   \n  ', 48, 'FB'), 'FB', 'whitespace-only falls back');
{
  const long = 'a'.repeat(60);
  const out = truncateSessionTitle(long, 10);
  assert.equal(out.length, 10, 'truncates to maxLen including ellipsis');
  assert.ok(out.endsWith('…'), 'adds ellipsis');
}

// ---- cleanGeneratedTitle ----
assert.equal(cleanGeneratedTitle('“关于 React 的讨论”'), '关于 React 的讨论', 'strips wrapping quotes');
assert.equal(cleanGeneratedTitle('标题：部署方案'), '部署方案', 'strips label prefix');
assert.equal(cleanGeneratedTitle('Deploy plan.'), 'Deploy plan', 'strips trailing punctuation');
assert.equal(cleanGeneratedTitle('  first line\nsecond line  '), 'first line', 'first line only');
assert.equal(cleanGeneratedTitle(''), '', 'empty stays empty');
assert.equal(cleanGeneratedTitle('   '), '', 'whitespace -> empty');
{
  const out = cleanGeneratedTitle('x'.repeat(40), 12);
  assert.ok(out.length <= 12, 'respects maxLen');
}

// ---- clampSessionMessages ----
{
  const msgs = Array.from({ length: MAX_MESSAGES_PER_SESSION + 25 }, (_, i) => ({
    id: i,
    sender: { id: 'u', name: 'u' },
    content: String(i),
    isAI: false,
  }));
  const clamped = clampSessionMessages(msgs);
  assert.equal(clamped.length, MAX_MESSAGES_PER_SESSION, 'clamps to max');
  assert.equal(clamped[0].content, '25', 'keeps the most recent N');
  assert.equal(clamped[clamped.length - 1].content, String(MAX_MESSAGES_PER_SESSION + 24));
  const small = [{ id: 1, sender: { id: 'u', name: 'u' }, content: 'x', isAI: false }];
  assert.equal(clampSessionMessages(small).length, 1, 'no-op below limit');
}

// ---- createChatSession ----
{
  const s = createChatSession({ groupId: 'g1', fallbackTitle: 'New' });
  assert.equal(s.groupId, 'g1');
  assert.equal(s.title, 'New');
  assert.equal(s.titleSource, 'auto');
  assert.equal(s.titleGenerated, false);
  assert.equal(s.pinned, false);
  assert.equal(s.archived, false);
  assert.ok(typeof s.id === 'string' && s.id.length > 0, 'has id');
  assert.ok(s.createdAt && s.updatedAt, 'has timestamps');
  assert.deepEqual(s.messages, []);
}

// ---- sortChatSessions: pinned first, then updatedAt desc ----
{
  const base = (id, updatedAt, pinned = false) => ({
    id, groupId: 'g', title: id, titleSource: 'auto', pinned,
    createdAt: updatedAt, updatedAt, messages: [],
  });
  const sessions = [
    base('a', '2026-05-01T00:00:00.000Z'),
    base('b', '2026-05-03T00:00:00.000Z'),
    base('c', '2026-05-02T00:00:00.000Z', true),
    base('d', '2026-05-04T00:00:00.000Z'),
  ];
  const sorted = sortChatSessions(sessions).map(s => s.id);
  assert.deepEqual(sorted, ['c', 'd', 'b', 'a'], 'pinned first then newest');
}

// ---- filterChatSessions ----
{
  const sessions = [
    { id: '1', groupId: 'g', title: 'Deploy', titleSource: 'auto', updatedAt: '1', messages: [{ id: 1, sender: { id: 'u', name: 'u' }, content: 'kubernetes', isAI: false }] },
    { id: '2', groupId: 'g', title: 'Recipes', titleSource: 'auto', updatedAt: '2', archived: true, messages: [] },
    { id: '3', groupId: 'g', title: 'Travel', titleSource: 'auto', updatedAt: '3', messages: [] },
  ];
  assert.deepEqual(filterChatSessions(sessions).map(s => s.id), ['1', '3'], 'hides archived by default');
  assert.deepEqual(filterChatSessions(sessions, { showArchived: true }).map(s => s.id), ['1', '2', '3']);
  assert.deepEqual(filterChatSessions(sessions, { search: 'kuber' }).map(s => s.id), ['1'], 'searches message content');
  assert.deepEqual(filterChatSessions(sessions, { search: 'travel' }).map(s => s.id), ['3'], 'searches title (case-insensitive)');
}

// ---- getGroupSessions ----
{
  const sessions = [
    { id: 'a', groupId: 'g1', title: 'a', titleSource: 'auto', updatedAt: '2', messages: [] },
    { id: 'b', groupId: 'g2', title: 'b', titleSource: 'auto', updatedAt: '3', messages: [] },
    { id: 'c', groupId: 'g1', title: 'c', titleSource: 'auto', updatedAt: '5', messages: [] },
  ];
  assert.deepEqual(getGroupSessions(sessions, 'g1').map(s => s.id), ['c', 'a'], 'filters by group + sorted');
}

// ---- getSessionsToEvict ----
{
  const mk = (id, updatedAt, pinned = false) => ({
    id, groupId: 'g', title: id, titleSource: 'auto', pinned, updatedAt, messages: [],
  });
  const many = Array.from({ length: MAX_SESSIONS_PER_GROUP + 3 }, (_, i) =>
    mk(`s${i}`, new Date(2026, 0, 1, 0, i).toISOString()),
  );
  const evict = getSessionsToEvict(many, 'g');
  assert.equal(evict.length, 3, 'evicts overflow count');
  assert.deepEqual(evict, ['s0', 's1', 's2'], 'evicts oldest first');

  // pinned ones are protected
  const withPins = [mk('p0', '2020-01-01T00:00:00.000Z', true), ...many];
  const evict2 = getSessionsToEvict(withPins, 'g');
  assert.ok(!evict2.includes('p0'), 'never evicts pinned');

  // below limit -> no eviction
  assert.deepEqual(getSessionsToEvict([mk('x', '1')], 'g'), []);
}

// ---- isUntitledSession / shouldGenerateTitle ----
{
  const userMsg = { id: 1, sender: { id: 'u', name: 'u' }, content: 'hi there', isAI: false };
  const aiMsg = { id: 2, sender: { id: 'a', name: 'a' }, content: 'hello!', isAI: true };

  const untitled = { id: 's', groupId: 'g', title: 'New chat', titleSource: 'auto', updatedAt: '1', messages: [] };
  assert.equal(isUntitledSession(untitled, ['New chat']), true);

  const manual = { ...untitled, titleSource: 'manual' };
  assert.equal(isUntitledSession(manual, ['New chat']), false, 'manual never untitled');

  const generated = { ...untitled, titleGenerated: true };
  assert.equal(isUntitledSession(generated, ['New chat']), false, 'already generated');

  // shouldGenerateTitle: needs both a user + ai message, not manual, not generated
  assert.equal(shouldGenerateTitle({ ...untitled, messages: [userMsg] }), false, 'no ai reply yet');
  assert.equal(shouldGenerateTitle({ ...untitled, messages: [userMsg, aiMsg] }), true, 'ready to generate');
  assert.equal(shouldGenerateTitle({ ...untitled, titleSource: 'manual', messages: [userMsg, aiMsg] }), false);
  assert.equal(shouldGenerateTitle({ ...untitled, titleGenerated: true, messages: [userMsg, aiMsg] }), false);
  // errored AI replies don't count
  const errAi = { ...aiMsg, isError: true };
  assert.equal(shouldGenerateTitle({ ...untitled, messages: [userMsg, errAi] }), false, 'error reply ignored');
}

console.log('chatSessions tests OK');
