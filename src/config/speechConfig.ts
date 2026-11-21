/**
 * 语音服务设置：朗读和识别分别选引擎。API Key 不在这里，存在 Rust 保险箱。
 * - tokenplan：千问 Token Plan（sk-sp- Key），HTTP 接口，录完整段再识别
 * - qwen：百炼按量付费 Key，实时 WebSocket，边说边出字
 * 零运行时依赖，便于测试。
 */

export type SpeechEngine = 'system' | 'tokenplan' | 'qwen';
export type CloudEngine = Exclude<SpeechEngine, 'system'>;

export interface SpeechConfig {
  tts: {
    engine: SpeechEngine;
    model: string;
    /** 所有伙伴的默认音色，为空时每位伙伴用模型自带的默认音色 */
    voice: string;
    /** 按模型保存的自定义音色：伙伴 id 或 game:<游戏 id> → 音色 ID */
    voices: Record<string, Record<string, string>>;
    rate: number;
    /** 语气指令（Token Plan 用），为空则不传 */
    instruction: string;
  };
  asr: {
    engine: SpeechEngine;
    model: string;
  };
  /** 实时 WebSocket 接入地址（qwen 引擎） */
  endpoint: string;
  /** HTTP 接入地址（tokenplan 引擎） */
  httpBase: string;
  /** 为空时使用单独配置的语音 API Key，否则复用该模型服务的 Key */
  providerId: string;
}

export const SPEECH_SECRET_NAME = 'SPEECH_DASHSCOPE_API_KEY';

