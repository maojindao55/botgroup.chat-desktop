import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

function toDataUrl(source) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  return `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`;
}

const aiGameUrl = toDataUrl(await readFile(new URL('./aiGame.ts', import.meta.url), 'utf8'));
const flowSource = (await readFile(new URL('./kidGameFlow.ts', import.meta.url), 'utf8')).replace("from './aiGame'", `from '${aiGameUrl}'`);
const flow = await import(toDataUrl(flowSource));
const game = await import(aiGameUrl);

const first = () => 0;

// ---- 猜动物 ----
{
  const level = game.generateKidGameLevel('guess_animal', 1, 'school');
  let state = flow.startGuessGame(level, first);
  assert.equal(state.animal.name, '小猫');
  assert.deepEqual(state.hintsGiven, [state.animal.hints[0]], 'first hint is given immediately');

  let res = flow.submitGuess(state, '小狗');
  assert.equal(res.correct, false);
  state = res.state;
  assert.deepEqual(state.wrongGuesses, ['小狗']);

  const hinted = flow.requestHint(level, state);
  assert.equal(hinted.hintsGiven.length, 2);
  state = hinted;
  while (flow.canRequestHint(level, state)) state = flow.requestHint(level, state);
  assert.equal(state.hintsGiven.length, flow.maxHints(level, state));
  assert.equal(flow.requestHint(level, state), state, 'no hint beyond the limit');

  res = flow.submitGuess(state, '我猜是猫咪吧');
  assert.equal(res.correct, true);
  assert.equal(res.state.status, 'won');
  assert.equal(flow.guessGameStars(level, res.state), 1, 'many hints → 1 star');
  assert.equal(flow.submitGuess(res.state, '小猫').correct, false, 'finished game ignores guesses');

  const quick = flow.submitGuess(flow.startGuessGame(level, first), '小猫').state;
  assert.equal(flow.guessGameStars(level, quick), 3, 'first-hint guess → 3 stars');

  const revealed = flow.revealAnimal(flow.startGuessGame(level, first));
  assert.equal(revealed.status, 'revealed');
  assert.equal(flow.guessGameStars(level, revealed), 0);
}

// ---- 词语接龙 ----
{
  const level = game.generateKidGameLevel('word_chain', 1, 'school');
  assert.equal(level.targetRounds, 3);
  let state = flow.startChainGame(first);
  assert.equal(state.currentWord, '苹果');

  let res = flow.submitChainWord(level, state, '西瓜');
  assert.deepEqual(res.check, { ok: false, reason: 'mismatch' });
  assert.equal(res.state, state, 'invalid word does not advance');
  res = flow.submitChainWord(level, state, '苹果');
  assert.equal(res.check.ok, false);

  res = flow.submitChainWord(level, state, '果汁');
  assert.equal(res.check.ok, true);
  state = res.state;
  assert.equal(state.rounds, 1);
  assert.equal(state.currentWord, '果汁');

  let companion = flow.acceptCompanionWord(state, '真厉害！我接「汁液」。', first);
  assert.equal(companion.fallback, false);
  assert.equal(companion.state.currentWord, '汁液');
  state = companion.state;

  companion = flow.acceptCompanionWord(state, '我想不出来啦', first);
  assert.equal(companion.fallback, true, 'invalid companion word falls back to a fresh starter');
  assert.ok(!['苹果'].includes(companion.word));
  assert.equal(companion.state.currentWord, companion.word);
  assert.equal(flow.acceptCompanionWord(state, '', first).fallback, true, 'model error still continues');
  state = companion.state;

  const next = (w) => `${game.lastChar(state.currentWord)}${w}`;
  res = flow.submitChainWord(level, state, next('子'));
  assert.equal(res.check.ok, true);
  state = flow.acceptCompanionWord(res.state, '', first).state;
  res = flow.submitChainWord(level, state, next('光'));
  assert.equal(res.check.ok, true);
  assert.equal(res.state.rounds, 3);
  assert.equal(res.state.status, 'won');
  assert.equal(flow.chainGameStars(level, res.state), 3);
}

// ---- 故事接龙 ----
{
  const level = game.generateKidGameLevel('story_chain', 1, 'preschool');
  assert.equal(level.targetRounds, 2);
  let state = flow.startStoryGame();
  let res = flow.submitStoryLine(level, state, '嗯');
  assert.equal(res.accepted, false, 'too short');
  res = flow.submitStoryLine(level, state, '小兔子去找小熊');
  assert.equal(res.accepted, true);
  state = res.state;
  assert.equal(state.status, 'playing');
  assert.equal(flow.storyGameStars(level, state), 2);
  state = flow.submitStoryLine(level, state, '它们一起吃蜂蜜').state;
  assert.equal(state.status, 'won');
  assert.equal(flow.storyGameStars(level, state), 3);
  assert.equal(flow.submitStoryLine(level, state, '还有一段').accepted, false);
  assert.match(flow.storyOpening(level), /小兔找朋友/);
}

console.log('kidGameFlow.test.mjs: ok');
