import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function importTsModule(url) {
  const source = await readFile(url, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
}

const { toSpeakableText } = await importTsModule(new URL('./speechText.ts', import.meta.url));
const { WebSpeechRecognizer, WebSpeechSynthesizer, pickVoice } = await importTsModule(new URL('./webSpeech.ts', import.meta.url));

// ---- 朗读文本清理 ----
assert.equal(toSpeakableText('**恐龙**很大！🦖'), '恐龙很大！');
assert.equal(toSpeakableText('看这里 [链接](https://a.com) https://b.com'), '看这里 链接');
assert.equal(toSpeakableText('第一行\n\n- 第二行'), '第一行。第二行');
assert.equal(toSpeakableText('```js\ncode\n```好的'), '好的');
assert.equal(toSpeakableText(''), '');

// ---- 识别：不支持时 ----
{
  const recognizer = new WebSpeechRecognizer({});
  assert.equal(recognizer.supported, false);
  const errors = [];
  recognizer.start({ onFinal: () => assert.fail('no final'), onError: (e) => errors.push(e) });
  assert.deepEqual(errors, ['unsupported']);
}

// ---- 识别：按住说话 ----
class FakeRecognition {
  static instances = [];
  constructor() {
    FakeRecognition.instances.push(this);
    this.started = false;
  }
  start() { this.started = true; }
  stop() { this.onend?.(); }
  abort() { this.onerror?.({ error: 'aborted' }); this.onend?.(); }
  emit(results) {
    this.onresult?.({ results: results.map(([text, isFinal]) => Object.assign([{ transcript: text }], { isFinal })) });
  }
}

{
  const recognizer = new WebSpeechRecognizer({ webkitSpeechRecognition: FakeRecognition });
  assert.equal(recognizer.supported, true);
  const partials = [];
  const finals = [];
  recognizer.start({ onPartial: (t) => partials.push(t), onFinal: (t) => finals.push(t) });
  const rec = FakeRecognition.instances.at(-1);
  assert.equal(rec.started, true);
  assert.equal(rec.lang, 'zh-CN');
  assert.equal(rec.interimResults, true);
  rec.emit([['我喜欢', false]]);
  rec.emit([['我喜欢恐龙', true], ['它们', false]]);
  recognizer.stop();
  assert.deepEqual(partials, ['我喜欢', '我喜欢恐龙它们']);
  assert.deepEqual(finals, ['我喜欢恐龙'], 'stop returns finalized text');

  // 没有 final 时退回到最后的临时结果
  recognizer.start({ onFinal: (t) => finals.push(t) });
  FakeRecognition.instances.at(-1).emit([[' 小猫 ', false]]);
  recognizer.stop();
  assert.equal(finals.at(-1), '小猫');

  // abort 不触发 onFinal，也不报错
  const errors = [];
  recognizer.start({ onFinal: (t) => finals.push(`aborted:${t}`), onError: (e) => errors.push(e) });
  FakeRecognition.instances.at(-1).emit([['不要', false]]);
  recognizer.abort();
  assert.equal(finals.at(-1), '小猫');
  assert.deepEqual(errors, []);

  // 权限错误映射
  recognizer.start({ onFinal: () => {}, onError: (e) => errors.push(e) });
  FakeRecognition.instances.at(-1).onerror({ error: 'service-not-allowed' });
  assert.deepEqual(errors, ['not-allowed']);
}

// ---- 声音选择 ----
{
  const voices = [
    { lang: 'en-US', localService: true, name: 'en' },
    { lang: 'zh-TW', localService: true, name: 'tw' },
    { lang: 'zh-CN', localService: false, name: 'cn-remote' },
    { lang: 'zh-CN', localService: true, name: 'cn-local' },
  ];
  assert.equal(pickVoice(voices, 'zh-CN').name, 'cn-local');
  assert.equal(pickVoice(voices.slice(0, 2), 'zh-CN').name, 'tw', 'falls back to same language');
  assert.equal(pickVoice([], 'zh-CN'), undefined);
}

// ---- 朗读 ----
{
  assert.equal(new WebSpeechSynthesizer({}).supported, false);
  await new WebSpeechSynthesizer({}).speak('你好');

  const spoken = [];
  let cancelled = 0;
  const synth = {
    getVoices: () => [{ lang: 'zh-CN', localService: true }],
    speak: (u) => {
      spoken.push(u);
    },
    cancel: () => {
      cancelled += 1;
    },
  };
  class Utterance {
    constructor(text) { this.text = text; }
  }
  const synthesizer = new WebSpeechSynthesizer({ speechSynthesis: synth, SpeechSynthesisUtterance: Utterance });
  assert.equal(synthesizer.supported, true);
  const done = synthesizer.speak('你好呀');
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, '你好呀');
  assert.equal(spoken[0].lang, 'zh-CN');
  assert.ok(spoken[0].voice);
  spoken[0].onend();
  await done;

  const interrupted = synthesizer.speak('第二句');
  synthesizer.cancel();
  await interrupted;
  assert.ok(cancelled >= 2, 'speak cancels previous speech and cancel resolves pending promise');
  await synthesizer.speak('   ');
  assert.equal(spoken.length, 2, 'blank text is not spoken');
}

console.log('speech.test.mjs: ok');