export const SPEECH_ENDPOINTS = [
  { value: 'wss://maas.qianwenaiapi.com/api-ws/v1/inference', label: '千问AI平台' },
  { value: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference', label: '阿里云百炼（北京）' },
  { value: 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference', label: '阿里云百炼（国际）' },
] as const;

export const TOKEN_PLAN_BASE = 'https://token-plan.maas.qianwenaiapi.com';

/** Token Plan 的合成模型没有童声，用语气指令让成年音色更像在和小朋友说话 */
export const KID_TTS_INSTRUCTION = '用活泼亲切、温柔有耐心的语气，像给小朋友讲故事一样说';

export const SPEECH_MODELS: Record<CloudEngine, { tts: { value: string; label: string }[]; asr: { value: string; label: string }[] }> = {
  tokenplan: {
    tts: [{ value: 'qwen-audio-3.0-tts-plus', label: 'Qwen-Audio 3.0 TTS Plus' }],
    asr: [{ value: 'qwen-audio-3.0-asr-flash', label: 'Qwen-Audio 3.0 ASR Flash' }],
  },
  qwen: {
    tts: [
      { value: 'qwen-audio-3.1-tts-flash', label: 'Qwen-Audio 3.1 TTS Flash' },
      { value: 'cosyvoice-v3-flash', label: 'CosyVoice v3 Flash' },
    ],
    asr: [
      { value: 'qwen-audio-3.1-asr-flash-message', label: 'Qwen-Audio 3.1 ASR Flash（语音消息）' },
      { value: 'fun-asr-realtime', label: 'Fun-ASR Realtime' },
    ],
  },
};

export function defaultModel(kind: 'tts' | 'asr', engine: SpeechEngine): string {
  return SPEECH_MODELS[engine === 'qwen' ? 'qwen' : 'tokenplan'][kind][0].value;
}

/** 模型是另一个云端引擎的预设时换成当前引擎的默认模型，自定义模型名原样保留 */
function modelForEngine(kind: 'tts' | 'asr', engine: SpeechEngine, model: string): string {
  if (!model) return defaultModel(kind, engine);
  if (engine === 'system') return model;
  const otherEngine: CloudEngine = engine === 'qwen' ? 'tokenplan' : 'qwen';
  const own = SPEECH_MODELS[engine][kind].some((m) => m.value === model);
  const other = SPEECH_MODELS[otherEngine][kind].some((m) => m.value === model);
  return other && !own ? defaultModel(kind, engine) : model;
}

interface VoiceCatalog {
  /** 每位伙伴一个音色 */
  companions: Record<string, string>;
  fallback: string;
  options: { value: string; label: string }[];
}

/** 音色只能和所属模型搭配使用，换模型时音色表跟着换 */
const VOICE_CATALOGS: Record<'tokenplan' | 'qwen-audio-3.1' | 'cosyvoice', VoiceCatalog> = {
  // qwen-audio-3.0-tts-plus 只有两个系统音色，没有童声
  tokenplan: {
    companions: {
      'kid-curious-doctor': 'longanlufeng',
      'kid-story-fairy': 'longanlingxin',
      'kid-math-bear': 'longanlufeng',
      'kid-drawing-bunny': 'longanlingxin',
    },
    fallback: 'longanlingxin',
    options: [
      { value: 'longanlingxin', label: '龙安灵心 · 知心温暖女声' },
      { value: 'longanlufeng', label: '龙安鲁风 · 明亮开朗男声' },
    ],
  },
  'qwen-audio-3.1': {
    companions: {
      'kid-curious-doctor': 'longjielidou_v3.1',
      'kid-story-fairy': 'longshanshan_v3.1',
      'kid-math-bear': 'longniuniu_v3.1',
      'kid-drawing-bunny': 'longpaopao_v3.1',
    },
    fallback: 'longke_v3.1',
    options: [
      { value: 'longke_v3.1', label: '龙可 · 懵懂童声' },
      { value: 'longjielidou_v3.1', label: '龙杰力豆 · 天真男童' },
      { value: 'longniuniu_v3.1', label: '龙牛牛 · 阳光男童' },
      { value: 'longshanshan_v3.1', label: '龙闪闪 · 戏剧化童声' },
      { value: 'longpaopao_v3.1', label: '龙泡泡 · 泡泡音女童' },
      { value: 'longling_v3.1', label: '龙铃 · 稚气女孩' },
    ],
  },
  cosyvoice: {
    companions: {
      'kid-curious-doctor': 'longjielidou_v3',
      'kid-story-fairy': 'longshanshan_v3',
      'kid-math-bear': 'longniuniu_v3',
      'kid-drawing-bunny': 'longhuhu_v3',
    },
    fallback: 'longhuhu_v3',
    options: [
      { value: 'longhuhu_v3', label: '龙呼呼 · 天真女童' },
      { value: 'longniuniu_v3', label: '龙牛牛 · 阳光男童' },
      { value: 'longshanshan_v3', label: '龙闪闪 · 戏剧化童声' },
      { value: 'longjielidou_v3', label: '龙杰力豆 · 顽皮男孩' },
      { value: 'longpaopao_v3', label: '龙泡泡 · 泡泡音' },
      { value: 'longling_v3', label: '龙铃 · 稚气女孩' },
    ],
  },
};

export function voiceCatalog(model: string): VoiceCatalog {
  if (model.startsWith('cosyvoice')) return VOICE_CATALOGS.cosyvoice;
  if (model.startsWith('qwen-audio-3.0')) return VOICE_CATALOGS.tokenplan;
  return VOICE_CATALOGS['qwen-audio-3.1'];
}

function belongsToOtherModel(voice: string, model: string): boolean {
  if (!voice) return false;
  const own = voiceCatalog(model);
  return Object.values(VOICE_CATALOGS).some(
    (catalog) => catalog !== own && catalog.options.some((option) => option.value === voice),
  );
}

export const DEFAULT_SPEECH_CONFIG: SpeechConfig = {
  tts: { engine: 'system', model: defaultModel('tts', 'tokenplan'), voice: '', voices: {}, rate: 1, instruction: KID_TTS_INSTRUCTION },
  asr: { engine: 'system', model: defaultModel('asr', 'tokenplan') },
  endpoint: SPEECH_ENDPOINTS[0].value,
  httpBase: TOKEN_PLAN_BASE,
  providerId: '',
};

const CONFIG_KEY = 'kid_speech_config';

const isEngine = (v: unknown): v is SpeechEngine => v === 'system' || v === 'tokenplan' || v === 'qwen';
const str = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim() : fallback);

const MAX_VOICE_ID = 120;

function normalizeVoiceMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, 64)) {
    const voice = typeof value === 'string' ? value.trim() : '';
    if (key && key.length <= 64 && voice && voice.length <= MAX_VOICE_ID) out[key] = voice;
  }
  return out;
}

