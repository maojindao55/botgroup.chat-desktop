/**
 * 合作型小游戏：猜动物、词语接龙、故事接龙。
 *
 * 规则判定（猜对没有、接龙合不合法、得几颗星）都在本地完成，伙伴只负责陪玩和鼓励，
 * 这样游戏结果稳定、可测试，也不依赖模型是否“守规矩”。本模块零运行时依赖。
 */
import type { AgeBand, KidGameId } from './ageProfile';

export type { KidGameId } from './ageProfile';

export interface KidGameDefinition {
  id: KidGameId;
  name: string;
  emoji: string;
  description: string;
  howToPlay: string[];
  /** 默认由哪位伙伴主持 */
  hostCompanionId: string;
  ageBands: AgeBand[];
}

export const kidGames: KidGameDefinition[] = [
  {
    id: 'guess_animal',
    name: '猜动物',
    emoji: '🦁',
    description: '伙伴给出小提示，你来猜猜是哪种动物。',
    howToPlay: ['伙伴想好一种动物', '每次给你一个小提示', '猜不出来可以再要一个提示', '猜对就能得到星星'],
    hostCompanionId: 'kid-curious-doctor',
    ageBands: ['preschool', 'school'],
  },
  {
    id: 'word_chain',
    name: '词语接龙',
    emoji: '🔗',
    description: '用上一个词的最后一个字，开头说一个新词。',
    howToPlay: ['伙伴先说一个词', '你用它的最后一个字开头说新词', '词语要 2 到 4 个字，不能重复', '一起接够目标次数就成功啦'],
    hostCompanionId: 'kid-math-bear',
    ageBands: ['school'],
  },
  {
    id: 'story_chain',
    name: '故事接龙',
    emoji: '📖',
    description: '你一句我一句，一起编一个温暖的小故事。',
    howToPlay: ['伙伴先讲故事的开头', '你接着说接下来发生了什么', '轮流说够几轮，故事就完成了'],
    hostCompanionId: 'kid-story-fairy',
    ageBands: ['preschool', 'school'],
  },
];

export function getKidGame(id: KidGameId): KidGameDefinition {
  return kidGames.find((game) => game.id === id) || kidGames[0];
}

export function getGamesForAge(band: AgeBand): KidGameDefinition[] {
  return kidGames.filter((game) => game.ageBands.includes(band));
}

// ============ 关卡 ============

export interface KidGameLevel {
  id: string;
  gameId: KidGameId;
  levelNumber: number;
  title: string;
  /** 1（最简单）到 5 */
  difficulty: number;
  /** 猜动物：最多可用提示数；接龙/故事：需要完成的轮数 */
  targetRounds: number;
  /** 故事接龙的主题 */
  theme?: string;
}

export const MAX_KID_LEVEL = 9;

const levelTitles: Record<KidGameId, string[]> = {
  guess_animal: ['农场好朋友', '森林小动物', '海洋世界', '草原探险', '极地旅行', '雨林秘境', '夜晚精灵', '昆虫王国', '动物大师'],
  word_chain: ['热身接龙', '小小接龙', '接龙火车', '接龙长队', '接龙高手', '接龙小能手', '接龙达人', '接龙冠军', '接龙大师'],
  story_chain: ['小兔找朋友', '会飞的雨伞', '月亮上的野餐', '迷路的小星星', '海底音乐会', '魔法种子', '雪人去旅行', '恐龙生日会', '彩虹桥冒险'],
};

export const storyThemes = levelTitles.story_chain;

function clampLevel(levelNumber: number): number {
  return Math.max(1, Math.min(MAX_KID_LEVEL, Math.floor(Number(levelNumber) || 1)));
}

export function generateKidGameLevel(gameId: KidGameId, levelNumber: number, band: AgeBand): KidGameLevel {
  const level = clampLevel(levelNumber);
  const difficulty = Math.min(5, 1 + Math.floor((level - 1) / 2));
  const preschool = band === 'preschool';
  let targetRounds: number;
  if (gameId === 'guess_animal') {
    // 难度越高，可用提示越少；小龄始终保留更多提示
    targetRounds = Math.max(preschool ? 3 : 2, (preschool ? 5 : 4) - Math.floor((level - 1) / 3));
  } else if (gameId === 'word_chain') {
    targetRounds = (preschool ? 2 : 3) + Math.floor((level - 1) / 2);
  } else {
    targetRounds = (preschool ? 2 : 3) + Math.floor((level - 1) / 3);
  }
  return {
    id: `${gameId}-${level}`,
    gameId,
    levelNumber: level,
    title: levelTitles[gameId][level - 1],
    difficulty,
    targetRounds,
    theme: gameId === 'story_chain' ? storyThemes[level - 1] : undefined,
  };
}

export function getKidGameLevels(gameId: KidGameId, band: AgeBand): KidGameLevel[] {
  return Array.from({ length: MAX_KID_LEVEL }, (_, index) => generateKidGameLevel(gameId, index + 1, band));
}

