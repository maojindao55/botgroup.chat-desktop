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
const age = await importTsModule(new URL('./ageProfile.ts', import.meta.url));

const preschool = age.getAgeProfile('preschool');
const school = age.getAgeProfile('school');
assert.deepEqual(preschool.ageRange, [3, 6]);
assert.deepEqual(school.ageRange, [7, 12]);
assert.ok(preschool.maxReplyChars < school.maxReplyChars, 'younger kids get shorter replies');
assert.equal(preschool.maxRespondersPerTurn, 1);
assert.equal(school.maxRespondersPerTurn, 2);
assert.equal(preschool.autoReadAloud, true, '3-6 reads replies aloud by default');
assert.equal(school.autoReadAloud, false);
assert.equal(preschool.defaultInputMode, 'voice', '3-6 defaults to push-to-talk');
assert.equal(school.defaultInputMode, 'text');
assert.ok(!preschool.games.includes('word_chain'), 'word chain needs reading skills');
assert.ok(school.games.includes('word_chain'));

assert.equal(age.getAgeProfile('adult').band, age.DEFAULT_AGE_BAND, 'unknown band falls back');
assert.equal(age.isAgeBand('preschool'), true);
assert.equal(age.isAgeBand('teen'), false);

assert.equal(age.loadAgeBand(), age.DEFAULT_AGE_BAND, 'default when nothing stored');
age.saveAgeBand('preschool');
assert.equal(store.get('kid_age_band'), 'preschool');
assert.equal(age.loadAgeProfile().band, 'preschool');
store.set('kid_age_band', 'garbage');
assert.equal(age.loadAgeBand(), age.DEFAULT_AGE_BAND, 'invalid stored value falls back');

assert.deepEqual(age.capResponders(['a', 'b', 'c'], school), ['a', 'b']);
assert.deepEqual(age.capResponders(['a', 'b', 'c'], preschool), ['a']);
assert.deepEqual(age.capResponders([], school), []);

console.log('ageProfile.test.mjs: ok');
