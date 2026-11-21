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
const { downsampleToPcm16, encodeWav, PcmChunker } = await importTsModule(new URL('./pcm.ts', import.meta.url));
const gameSource = await readFile(new URL('../../config/aiGame.ts', import.meta.url), 'utf8');
const aiMembersSource = await readFile(new URL('../../config/aiMembers.ts', import.meta.url), 'utf8');

// ---- 设置：默认值与容错 ----
{
  const d = config.loadSpeechConfig();
  assert.equal(d.tts.engine, 'system');
  assert.equal(d.asr.engine, 'system');
  assert.equal(d.tts.model, 'qwen-audio-3.0-tts-plus');
  assert.equal(d.asr.model, 'qwen-audio-3.0-asr-flash');
  assert.equal(d.httpBase, 'https://token-plan.maas.qianwenaiapi.com');
  assert.equal(d.endpoint, 'wss://maas.qianwenaiapi.com/api-ws/v1/inference');
  assert.equal(d.tts.instruction, config.KID_TTS_INSTRUCTION);

  const n = config.normalizeSpeechConfig({ tts: { engine: 'tokenplan', rate: 9, model: '  ', voice: ' longanlufeng ', instruction: '' }, asr: { engine: 'bogus' } });
  assert.equal(n.tts.engine, 'tokenplan');
  assert.equal(n.tts.rate, 2);
  assert.equal(n.tts.model, 'qwen-audio-3.0-tts-plus');
  assert.equal(n.tts.voice, 'longanlufeng');
  assert.equal(n.tts.instruction, '', '家长清空语气指令后不再补默认值');
  assert.equal(n.asr.engine, 'system');

  // 引擎和模型不配套时换成该引擎的默认模型，自定义模型名保留
  const realtime = config.normalizeSpeechConfig({ tts: { engine: 'qwen', model: 'qwen-audio-3.0-tts-plus' }, asr: { engine: 'qwen', model: 'qwen-audio-3.0-asr-flash' } });
  assert.equal(realtime.tts.model, 'qwen-audio-3.1-tts-flash');
  assert.equal(realtime.asr.model, 'qwen-audio-3.1-asr-flash-message');
  const tokenPlan = config.normalizeSpeechConfig({ tts: { engine: 'tokenplan', model: 'cosyvoice-v3-flash' } });
  assert.equal(tokenPlan.tts.model, 'qwen-audio-3.0-tts-plus');
  assert.equal(config.normalizeSpeechConfig({ tts: { engine: 'qwen', model: 'cosyvoice-v3-plus' } }).tts.model, 'cosyvoice-v3-plus');

  // 音色属于别的模型时丢掉，避免服务端 InvalidParameter
  assert.equal(config.normalizeSpeechConfig({ tts: { engine: 'tokenplan', voice: 'longhuhu_v3' } }).tts.voice, '');
  assert.equal(config.normalizeSpeechConfig({ tts: { engine: 'tokenplan', voice: 'qwen-audio-3.0-tts-plus-abc' } }).tts.voice, 'qwen-audio-3.0-tts-plus-abc');

  config.saveSpeechConfig({ ...d, asr: { engine: 'tokenplan', model: 'qwen-audio-3.0-asr-flash' }, providerId: 'tokenplan' });
  const saved = config.loadSpeechConfig();
  assert.equal(saved.asr.engine, 'tokenplan');
  assert.equal(saved.providerId, 'tokenplan');
  assert.ok(!JSON.stringify(saved).includes('sk-'), 'API Key 不进 localStorage');

  store.set('kid_speech_config', '{broken');
  assert.equal(config.loadSpeechConfig().tts.engine, 'system');
}

// ---- 音色：按模型取伙伴的默认音色，家长可统一覆盖 ----
{
  const ids = ['kid-curious-doctor', 'kid-story-fairy', 'kid-math-bear', 'kid-drawing-bunny'];
  for (const id of ids) assert.ok(aiMembersSource.includes(`id: '${id}'`), `伙伴 ${id} 存在`);
  const withModel = (model) => config.normalizeSpeechConfig({ tts: { engine: model.startsWith('qwen-audio-3.0') ? 'tokenplan' : 'qwen', model } });
  const cases = {
    'qwen-audio-3.0-tts-plus': { bear: 'longanlufeng', fairy: 'longanlingxin', fallback: 'longanlingxin' },
    'qwen-audio-3.1-tts-flash': { bear: 'longniuniu_v3.1', fairy: 'longshanshan_v3.1', fallback: 'longke_v3.1' },
    'cosyvoice-v3-flash': { bear: 'longniuniu_v3', fairy: 'longshanshan_v3', fallback: 'longhuhu_v3' },
  };
  for (const [model, expected] of Object.entries(cases)) {
    const c = withModel(model);
    assert.equal(config.voiceForSpeaker(c, 'kid-math-bear'), expected.bear, model);
    assert.equal(config.voiceForSpeaker(c, 'kid-story-fairy'), expected.fairy, model);
    assert.equal(config.voiceForSpeaker(c, 'unknown'), expected.fallback, model);
    const catalog = config.voiceCatalog(model);
    const options = new Set(catalog.options.map((v) => v.value));
    for (const id of ids) assert.ok(options.has(catalog.companions[id]), `${model} ${id}`);
  }
  const override = withModel('qwen-audio-3.0-tts-plus');
  override.tts.voice = 'longanlufeng';
  assert.equal(config.voiceForSpeaker(override, 'kid-story-fairy'), 'longanlufeng');
}

