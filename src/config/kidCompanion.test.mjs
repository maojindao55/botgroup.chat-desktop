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

function installLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
  return store;
}

const store = installLocalStorage();
const mem = await importTsModule(new URL('./kidMemory.ts', import.meta.url));
const sched = await importTsModule(new URL('./companionScheduler.ts', import.meta.url));
const kidModel = await importTsModule(new URL('./kidModel.ts', import.meta.url));
const { builtinAIMembers } = await importTsModule(new URL('./aiMembers.ts', import.meta.url));

// ---- 轻量记忆 ----
{
  const empty = mem.emptyKidMemory();
  assert.deepEqual(mem.updateMemoryFromMessage(empty, '今天天气真好'), { interests: [] });
  assert.equal(mem.updateMemoryFromMessage(empty, '我叫豆豆').nickname, '豆豆');
  assert.equal(mem.updateMemoryFromMessage(empty, '你可以叫我小火箭呀').nickname, '小火箭');
  assert.deepEqual(mem.updateMemoryFromMessage(empty, '我最喜欢恐龙了').interests, ['恐龙']);
  assert.deepEqual(mem.updateMemoryFromMessage(empty, '我喜欢画画').interests, ['画画']);
  assert.deepEqual(mem.updateMemoryFromMessage(empty, '我喜欢你').interests, [], 'pronouns are not interests');
  assert.equal(empty.interests.length, 0, 'input memory is not mutated');

  let memory = empty;
  for (const text of ['我喜欢恐龙', '我喜欢小猫', '我喜欢恐龙']) memory = mem.updateMemoryFromMessage(memory, text);
  assert.deepEqual(memory.interests, ['恐龙', '小猫'], 'dedupe and move latest to front');

  for (let i = 0; i < 12; i++) memory = mem.updateMemoryFromMessage(memory, `我喜欢东西${'一二三四五六七八九十甲乙'[i]}`);
  assert.equal(memory.interests.length, mem.MAX_INTERESTS, 'interest list is capped');

  const saved = mem.rememberFromMessage('我叫乐乐，我喜欢火车');
  assert.equal(saved.nickname, '乐乐');
  assert.deepEqual(saved.interests, ['火车']);
  assert.deepEqual(mem.loadKidMemory(), saved, 'memory persists locally');
  store.set('kid_memory', '{broken');
  assert.deepEqual(mem.loadKidMemory(), { interests: [] }, 'broken storage falls back to empty');
  mem.clearKidMemory();
  assert.equal(store.has('kid_memory'), false);
}

// ---- 本地智能点名 ----
{
  const companions = builtinAIMembers;
  const ids = (list) => list.map((c) => c.id);
  assert.deepEqual(ids(sched.pickCompanions('给我讲个故事吧', companions, 2)), ['kid-story-fairy']);
  assert.deepEqual(ids(sched.pickCompanions('三加五等于多少', companions, 2)), ['kid-math-bear']);
  assert.deepEqual(ids(sched.pickCompanions('天空为什么是蓝色的', companions, 2)), ['kid-curious-doctor']);
  assert.deepEqual(ids(sched.pickCompanions('画画兔，我想画恐龙', companions, 2)), ['kid-drawing-bunny', 'kid-curious-doctor'], 'name mention ranks first');
  assert.deepEqual(ids(sched.pickCompanions('画画兔，我想画恐龙', companions, 1)), ['kid-drawing-bunny'], 'capped by age profile');

  const pickedFresh = sched.pickCompanions('嗯嗯', companions, 2, { lastSpeakerIds: ['kid-curious-doctor'], random: () => 0 });
  assert.equal(pickedFresh.length, 1, 'no keyword: exactly one companion answers');
  assert.notEqual(pickedFresh[0].id, 'kid-curious-doctor', 'prefer someone who did not just speak');
  assert.deepEqual(sched.pickCompanions('hi', [], 2), []);
  assert.equal(sched.pickCompanions('hi', [companions[0]], 0).length, 1, 'at least one responder');
}

// ---- 伙伴模型 ----
{
  const providers = [
    { id: 'off', enabled: false, models: ['m0'] },
    { id: 'empty', enabled: true, models: [] },
    { id: 'deepseek', enabled: true, models: ['deepseek-chat', 'deepseek-reasoner'] },
  ];
  assert.deepEqual(kidModel.pickCompanionModel({ providerId: 'p', model: 'm' }, null, providers), { providerId: 'p', model: 'm' });
  assert.deepEqual(
    kidModel.pickCompanionModel({ providerId: '', model: '' }, { providerId: 'qwen', model: 'qwen-plus' }, providers),
    { providerId: 'qwen', model: 'qwen-plus' },
  );
  assert.deepEqual(kidModel.pickCompanionModel({}, null, providers), { providerId: 'deepseek', model: 'deepseek-chat' });
  assert.equal(kidModel.pickCompanionModel({}, null, []), null);

  kidModel.saveKidModel({ providerId: 'qwen', model: 'qwen-plus' });
  assert.deepEqual(kidModel.loadKidModel(), { providerId: 'qwen', model: 'qwen-plus' });
  kidModel.saveKidModel(null);
  assert.equal(kidModel.loadKidModel(), null);
  store.set('kid_model', JSON.stringify({ providerId: 'x' }));
  assert.equal(kidModel.loadKidModel(), null, 'incomplete setting is ignored');
}

console.log('kidCompanion.test.mjs: ok');