/**
 * 星星：成功至少 1 颗。猜动物用的提示越少星越多；接龙/故事按完成度给星。
 */
export function starsForResult(
  level: KidGameLevel,
  result: { success: boolean; hintsUsed?: number; roundsCompleted?: number },
): 0 | 1 | 2 | 3 {
  if (level.gameId === 'guess_animal') {
    if (!result.success) return 0;
    const hints = Math.max(1, result.hintsUsed ?? 1);
    if (hints <= 1) return 3;
    if (hints <= 2) return 2;
    return 1;
  }
  const rounds = Math.max(0, result.roundsCompleted ?? 0);
  if (result.success || rounds >= level.targetRounds) return 3;
  if (rounds >= Math.ceil(level.targetRounds / 2)) return 2;
  return rounds > 0 ? 1 : 0;
}

// ============ 猜动物 ============

export interface AnimalCard {
  name: string;
  emoji: string;
  aliases: string[];
  hints: string[];
  /** 1 常见 / 2 较常见 / 3 少见 */
  tier: 1 | 2 | 3;
}

export const animalCards: AnimalCard[] = [
  { name: '小猫', emoji: '🐱', aliases: ['猫', '猫咪', '小猫咪'], hints: ['我会喵喵叫', '我喜欢吃小鱼', '我有长长的胡须', '我会用舌头洗脸'], tier: 1 },
  { name: '小狗', emoji: '🐶', aliases: ['狗', '狗狗', '小狗狗'], hints: ['我会汪汪叫', '我很喜欢啃骨头', '开心的时候我会摇尾巴', '我的鼻子特别灵'], tier: 1 },
  { name: '兔子', emoji: '🐰', aliases: ['小兔', '小兔子', '兔'], hints: ['我有一对长耳朵', '我喜欢吃胡萝卜', '我走路蹦蹦跳跳', '我的尾巴短短圆圆的'], tier: 1 },
  { name: '小鸭', emoji: '🦆', aliases: ['鸭子', '鸭', '小鸭子'], hints: ['我会嘎嘎叫', '我的嘴巴扁扁的', '我会在水里游泳', '我走路摇摇摆摆'], tier: 1 },
  { name: '熊猫', emoji: '🐼', aliases: ['大熊猫'], hints: ['我身上只有黑白两种颜色', '我最爱吃竹子', '我有黑黑的眼圈', '我是中国的国宝'], tier: 2 },
  { name: '长颈鹿', emoji: '🦒', aliases: [], hints: ['我的脖子特别特别长', '我能吃到大树顶上的叶子', '我身上有好看的花斑', '我住在非洲草原'], tier: 2 },
  { name: '大象', emoji: '🐘', aliases: ['象', '小象'], hints: ['我的鼻子长长的', '我有两只大大的耳朵', '我用鼻子喝水和洗澡', '我是陆地上最大的动物之一'], tier: 2 },
  { name: '企鹅', emoji: '🐧', aliases: ['小企鹅'], hints: ['我住在很冷很冷的地方', '我是鸟但是不会飞', '我游泳游得很好', '我看起来像穿着燕尾服'], tier: 2 },
  { name: '海豚', emoji: '🐬', aliases: ['小海豚'], hints: ['我住在大海里', '我很聪明还会跳出水面', '我用声音和同伴说话', '我不是鱼，是哺乳动物'], tier: 3 },
  { name: '袋鼠', emoji: '🦘', aliases: [], hints: ['我肚子上有一个口袋', '我跳得又高又远', '宝宝住在我的口袋里', '我住在澳大利亚'], tier: 3 },
  { name: '变色龙', emoji: '🦎', aliases: [], hints: ['我的颜色会变来变去', '我的舌头又长又快', '我的两只眼睛能分开转', '我喜欢趴在树枝上'], tier: 3 },
  { name: '蜗牛', emoji: '🐌', aliases: ['小蜗牛'], hints: ['我背着一座小房子', '我爬得很慢很慢', '下雨天我最喜欢出来', '我头上有两对触角'], tier: 3 },
];

export function getAnimalPool(level: KidGameLevel): AnimalCard[] {
  const maxTier = level.difficulty <= 1 ? 1 : level.difficulty <= 3 ? 2 : 3;
  return animalCards.filter((card) => card.tier <= maxTier);
}

export function pickAnimal(level: KidGameLevel, random: () => number = Math.random): AnimalCard {
  const pool = getAnimalPool(level);
  return pool[Math.floor(random() * pool.length) % pool.length];
}

function normalizeGuess(text: string): string {
  return (text || '')
    .replace(/[\s，。！？!?,.、~～]/g, '')
    .replace(/^(是不是|是|我猜是|我猜|应该是|答案是)/, '')
    .replace(/(吧|吗|呀|啊|呢|哦)+$/, '');
}