// ---- 自定义音色：游戏 > 伙伴 > 统一音色 > 模型默认，按模型分开保存 ----
{
  let c = config.normalizeSpeechConfig({ tts: { engine: 'tokenplan' } });
  assert.deepEqual(c.tts.voices, {});
  c = config.withCustomVoice(c, 'kid-math-bear', '  my-cloned-voice-001 ');
  c = config.withCustomVoice(c, config.gameVoiceKey('word_chain'), 'qwen-audio-3.0-tts-plus-design-abc');
  assert.equal(config.customVoice(c, 'kid-math-bear'), 'my-cloned-voice-001');
  assert.equal(config.voiceForSpeaker(c, 'kid-math-bear'), 'my-cloned-voice-001', '伙伴音色可填任意 ID');
  assert.equal(config.voiceForSpeaker(c, 'kid-math-bear', 'word_chain'), 'qwen-audio-3.0-tts-plus-design-abc', '游戏音色优先');
  assert.equal(config.voiceForSpeaker(c, 'kid-math-bear', 'story_chain'), 'my-cloned-voice-001', '没设游戏音色时跟随主持伙伴');
  assert.equal(config.voiceForSpeaker(c, 'kid-story-fairy'), 'longanlingxin');

  c.tts.voice = 'longanlufeng';
  assert.equal(config.voiceForSpeaker(c, 'kid-story-fairy'), 'longanlufeng', '统一音色覆盖模型默认');
  assert.equal(config.voiceForSpeaker(c, 'kid-math-bear'), 'my-cloned-voice-001', '伙伴音色比统一音色优先');
  assert.equal(config.inheritedVoice(c, 'kid-math-bear'), 'longanlufeng');

  // 存取一遍不丢，换模型后不会把别的模型的音色发出去
  c = config.normalizeSpeechConfig(JSON.parse(JSON.stringify(c)));
  assert.equal(config.voiceForSpeaker(c, 'kid-math-bear', 'word_chain'), 'qwen-audio-3.0-tts-plus-design-abc');
  const realtime = config.normalizeSpeechConfig({ ...c, tts: { ...c.tts, engine: 'qwen', model: 'qwen-audio-3.1-tts-flash', voice: '' } });
  assert.equal(config.voiceForSpeaker(realtime, 'kid-math-bear', 'word_chain'), 'longniuniu_v3.1');
  assert.equal(realtime.tts.voices['qwen-audio-3.0-tts-plus']['kid-math-bear'], 'my-cloned-voice-001', '其他模型的设置保留');

  // 清空即恢复默认
  c = config.withCustomVoice(c, config.gameVoiceKey('word_chain'), '   ');
  assert.equal(config.customVoice(c, 'game:word_chain'), '');
  assert.equal(config.voiceForSpeaker(c, 'kid-math-bear', 'word_chain'), 'my-cloned-voice-001');

  // 脏数据容错
  const dirty = config.normalizeSpeechConfig({ tts: { voices: { 'qwen-audio-3.0-tts-plus': { a: 1, b: '  ', c: 'x'.repeat(200), d: ' ok ' }, '': { a: 'b' }, m: 'str' } } });
  assert.deepEqual(dirty.tts.voices, { 'qwen-audio-3.0-tts-plus': { d: 'ok' } });
  assert.ok(gameSource.includes("hostCompanionId: 'kid-math-bear'"), '词语接龙由数学小熊主持');
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

// ---- WAV：44 字节头 + 小端 PCM ----
{
  const wav = encodeWav(new Int16Array([1, -2, 32767]), 16000);
  const view = new DataView(wav.buffer);
  const ascii = (o, n) => String.fromCharCode(...wav.slice(o, o + n));
  assert.equal(wav.byteLength, 44 + 6);
  assert.equal(ascii(0, 4), 'RIFF');
  assert.equal(view.getUint32(4, true), 36 + 6);
  assert.equal(ascii(8, 8), 'WAVEfmt ');
  assert.equal(view.getUint16(20, true), 1, 'PCM');
  assert.equal(view.getUint16(22, true), 1, 'mono');
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(28, true), 32000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(ascii(36, 4), 'data');
  assert.equal(view.getUint32(40, true), 6);
  assert.deepEqual([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)], [1, -2, 32767]);
}

console.log('qwenSpeech tests passed');
