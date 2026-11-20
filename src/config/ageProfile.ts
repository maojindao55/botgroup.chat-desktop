/**
 * 儿童年龄分层参数。
 *
 * 本模块保持零依赖（只用 localStorage），方便 node 测试直接 transpile 导入。
 */

export type AgeBand = 'preschool' | 'school';
export type KidGameId = 'guess_animal' | 'word_chain' | 'story_chain';
export type KidInputMode = 'voice' | 'text';

export interface AgeProfile {
  band: AgeBand;
  label: string;
  ageRange: [number, number];
  /** 单条回复的字数上限，写进系统 prompt */
  maxReplyChars: number;
  /** 每轮最多几个伙伴回复 */
  maxRespondersPerTurn: number;
  /** 伙伴回复后是否默认朗读 */
  autoReadAloud: boolean;
  defaultInputMode: KidInputMode;
  /** 可用的合作小游戏 */
  games: KidGameId[];
  /** 写进系统 prompt 的用词要求 */
  languageGuide: string;
}

export const AGE_PROFILES: Record<AgeBand, AgeProfile> = {
  preschool: {
    band: 'preschool',
    label: '3-6 岁',
    ageRange: [3, 6],
    maxReplyChars: 40,
    maxRespondersPerTurn: 1,
    autoReadAloud: true,
    defaultInputMode: 'voice',
    games: ['guess_animal', 'story_chain'],
    languageGuide: '用幼儿园小朋友能听懂的短句和常见字词，一次只讲一件事，多用拟声词和简单比喻，少用数字和抽象概念。',
  },
  school: {
    band: 'school',
    label: '7-12 岁',
    ageRange: [7, 12],
    maxReplyChars: 90,
    maxRespondersPerTurn: 2,
    autoReadAloud: false,
    defaultInputMode: 'text',
    games: ['guess_animal', 'word_chain', 'story_chain'],
    languageGuide: '用小学生熟悉的词语，可以解释简单的原因和步骤，遇到生词顺便用一句话解释。',
  },
};

export const DEFAULT_AGE_BAND: AgeBand = 'school';
const AGE_BAND_KEY = 'kid_age_band';

export function isAgeBand(value: unknown): value is AgeBand {
  return value === 'preschool' || value === 'school';
}

export function getAgeProfile(band: unknown): AgeProfile {
  return AGE_PROFILES[isAgeBand(band) ? band : DEFAULT_AGE_BAND];
}

export function loadAgeBand(): AgeBand {
  try {
    const stored = localStorage.getItem(AGE_BAND_KEY);
    return isAgeBand(stored) ? stored : DEFAULT_AGE_BAND;
  } catch {
    return DEFAULT_AGE_BAND;
  }
}

export function saveAgeBand(band: AgeBand): void {
  try {
    localStorage.setItem(AGE_BAND_KEY, band);
  } catch {
    // ignore storage errors (private mode etc.)
  }
}

export function loadAgeProfile(): AgeProfile {
  return getAgeProfile(loadAgeBand());
}

/** 每轮回复人数：至少 1 个，最多不超过年龄档上限 */
export function capResponders<T>(candidates: T[], profile: AgeProfile): T[] {
  return candidates.slice(0, Math.max(1, profile.maxRespondersPerTurn));
}