export function isAnimalGuessCorrect(guess: string, card: AnimalCard): boolean {
  const normalized = normalizeGuess(guess);
  if (!normalized) return false;
  return [card.name, ...card.aliases].some((name) => normalized === name || normalized.includes(name));
}

// ============ 词语接龙 ============

export type ChainCheck =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'length' | 'not_chinese' | 'mismatch' | 'repeated' };

const CHINESE_WORD = /^[\u4e00-\u9fa5]+$/;

export function cleanChainWord(text: string): string {
  return (text || '').replace(/[\s，。！？!?,.、~～"“”「」]/g, '');
}

export function lastChar(word: string): string {
  const chars = Array.from(cleanChainWord(word));
  return chars[chars.length - 1] || '';
}

export function checkChainWord(previous: string, next: string, usedWords: string[] = []): ChainCheck {
  const word = cleanChainWord(next);
  if (!word) return { ok: false, reason: 'empty' };
  if (!CHINESE_WORD.test(word)) return { ok: false, reason: 'not_chinese' };
  const length = Array.from(word).length;
  if (length < 2 || length > 4) return { ok: false, reason: 'length' };
  const prevLast = lastChar(previous);
  if (prevLast && Array.from(word)[0] !== prevLast) return { ok: false, reason: 'mismatch' };
  if (usedWords.map(cleanChainWord).includes(word)) return { ok: false, reason: 'repeated' };
  return { ok: true };
}

export const chainStarterWords = ['苹果', '月亮', '小猫', '太阳', '花朵', '大树', '火车', '彩虹'];

export function chainCheckMessage(check: ChainCheck, previous: string): string {
  if (check.ok) return '接得真棒！';
  switch (check.reason) {
    case 'empty':
      return '先说一个词吧～';
    case 'not_chinese':
      return '我们用中文词语来接龙哦。';
    case 'length':
      return '词语要 2 到 4 个字哦，再想一个吧！';
    case 'mismatch':
      return `要用「${lastChar(previous)}」字开头哦，再想想～`;
    case 'repeated':
      return '这个词已经说过啦，换一个新的吧！';
  }
}

// ============ 伙伴主持 prompt ============

export interface GameHostState {
  /** 猜动物：答案（只给主持伙伴看） */
  animal?: AnimalCard;
  /** 猜动物：已经给出的提示 */
  hintsGiven?: string[];
  /** 词语接龙：当前要接的词 */
  currentWord?: string;
  usedWords?: string[];
  /** 当前第几轮（从 1 开始） */
  round?: number;
}

export function buildGameHostPrompt(level: KidGameLevel, state: GameHostState = {}): string {
  const round = state.round ?? 1;
  if (level.gameId === 'guess_animal') {
    return [
      '你在主持「猜动物」游戏，你和小朋友是一队的，目标是让小朋友开心地猜出来。',
      state.animal ? `答案是「${state.animal.name}」，在小朋友猜对之前绝对不能说出答案和它的别名。` : '',
      state.hintsGiven?.length ? `已经给过的提示：${state.hintsGiven.join('；')}。` : '',
      '小朋友猜错时先鼓励，再换个角度描述一下；猜对时热情地夸奖他。不要自己出新的提示，提示由游戏给出。',
    ].filter(Boolean).join('\n');
  }
  if (level.gameId === 'word_chain') {
    return [
      `你在和小朋友玩「词语接龙」，现在是第 ${round} 轮，一共要接 ${level.targetRounds} 轮。`,
      state.currentWord ? `当前的词是「${state.currentWord}」，你要用「${lastChar(state.currentWord)}」字开头说一个 2 到 4 个字的常见词语。` : '',
      state.usedWords?.length ? `这些词已经用过，不能再用：${state.usedWords.join('、')}。` : '',
      '回复格式：先用一句话夸夸小朋友，再说出你的词，并把你的词放在「」里，例如：真厉害！我接「果汁」。',
    ].filter(Boolean).join('\n');
  }
  return [
    `你在和小朋友玩「故事接龙」，主题是「${level.theme ?? '温暖的冒险'}」，现在是第 ${round} 轮，一共 ${level.targetRounds} 轮。`,
    round === 1 ? '先讲一个简短有趣的开头，然后请小朋友接着讲。' : '先接住小朋友刚才说的情节，再往下讲一两句，然后请小朋友继续。',
    round >= level.targetRounds ? '这是最后一轮，请给故事一个温暖的结尾，并夸夸小朋友的想象力。' : '',
  ].filter(Boolean).join('\n');
}

/** 从伙伴回复里取出接龙词：优先取「」里的词，其次取最后一个 2-4 字中文词 */
export function extractChainWord(reply: string): string {
  const quoted = reply.match(/「([\u4e00-\u9fa5]{2,4})」/g);
  if (quoted?.length) return quoted[quoted.length - 1].slice(1, -1);
  const words = reply.match(/[\u4e00-\u9fa5]{2,4}/g);
  return words?.length ? words[words.length - 1] : '';
}
