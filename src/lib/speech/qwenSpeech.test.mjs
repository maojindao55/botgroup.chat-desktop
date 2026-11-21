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

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const config = await importTsModule(new URL('../../config/speechConfig.ts', import.meta.url));
const { downsampleToPcm16, PcmChunker } = await importTsModule(new URL('./pcm.ts', import.meta.url));
const aiMembersSource = await readFile(new URL('../../config/aiMembers.ts', import.meta.url), 'utf8');

// ---- 设置：默认值与容错 ----
{
  const d = config.loadSpeechConfig();
  assert.equal(d.tts.engine, 'system');
  assert.equal(d.asr.engine, 'system');
  assert.equal(d.tts.model, 'cosyvoice-v3-flash');
  assert.equal(d.asr.model, 'fun-asr-realtime');
  assert.equal(d.endpoint, 'wss://maas.qianwenaiapi.com/api-ws/v1/inference');

  const n = config.normalizeSpeechConfig({ tts: { engine: 'qwen', rate: 9, model: '  ', voice: ' longling_v3 ' }, asr: { engine: 'bogus' } });
  assert.equal(n.tts.engine, 'qwen');
  assert.equal(n.tts.rate, 2);
  assert.equal(n.tts.model, 'cosyvoice-v3-flash');
  assert.equal(n.tts.voice, 'longling_v3');
  assert.equal(n.asr.engine, 'system');

  config.saveSpeechConfig({ ...d, asr: { engine: 'qwen', model: 'fun-asr-realtime' }, providerId: 'bailian' });
  const saved = config.loadSpeechConfig();
  assert.equal(saved.asr.engine, 'qwen');
  assert.equal(saved.providerId, 'bailian');
  assert.ok(!JSON.stringify(saved).toLowerCase().includes('key'), 'API Key 不进 localStorage');

  store.set('kid_speech_config', '{broken');
  assert.equal(config.loadSpeechConfig().tts.engine, 'system');
}

// ---- 音色：伙伴各有默认音色，家长可统一覆盖 ----
{
  const base = config.normalizeSpeechConfig(null);
  for (const id of Object.keys(config.COMPANION_VOICES)) {
    assert.ok(aiMembersSource.includes(`id: '${id}'`), `伙伴 ${id} 存在`);
  }
  assert.equal(config.voiceForSpeaker(base, 'kid-math-bear'), 'longniuniu_v3');
  assert.equal(config.voiceForSpeaker(base, 'unknown'), config.DEFAULT_VOICE);
  assert.equal(config.voiceForSpeaker(base), config.DEFAULT_VOICE);
  const override = { ...base, tts: { ...base.tts, voice: 'longling_v3' } };
  assert.equal(config.voiceForSpeaker(override, 'kid-math-bear'), 'longling_v3');
  const voices = new Set(config.KID_VOICE_OPTIONS.map((v) => v.value));
  for (const v of Object.values(config.COMPANION_VOICES)) assert.ok(voices.has(v));
}

// ---- 分句：短句合并，长句切开，内容不丢 ----
{
  const text = '你好！我是小熊。我们来数数吧：一、二、三，你能数到十吗？好的';
  const parts = config.splitForSynthesis(text);
  assert.deepEqual(parts, ['你好！我是小熊。', '我们来数数吧：一、二、三，你能数到十吗？好的']);
  assert.equal(parts.join(''), text);
  assert.deepEqual(config.splitForSynthesis('嗯。'), ['嗯。']);
  assert.deepEqual(config.splitForSynthesis(''), []);
  const long = '啊'.repeat(250);
  const chunks = config.splitForSynthesis(long);
  assert.deepEqual(chunks.map((c) => c.length), [120, 120, 10]);
  assert.equal(chunks.join(''), long);
}

// ---- PCM：48k float -> 16k int16 ----
{
  const input = new Float32Array(4800).fill(0.5);
  const out = downsampleToPcm16(input, 48000);
  assert.equal(out.length, 1600);
  assert.equal(out[0], Math.round(0.5 * 0x7fff));
  const clipped = downsampleToPcm16(new Float32Array([2, -2, 2, -2, 2, -2]), 16000);
  assert.deepEqual(Array.from(clipped), [32767, -32768, 32767, -32768, 32767, -32768]);
  const odd = downsampleToPcm16(new Float32Array(441).fill(-0.25), 44100);
  assert.equal(odd.length, 160);
  assert.equal(odd[159], Math.round(-0.25 * 0x8000));
  assert.equal(downsampleToPcm16(new Float32Array(0), 48000).length, 0);
  assert.throws(() => downsampleToPcm16(new Float32Array(10), 8000));
}

// ---- 分块：攒满一块再发，结束时冲掉余量 ----
{
  const chunker = new PcmChunker(4);
  assert.deepEqual(chunker.push(new Int16Array([1, 2, 3])), []);
  const ready = chunker.push(new Int16Array([4, 5, 6, 7, 8, 9]));
  assert.equal(ready.length, 2);
  assert.deepEqual(Array.from(new Int16Array(ready[0].buffer)), [1, 2, 3, 4]);
  assert.deepEqual(Array.from(new Int16Array(ready[1].buffer)), [5, 6, 7, 8]);
  assert.equal(ready[0].byteLength, 8);
  assert.deepEqual(Array.from(new Int16Array(chunker.flush().buffer)), [9]);
  assert.equal(chunker.flush(), null);
}

console.log('qwenSpeech tests passed');
