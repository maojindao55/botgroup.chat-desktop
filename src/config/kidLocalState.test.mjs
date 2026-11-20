import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function importTsModule(url) {
  const source = await readFile(url, 'utf8');
  const compiled = ts.transpileModule(`${source}\n// ${Math.random()}`, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
}

function fakeStorage() {
  const store = new Map();
  return {
    store,
    get length() { return store.size; },
    key: (i) => Array.from(store.keys())[i] ?? null,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

const local = fakeStorage();
const session = fakeStorage();
globalThis.localStorage = local;
globalThis.sessionStorage = session;

const rewards = await importTsModule(new URL('./kidRewards.ts', import.meta.url));
const prefs = await importTsModule(new URL('./kidPrefs.ts', import.meta.url));
const gate = await importTsModule(new URL('./parentGate.ts', import.meta.url));
const history = await importTsModule(new URL('./kidChatHistory.ts', import.meta.url));
const { AGE_PROFILES } = await importTsModule(new URL('./ageProfile.ts', import.meta.url));

// ---- 星星和徽章 ----
{
  let stats = rewards.emptyRewardStats();
  let res = rewards.applyMessage(stats, ['kid-curious-doctor']);
  assert.deepEqual(res.newBadges.map((b) => b.id), ['first_hello']);
  stats = res.stats;
  res = rewards.applyMessage(stats, ['kid-curious-doctor']);
  assert.equal(res.newBadges.length, 0, 'badge is only awarded once');
  stats = res.stats;
  res = rewards.applyMessage(stats, ['kid-story-fairy', 'kid-math-bear', 'kid-drawing-bunny']);
  assert.ok(res.newBadges.some((b) => b.id === 'all_friends'));
  stats = res.stats;
  assert.equal(stats.messagesSent, 3);
  assert.equal(stats.companionsMet.length, 4);

  const level = { gameId: 'guess_animal', levelId: 'guess_animal-1', levelNumber: 1 };
  let game = rewards.applyGameResult(stats, { ...level, stars: 2 });
  assert.equal(game.starsGained, 2);
  assert.equal(game.stats.stars, 2);
  assert.equal(game.stats.bestLevel.guess_animal, 1);
  assert.ok(game.newBadges.some((b) => b.id === 'first_win'));
  game = rewards.applyGameResult(game.stats, { ...level, stars: 2 });
  assert.equal(game.starsGained, 0, 'replaying a level cannot farm stars');
  game = rewards.applyGameResult(game.stats, { ...level, stars: 3 });
  assert.equal(game.starsGained, 1, 'only the improvement counts');
  assert.equal(game.stats.stars, 3);
  game = rewards.applyGameResult(game.stats, { gameId: 'guess_animal', levelId: 'guess_animal-2', levelNumber: 2, stars: 0 });
  assert.equal(game.stats.bestLevel.guess_animal, 1, 'a lost game does not unlock');
  assert.equal(game.stats.gamesPlayed, 4);
  assert.equal(game.stats.gamesWon, 3);

  assert.equal(rewards.isLevelUnlocked(game.stats, 'guess_animal', 2), true);
  assert.equal(rewards.isLevelUnlocked(game.stats, 'guess_animal', 3), false);
  assert.equal(rewards.isLevelUnlocked(game.stats, 'word_chain', 1), true);

  rewards.saveRewardStats(game.stats);
  assert.deepEqual(rewards.loadRewardStats(), game.stats);
  local.setItem('kid_rewards', JSON.stringify({ stars: -5, badges: ['x', 'x', 3], bestLevel: { word_chain: 'abc' } }));
  const normalized = rewards.loadRewardStats();
  assert.equal(normalized.stars, 0);
  assert.deepEqual(normalized.badges, ['x']);
  assert.deepEqual(normalized.bestLevel, {});
  local.setItem('kid_rewards', '{broken');
  assert.deepEqual(rewards.loadRewardStats(), rewards.emptyRewardStats());
}

// ---- 语音偏好 ----
{
  const all = { canRecognize: true, canSpeak: true };
  assert.deepEqual(prefs.resolveVoicePrefs(AGE_PROFILES.preschool, {}, all), { autoReadAloud: true, inputMode: 'voice' });
  assert.deepEqual(prefs.resolveVoicePrefs(AGE_PROFILES.school, {}, all), { autoReadAloud: false, inputMode: 'text' });
  assert.deepEqual(
    prefs.resolveVoicePrefs(AGE_PROFILES.preschool, {}, { canRecognize: false, canSpeak: false }),
    { autoReadAloud: false, inputMode: 'text' },
    'falls back to typing without speech support',
  );
  assert.deepEqual(prefs.resolveVoicePrefs(AGE_PROFILES.school, { autoReadAloud: true, inputMode: 'voice' }, all), { autoReadAloud: true, inputMode: 'voice' });

  prefs.saveVoicePrefs('school', { autoReadAloud: true });
  assert.deepEqual(prefs.loadVoicePrefs('school'), { autoReadAloud: true });
  assert.deepEqual(prefs.loadVoicePrefs('preschool'), {}, 'prefs are per age band');
  local.setItem('kid_voice_prefs:school', JSON.stringify({ autoReadAloud: 'yes', inputMode: 'telepathy' }));
  assert.deepEqual(prefs.loadVoicePrefs('school'), {});
}

// ---- 家长入口 ----
{
  const seq = [0, 0.999];
  let i = 0;
  const challenge = gate.createArithmeticChallenge(() => seq[i++ % seq.length]);
  assert.equal(challenge.question, '12 × 9 = ?');
  assert.equal(challenge.answer, 108);
  for (let n = 0; n < 50; n++) {
    const c = gate.createArithmeticChallenge();
    assert.ok(c.answer >= 36 && c.answer <= 99 * 9, 'two-digit times one-digit');
  }
  assert.equal(gate.checkChallengeAnswer(challenge, ' 108 '), true);
  assert.equal(gate.checkChallengeAnswer(challenge, '１０８'), true, 'accepts full-width digits');
  assert.equal(gate.checkChallengeAnswer(challenge, '107'), false);
  assert.equal(gate.checkChallengeAnswer(challenge, '108abc'), false);
  assert.equal(gate.checkChallengeAnswer(challenge, ''), false);

  assert.equal(gate.isParentAreaUnlocked(), false);
  gate.unlockParentArea(1000);
  assert.equal(gate.isParentAreaUnlocked(1000 + gate.PARENT_UNLOCK_MS - 1), true);
  assert.equal(gate.isParentAreaUnlocked(1000 + gate.PARENT_UNLOCK_MS), false, 'unlock expires');
  gate.unlockParentArea();
  gate.lockParentArea();
  assert.equal(gate.isParentAreaUnlocked(), false);
}

// ---- 儿童端聊天记录 ----
{
  const msgs = Array.from({ length: history.MAX_KID_CHAT_MESSAGES + 5 }, (_, n) => ({
    id: `m${n}`, speakerId: n % 2 ? 'kid' : 'kid-math-bear', speakerName: 'x', content: `第${n}句`, createdAt: n,
  }));
  msgs.push({ id: 'err', speakerId: 'kid-math-bear', speakerName: 'x', content: '出错了', createdAt: 999, isError: true });
  history.saveKidChat('kid-math-bear', msgs);
  const loaded = history.loadKidChat('kid-math-bear');
  assert.equal(loaded.length, history.MAX_KID_CHAT_MESSAGES);
  assert.equal(loaded.at(-1).id, `m${history.MAX_KID_CHAT_MESSAGES + 4}`, 'keeps the latest, drops error bubbles');
  assert.deepEqual(history.loadKidChat('playground'), []);
  local.setItem('kid_chat:playground', JSON.stringify([{ id: 1 }, { id: 'ok', speakerId: 'kid', speakerName: '我', content: '嗨', createdAt: 'x' }]));
  assert.deepEqual(history.loadKidChat('playground'), [{ id: 'ok', speakerId: 'kid', speakerName: '我', content: '嗨', createdAt: 0 }]);
  local.setItem('unrelated', '1');
  history.clearKidChats();
  assert.equal(local.getItem('kid_chat:playground'), null);
  assert.equal(local.getItem('kid_chat:kid-math-bear'), null);
  assert.equal(local.getItem('unrelated'), '1');
  assert.notEqual(history.newKidMessageId(), history.newKidMessageId());
}

console.log('kidLocalState.test.mjs: ok');