function normalizeVoices(raw: unknown): Record<string, Record<string, string>> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, Record<string, string>> = {};
  for (const [model, map] of Object.entries(raw as Record<string, unknown>).slice(0, 16)) {
    const voices = normalizeVoiceMap(map);
    if (model.trim() && Object.keys(voices).length) out[model.trim()] = voices;
  }
  return out;
}

export function normalizeSpeechConfig(raw: unknown): SpeechConfig {
  const d = DEFAULT_SPEECH_CONFIG;
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const tts = value.tts && typeof value.tts === 'object' ? value.tts : {};
  const asr = value.asr && typeof value.asr === 'object' ? value.asr : {};
  const rate = Number(tts.rate);
  const ttsEngine = isEngine(tts.engine) ? tts.engine : d.tts.engine;
  const asrEngine = isEngine(asr.engine) ? asr.engine : d.asr.engine;
  const ttsModel = modelForEngine('tts', ttsEngine, str(tts.model, ''));
  const voice = typeof tts.voice === 'string' ? tts.voice.trim() : '';
  return {
    tts: {
      engine: ttsEngine,
      model: ttsModel,
      voice: belongsToOtherModel(voice, ttsModel) ? '' : voice,
      voices: normalizeVoices(tts.voices),
      rate: Number.isFinite(rate) ? Math.min(2, Math.max(0.5, rate)) : d.tts.rate,
      instruction: typeof tts.instruction === 'string' ? tts.instruction.trim().slice(0, 200) : d.tts.instruction,
    },
    asr: {
      engine: asrEngine,
      model: modelForEngine('asr', asrEngine, str(asr.model, '')),
    },
    endpoint: str(value.endpoint, d.endpoint),
    httpBase: str(value.httpBase, d.httpBase),
    providerId: typeof value.providerId === 'string' ? value.providerId.trim() : '',
  };
}

export function loadSpeechConfig(): SpeechConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return normalizeSpeechConfig(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeSpeechConfig(null);
  }
}

export function saveSpeechConfig(config: SpeechConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(normalizeSpeechConfig(config)));
  } catch {
    // ignore
  }
}

export const gameVoiceKey = (gameId: string) => `game:${gameId}`;

/** 当前模型下某位伙伴（或 game:<id>）的自定义音色，没有则为空 */
export function customVoice(config: SpeechConfig, key: string): string {
  return config.tts.voices[config.tts.model]?.[key] || '';
}

export function withCustomVoice(config: SpeechConfig, key: string, voice: string): SpeechConfig {
  const { [key]: _old, ...rest } = config.tts.voices[config.tts.model] || {};
  const map = voice.trim() ? { ...rest, [key]: voice.trim() } : rest;
  return { ...config, tts: { ...config.tts, voices: { ...config.tts.voices, [config.tts.model]: map } } };
}

/** 不看伙伴自己的设置时用的音色：家长的统一音色，否则模型给这位伙伴的默认音色 */
export function inheritedVoice(config: SpeechConfig, speakerId?: string): string {
  if (config.tts.voice) return config.tts.voice;
  const catalog = voiceCatalog(config.tts.model);
  return (speakerId && catalog.companions[speakerId]) || catalog.fallback;
}

