/**
 * 临时家长入口：长按角标后回答一道算术题。只是挡住小朋友误触，并不是安全边界；
 * 第二期的家长中心会换成 PIN。
 */

export interface ArithmeticChallenge {
  question: string;
  answer: number;
}

export const PARENT_UNLOCK_MS = 30 * 60 * 1000;
const UNLOCK_KEY = 'parent_unlocked_until';

/** 两位数乘一位数，例如 37 × 6，学龄前孩子基本算不出来 */
export function createArithmeticChallenge(random: () => number = Math.random): ArithmeticChallenge {
  const a = 12 + Math.floor(random() * 88);
  const b = 3 + Math.floor(random() * 7);
  return { question: `${a} × ${b} = ?`, answer: a * b };
}

export function checkChallengeAnswer(challenge: ArithmeticChallenge, input: string): boolean {
  const normalized = (input || '').replace(/[\s,，]/g, '').replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  return /^\d+$/.test(normalized) && Number(normalized) === challenge.answer;
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

export function unlockParentArea(now = Date.now()): void {
  storage()?.setItem(UNLOCK_KEY, String(now + PARENT_UNLOCK_MS));
}

export function lockParentArea(): void {
  storage()?.removeItem(UNLOCK_KEY);
}

export function isParentAreaUnlocked(now = Date.now()): boolean {
  const until = Number(storage()?.getItem(UNLOCK_KEY) || 0);
  return Number.isFinite(until) && until > now;
}
