/**
 * 轻量本地记忆：只记孩子的昵称和兴趣，存在本机 localStorage，不上传。
 */

export interface KidMemory {
  nickname?: string;
  interests: string[];
}

const KID_MEMORY_KEY = 'kid_memory';
export const MAX_INTERESTS = 8;
const MAX_NICKNAME_LEN = 6;
const MAX_INTEREST_LEN = 8;

const NICKNAME_PATTERNS = [/(?:我叫|叫我|我的名字是|我的名字叫)([\u4e00-\u9fa5A-Za-z]{1,12})/];
const INTEREST_PATTERNS = [/我(?:最|很|超|特别|非常)?(?:喜欢|爱)([\u4e00-\u9fa5A-Za-z]{1,16})/g];
/** 这些词说明「喜欢」后面不是兴趣本身 */
const INTEREST_STOPWORDS = new Set(['你', '你们', '他', '她', '它', '这个', '那个', '什么', '谁', '吗']);
const TRAILING_PARTICLES = /(?:了|啦|呀|呢|哦|吧|的|吗|啊)+$/;

export function emptyKidMemory(): KidMemory {
  return { interests: [] };
}

function cleanToken(raw: string, maxLen: number): string {
  return raw.replace(TRAILING_PARTICLES, '').trim().slice(0, maxLen);
}

/** 从孩子的一句话里提取昵称和兴趣，返回新的记忆对象（不修改入参） */
export function updateMemoryFromMessage(memory: KidMemory, text: string): KidMemory {
  const next: KidMemory = { ...memory, interests: [...memory.interests] };
  const sentence = (text || '').trim();
  if (!sentence) return next;

  for (const pattern of NICKNAME_PATTERNS) {
    const match = sentence.match(pattern);
    const nickname = match ? cleanToken(match[1], MAX_NICKNAME_LEN) : '';
    if (nickname) next.nickname = nickname;
  }

  for (const pattern of INTEREST_PATTERNS) {
    for (const match of sentence.matchAll(pattern)) {
      const interest = cleanToken(match[1], MAX_INTEREST_LEN);
      if (!interest || INTEREST_STOPWORDS.has(interest)) continue;
      next.interests = [interest, ...next.interests.filter((item) => item !== interest)];
    }
  }
  next.interests = next.interests.slice(0, MAX_INTERESTS);
  return next;
}

export function loadKidMemory(): KidMemory {
  try {
    const raw = localStorage.getItem(KID_MEMORY_KEY);
    if (!raw) return emptyKidMemory();
    const parsed = JSON.parse(raw);
    return {
      nickname: typeof parsed?.nickname === 'string' && parsed.nickname ? parsed.nickname.slice(0, MAX_NICKNAME_LEN) : undefined,
      interests: Array.isArray(parsed?.interests)
        ? parsed.interests.filter((item: unknown): item is string => typeof item === 'string').slice(0, MAX_INTERESTS)
        : [],
    };
  } catch {
    return emptyKidMemory();
  }
}

export function saveKidMemory(memory: KidMemory): void {
  try {
    localStorage.setItem(KID_MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // ignore
  }
}

export function clearKidMemory(): void {
  try {
    localStorage.removeItem(KID_MEMORY_KEY);
  } catch {
    // ignore
  }
}

/** 读取 → 根据孩子的话更新 → 写回，返回更新后的记忆 */
export function rememberFromMessage(text: string): KidMemory {
  const next = updateMemoryFromMessage(loadKidMemory(), text);
  saveKidMemory(next);
  return next;
}