/** 优先级：游戏音色 > 伙伴音色 > 统一音色 > 模型默认 */
export function voiceForSpeaker(config: SpeechConfig, speakerId?: string, gameId?: string): string {
  return (
    (gameId && customVoice(config, gameVoiceKey(gameId))) ||
    (speakerId && customVoice(config, speakerId)) ||
    inheritedVoice(config, speakerId)
  );
}

const SENTENCE_END = /[。！？!?；;…\n]+[”"’'」』）)]*/g;
const SOFT_BREAK = /[，,、：:]+/g;

/**
 * 边生成边朗读：每次传入目前为止的完整回复，返回新凑齐的句子。
 * 第一段允许在逗号处断开，让孩子尽早听到声音；没有标点的长段落按 maxChars 硬切。
 */
export function createSentenceStream(options: { minChars?: number; firstMinChars?: number; firstSoftBreak?: number; maxChars?: number } = {}) {
  const { minChars = 8, firstMinChars = 4, firstSoftBreak = 10, maxChars = 60 } = options;
  const count = (s: string) => Array.from(s.trim()).length;
  let consumed = 0;
  let emitted = false;

  // 生成中时标点落在末尾先不切，后面可能还有引号或连续的标点
  const firstCut = (rest: string, pattern: RegExp, min: number, final: boolean) => {
    pattern.lastIndex = 0;
    for (let m = pattern.exec(rest); m; m = pattern.exec(rest)) {
      const end = m.index + m[0].length;
      if (!final && end >= rest.length) return -1;
      if (count(rest.slice(0, end)) >= min) return end;
    }
    return -1;
  };

  const take = (text: string, final: boolean): string[] => {
    const out: string[] = [];
    if (text.length < consumed) consumed = text.length;
    let rest = text.slice(consumed);
    while (rest) {
      let cut = firstCut(rest, SENTENCE_END, emitted ? minChars : firstMinChars, final);
      if (cut < 0 && !emitted) cut = firstCut(rest, SOFT_BREAK, firstSoftBreak, final);
      if (cut < 0 && count(rest) > maxChars) {
        const head = Array.from(rest).slice(0, maxChars).join('');
        SOFT_BREAK.lastIndex = 0;
        let soft = -1;
        for (let m = SOFT_BREAK.exec(head); m; m = SOFT_BREAK.exec(head)) soft = m.index + m[0].length;
        cut = soft > 0 ? soft : head.length;
      }
      if (cut < 0) break;
      const piece = rest.slice(0, cut).trim();
      if (piece) {
        out.push(piece);
        emitted = true;
      }
      consumed += cut;
      rest = rest.slice(cut);
    }
    if (final) {
      if (rest.trim()) out.push(rest.trim());
      consumed = text.length;
    }
    return out;
  };

  return { push: (text: string) => take(text, false), finish: (text: string) => take(text, true) };
}

/** 按句切分，先合成第一句就能先播放；太短的句子并到下一句，减少请求次数 */
export function splitForSynthesis(text: string, minChars = 8, maxChars = 120): string[] {
  const parts = (text || '').match(/[^。！？!?；;\n]+[。！？!?；;]*|\n+/g) || [];
  const out: string[] = [];
  let buffer = '';
  for (const part of parts) {
    const piece = part.trim();
    if (!piece) continue;
    buffer += piece;
    if (Array.from(buffer).length >= minChars) {
      out.push(buffer);
      buffer = '';
    }
  }
  if (buffer) {
    if (out.length && Array.from(buffer).length < minChars) out[out.length - 1] += buffer;
    else out.push(buffer);
  }
  return out.flatMap((s) => {
    const chars = Array.from(s);
    if (chars.length <= maxChars) return [s];
    const chunks: string[] = [];
    for (let i = 0; i < chars.length; i += maxChars) chunks.push(chars.slice(i, i + maxChars).join(''));
    return chunks;
  });
}
