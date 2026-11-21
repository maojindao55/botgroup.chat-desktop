/**
 * 本地「智能点名」：按名字和标签关键词挑选回复的伙伴，不额外调用模型，孩子等待更短。
 */

export interface SchedulableCompanion {
  id: string;
  name: string;
  tags?: string[];
}

export interface PickCompanionOptions {
  /** 上一轮发言的伙伴，没有命中关键词时优先换一个人 */
  lastSpeakerIds?: string[];
  random?: () => number;
}

export function scoreCompanion(message: string, companion: SchedulableCompanion): number {
  const text = (message || '').toLowerCase();
  if (!text) return 0;
  let score = 0;
  if (companion.name && text.includes(companion.name.toLowerCase())) score += 5;
  for (const tag of companion.tags || []) {
    if (tag && text.includes(tag.toLowerCase())) score += 2;
  }
  return score;
}

export function pickCompanions<T extends SchedulableCompanion>(
  message: string,
  companions: T[],
  maxResponders: number,
  options: PickCompanionOptions = {},
): T[] {
  if (companions.length === 0) return [];
  const limit = Math.max(1, maxResponders);
  const scored = companions
    .map((companion, index) => ({ companion, index, score: scoreCompanion(message, companion) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  if (scored.length > 0) return scored.slice(0, limit).map((item) => item.companion);

  const random = options.random ?? Math.random;
  const last = new Set(options.lastSpeakerIds || []);
  const fresh = companions.filter((companion) => !last.has(companion.id));
  const pool = fresh.length > 0 ? fresh : companions;
  return [pool[Math.floor(random() * pool.length) % pool.length]];
}
