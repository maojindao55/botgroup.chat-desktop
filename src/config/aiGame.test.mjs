import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('./aiGame.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`;
const game = await import(moduleUrl);

// ---- 玩法列表：只有合作型玩法 ----
assert.deepEqual(game.kidGames.map((g) => g.id), ['guess_animal', 'word_chain', 'story_chain']);
assert.doesNotMatch(source, /谁是卧底|谁是人类|undercover|human_hunt/, 'competitive games are removed');
assert.deepEqual(game.getGamesForAge('preschool').map((g) => g.id), ['guess_animal', 'story_chain']);
assert.deepEqual(game.getGamesForAge('school').map((g) => g.id), ['guess_animal', 'word_chain', 'story_chain']);
assert.equal(game.getKidGame('story_chain').hostCompanionId, 'kid-story-fairy');

// ---- 关卡 ----
{
  const levels = game.getKidGameLevels('guess_animal', 'school');
  assert.equal(levels.length, game.MAX_KID_LEVEL);
  assert.equal(levels[0].difficulty, 1);
  assert.equal(levels.at(-1).difficulty, 5);
  assert.ok(levels.every((l, i) => i === 0 || l.targetRounds <= levels[i - 1].targetRounds), 'fewer hints as levels go up');
  assert.ok(
    game.generateKidGameLevel('guess_animal', 9, 'preschool').targetRounds >= 3,
    'preschoolers always keep at least 3 hints',
  );
  assert.equal(game.generateKidGameLevel('guess_animal', 0, 'school').levelNumber, 1, 'level clamps low');
  assert.equal(game.generateKidGameLevel('guess_animal', 99, 'school').levelNumber, 9, 'level clamps high');
  const story = game.generateKidGameLevel('story_chain', 3, 'school');
  assert.equal(story.theme, game.storyThemes[2]);
  assert.ok(
    game.generateKidGameLevel('word_chain', 1, 'preschool').targetRounds
      < game.generateKidGameLevel('word_chain', 1, 'school').targetRounds,
    'younger kids get shorter chains',
  );
}

// ---- 猜动物 ----
{
  const level1 = game.generateKidGameLevel('guess_animal', 1, 'school');
  assert.ok(game.getAnimalPool(level1).every((card) => card.tier === 1), 'level 1 only uses common animals');
  const level9 = game.generateKidGameLevel('guess_animal', 9, 'school');
  assert.ok(game.getAnimalPool(level9).some((card) => card.tier === 3));
  assert.equal(game.pickAnimal(level1, () => 0).tier, 1);
  assert.ok(game.animalCards.every((card) => card.hints.length >= 3), 'every animal has enough hints');

  const panda = game.animalCards.find((card) => card.name === '熊猫');
  assert.equal(game.isAnimalGuessCorrect('熊猫', panda), true);
  assert.equal(game.isAnimalGuessCorrect('是大熊猫吗？', panda), true);
  assert.equal(game.isAnimalGuessCorrect('我猜是熊猫吧', panda), true);
  assert.equal(game.isAnimalGuessCorrect('老虎', panda), false);
  assert.equal(game.isAnimalGuessCorrect('', panda), false);

  assert.equal(game.starsForResult(level1, { success: true, hintsUsed: 1 }), 3);
  assert.equal(game.starsForResult(level1, { success: true, hintsUsed: 2 }), 2);
  assert.equal(game.starsForResult(level1, { success: true, hintsUsed: 4 }), 1);
  assert.equal(game.starsForResult(level1, { success: false, hintsUsed: 4 }), 0);
}

// ---- 词语接龙 ----
{
  assert.equal(game.lastChar('苹果'), '果');
  assert.deepEqual(game.checkChainWord('苹果', '果汁'), { ok: true });
  assert.deepEqual(game.checkChainWord('苹果', ' 果汁！'), { ok: true }, 'punctuation and spaces are ignored');
  assert.deepEqual(game.checkChainWord('苹果', '西瓜'), { ok: false, reason: 'mismatch' });
  assert.deepEqual(game.checkChainWord('苹果', '果'), { ok: false, reason: 'length' });
  assert.deepEqual(game.checkChainWord('苹果', '果汁很好喝呀'), { ok: false, reason: 'length' });
  assert.deepEqual(game.checkChainWord('苹果', 'apple'), { ok: false, reason: 'not_chinese' });
  assert.deepEqual(game.checkChainWord('苹果', ''), { ok: false, reason: 'empty' });
  assert.deepEqual(game.checkChainWord('汁水', '水果', ['苹果', '水果']), { ok: false, reason: 'repeated' });
  assert.deepEqual(game.checkChainWord('', '月亮'), { ok: true }, 'first word only needs to be valid');
  assert.match(game.chainCheckMessage({ ok: false, reason: 'mismatch' }, '苹果'), /「果」/);

  assert.equal(game.extractChainWord('真厉害！我接「果汁」。'), '果汁');
  assert.equal(game.extractChainWord('好呀，我接 汁水'), '汁水');

  const level = game.generateKidGameLevel('word_chain', 1, 'school');
  assert.equal(game.starsForResult(level, { success: false, roundsCompleted: level.targetRounds }), 3);
  assert.equal(game.starsForResult(level, { success: false, roundsCompleted: 0 }), 0);
}

// ---- 主持 prompt ----
{
  const animalLevel = game.generateKidGameLevel('guess_animal', 1, 'preschool');
  const cat = game.animalCards[0];
  const prompt = game.buildGameHostPrompt(animalLevel, { animal: cat, hintsGiven: [cat.hints[0]] });
  assert.match(prompt, /绝对不能说出答案/);
  assert.match(prompt, new RegExp(cat.hints[0]));

  const chainPrompt = game.buildGameHostPrompt(game.generateKidGameLevel('word_chain', 2, 'school'), {
    currentWord: '月亮',
    usedWords: ['月亮'],
    round: 2,
  });
  assert.match(chainPrompt, /用「亮」字开头/);
  assert.match(chainPrompt, /「」/);

  const storyLevel = game.generateKidGameLevel('story_chain', 1, 'preschool');
  assert.match(game.buildGameHostPrompt(storyLevel, { round: 1 }), /开头/);
  assert.match(game.buildGameHostPrompt(storyLevel, { round: storyLevel.targetRounds }), /温暖的结尾/);
}

console.log('aiGame.test.mjs: ok');
