/**
 * 星星和徽章，只存在本机 localStorage。零运行时依赖，便于测试。
 */
import type { KidGameId } from './ageProfile';

export interface KidRewardStats {
  stars: number;
  messagesSent: number;
  /** 聊过天的伙伴 id */
  companionsMet: string[];
  gamesPlayed: number;
  gamesWon: number;
  /** 每个游戏已通关的最高关卡 */
  bestLevel: Partial<Record<KidGameId, number>>;
  /** 每个关卡拿到的最多星星，key 为关卡 id */
  levelStars: Record<string, number>;
  badges: string[];
}

export interface BadgeDefinition {
  id: string;
  name: string;
  emoji: string;
  description: string;
  earned: (stats: KidRewardStats) => boolean;
}

export const badgeDefinitions: BadgeDefinition[] = [
  { id: 'first_hello', name: '初次见面', emoji: '👋', description: '第一次和小伙伴聊天', earned: (s) => s.messagesSent >= 1 },
  { id: 'chatterbox', name: '聊天小达人', emoji: '💬', description: '和小伙伴说了 30 句话', earned: (s) => s.messagesSent >= 30 },
  { id: 'all_friends', name: '好朋友满满', emoji: '🤝', description: '和 4 位小伙伴都聊过天', earned: (s) => s.companionsMet.length >= 4 },
  { id: 'first_win', name: '第一次过关', emoji: '🎉', description: '完成第一个小游戏', earned: (s) => s.gamesWon >= 1 },
  { id: 'star_10', name: '星星收集者', emoji: '⭐', description: '收集 10 颗星星', earned: (s) => s.stars >= 10 },
  { id: 'star_50', name: '星光闪闪', emoji: '🌟', description: '收集 50 颗星星', earned: (s) => s.stars >= 50 },
  { id: 'animal_expert', name: '动物小专家', emoji: '🦁', description: '猜动物通过第 3 关', earned: (s) => (s.bestLevel.guess_animal ?? 0) >= 3 },
  { id: 'chain_master', name: '接龙小能手', emoji: '🔗', description: '词语接龙通过第 3 关', earned: (s) => (s.bestLevel.word_chain ?? 0) >= 3 },
  { id: 'storyteller', name: '故事大王', emoji: '📖', description: '故事接龙通过第 3 关', earned: (s) => (s.bestLevel.story_chain ?? 0) >= 3 },
];

const REWARDS_KEY = 'kid_rewards';

export function emptyRewardStats(): KidRewardStats {
  return { stars: 0, messagesSent: 0, companionsMet: [], gamesPlayed: 0, gamesWon: 0, bestLevel: {}, levelStars: {}, badges: [] };
}

function toCount(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function normalizeRewardStats(raw: unknown): KidRewardStats {
  const base = emptyRewardStats();
  if (!raw || typeof raw !== 'object') return base;
  const value = raw as Record<string, any>;
  const strings = (list: unknown) => (Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
  const counts = (record: unknown) => {
    const out: Record<string, number> = {};
    if (record && typeof record === 'object') {
      for (const [key, n] of Object.entries(record)) {
        const count = toCount(n);
        if (count) out[key] = count;
      }
    }
    return out;
  };
  return {
    stars: toCount(value.stars),
    messagesSent: toCount(value.messagesSent),
    companionsMet: Array.from(new Set(strings(value.companionsMet))),
    gamesPlayed: toCount(value.gamesPlayed),
    gamesWon: toCount(value.gamesWon),
    bestLevel: counts(value.bestLevel),
    levelStars: counts(value.levelStars),
    badges: Array.from(new Set(strings(value.badges))),
  };
}

/** 重新计算徽章，返回新统计和本次新得到的徽章 */
export function evaluateBadges(stats: KidRewardStats): { stats: KidRewardStats; newBadges: BadgeDefinition[] } {
  const owned = new Set(stats.badges);
  const newBadges = badgeDefinitions.filter((badge) => !owned.has(badge.id) && badge.earned(stats));
  if (!newBadges.length) return { stats, newBadges };
  return { stats: { ...stats, badges: [...stats.badges, ...newBadges.map((b) => b.id)] }, newBadges };
}

export function applyMessage(stats: KidRewardStats, companionIds: string[]) {
  const met = new Set(stats.companionsMet);
  companionIds.forEach((id) => met.add(id));
  return evaluateBadges({ ...stats, messagesSent: stats.messagesSent + 1, companionsMet: Array.from(met) });
}

/**
 * 记录一局游戏。同一关卡重复玩只累计超过历史最高的星星，避免刷星。
 */
export function applyGameResult(
  stats: KidRewardStats,
  result: { gameId: KidGameId; levelId: string; levelNumber: number; stars: number },
) {
  const stars = Math.max(0, Math.min(3, Math.floor(result.stars)));
  const previous = stats.levelStars[result.levelId] ?? 0;
  const gained = Math.max(0, stars - previous);
  const won = stars > 0;
  const next: KidRewardStats = {
    ...stats,
    stars: stats.stars + gained,
    gamesPlayed: stats.gamesPlayed + 1,
    gamesWon: stats.gamesWon + (won ? 1 : 0),
    levelStars: gained ? { ...stats.levelStars, [result.levelId]: stars } : stats.levelStars,
    bestLevel: won && result.levelNumber > (stats.bestLevel[result.gameId] ?? 0)
      ? { ...stats.bestLevel, [result.gameId]: result.levelNumber }
      : stats.bestLevel,
  };
  const evaluated = evaluateBadges(next);
  return { ...evaluated, starsGained: gained };
}

/** 已解锁的关卡：通过第 n 关后解锁第 n+1 关 */
export function isLevelUnlocked(stats: KidRewardStats, gameId: KidGameId, levelNumber: number): boolean {
  return levelNumber <= (stats.bestLevel[gameId] ?? 0) + 1;
}

export function loadRewardStats(): KidRewardStats {
  try {
    const raw = localStorage.getItem(REWARDS_KEY);
    return normalizeRewardStats(raw ? JSON.parse(raw) : null);
  } catch {
    return emptyRewardStats();
  }
}

export function saveRewardStats(stats: KidRewardStats): void {
  try {
    localStorage.setItem(REWARDS_KEY, JSON.stringify(stats));
  } catch {
    // ignore
  }
}

export function getBadge(id: string): BadgeDefinition | undefined {
  return badgeDefinitions.find((badge) => badge.id === id);
}
