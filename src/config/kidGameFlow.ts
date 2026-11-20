/**
 * 小游戏的回合状态机。规则判定都在这里完成，伙伴的回复只负责陪玩；
 * 模型出错或不守规矩时游戏仍然能继续。
 */
import {
  chainStarterWords,
  checkChainWord,
  cleanChainWord,
  extractChainWord,
  isAnimalGuessCorrect,
  pickAnimal,
  starsForResult,
  type AnimalCard,
  type ChainCheck,
  type KidGameLevel,
} from './aiGame';

export type GameStatus = 'playing' | 'won' | 'revealed';

// ============ 猜动物 ============

export interface GuessGameState {
  animal: AnimalCard;
  hintsGiven: string[];
  wrongGuesses: string[];
  status: GameStatus;
}

export function startGuessGame(level: KidGameLevel, random: () => number = Math.random): GuessGameState {
  const animal = pickAnimal(level, random);
  return { animal, hintsGiven: [animal.hints[0]], wrongGuesses: [], status: 'playing' };
}

export function maxHints(level: KidGameLevel, state: GuessGameState): number {
  return Math.min(level.targetRounds, state.animal.hints.length);
}

export function canRequestHint(level: KidGameLevel, state: GuessGameState): boolean {
  return state.status === 'playing' && state.hintsGiven.length < maxHints(level, state);
}

export function requestHint(level: KidGameLevel, state: GuessGameState): GuessGameState {
  if (!canRequestHint(level, state)) return state;
  return { ...state, hintsGiven: [...state.hintsGiven, state.animal.hints[state.hintsGiven.length]] };
}

export function submitGuess(state: GuessGameState, guess: string): { state: GuessGameState; correct: boolean } {
  if (state.status !== 'playing') return { state, correct: false };
  if (isAnimalGuessCorrect(guess, state.animal)) {
    return { state: { ...state, status: 'won' }, correct: true };
  }
  return { state: { ...state, wrongGuesses: [...state.wrongGuesses, guess] }, correct: false };
}

export function revealAnimal(state: GuessGameState): GuessGameState {
  return state.status === 'playing' ? { ...state, status: 'revealed' } : state;
}

export function guessGameStars(level: KidGameLevel, state: GuessGameState) {
  return starsForResult(level, { success: state.status === 'won', hintsUsed: state.hintsGiven.length });
}

// ============ 词语接龙 ============

export interface ChainGameState {
  currentWord: string;
  usedWords: string[];
  /** 孩子成功接上的次数 */
  rounds: number;
  status: GameStatus;
}

export function startChainGame(random: () => number = Math.random): ChainGameState {
  const word = chainStarterWords[Math.floor(random() * chainStarterWords.length) % chainStarterWords.length];
  return { currentWord: word, usedWords: [word], rounds: 0, status: 'playing' };
}

export function submitChainWord(
  level: KidGameLevel,
  state: ChainGameState,
  input: string,
): { state: ChainGameState; check: ChainCheck } {
  const word = cleanChainWord(input);
  const check = checkChainWord(state.currentWord, word, state.usedWords);
  if (!check.ok || state.status !== 'playing') return { state, check };
  const rounds = state.rounds + 1;
  return {
    check,
    state: {
      currentWord: word,
      usedWords: [...state.usedWords, word],
      rounds,
      status: rounds >= level.targetRounds ? 'won' : 'playing',
    },
  };
}

/**
 * 处理伙伴接的词：合法就接上；不合法（或模型出错）就换一个新的开头词，保证孩子总有词可接。
 */
export function acceptCompanionWord(
  state: ChainGameState,
  reply: string,
  random: () => number = Math.random,
): { state: ChainGameState; word: string; fallback: boolean } {
  const word = extractChainWord(reply || '');
  if (word && checkChainWord(state.currentWord, word, state.usedWords).ok) {
    return { state: { ...state, currentWord: word, usedWords: [...state.usedWords, word] }, word, fallback: false };
  }
  const fresh = chainStarterWords.filter((w) => !state.usedWords.includes(w));
  const pool = fresh.length ? fresh : chainStarterWords;
  const next = pool[Math.floor(random() * pool.length) % pool.length];
  return { state: { ...state, currentWord: next, usedWords: [...state.usedWords, next] }, word: next, fallback: true };
}

export function chainGameStars(level: KidGameLevel, state: ChainGameState) {
  return starsForResult(level, { success: state.status === 'won', roundsCompleted: state.rounds });
}

// ============ 故事接龙 ============

export interface StoryGameState {
  /** 孩子已经说了几段 */
  rounds: number;
  status: GameStatus;
}

export function startStoryGame(): StoryGameState {
  return { rounds: 0, status: 'playing' };
}

/** 孩子讲的一段至少要有两个字，避免空回复也算一轮 */
export function submitStoryLine(level: KidGameLevel, state: StoryGameState, line: string): { state: StoryGameState; accepted: boolean } {
  const content = (line || '').replace(/[\s，。！？!?,.、~～]/g, '');
  if (state.status !== 'playing' || Array.from(content).length < 2) return { state, accepted: false };
  const rounds = state.rounds + 1;
  return { state: { rounds, status: rounds >= level.targetRounds ? 'won' : 'playing' }, accepted: true };
}

export function storyOpening(level: KidGameLevel): string {
  return `很久很久以前，有一个关于「${level.theme ?? '好朋友'}」的故事……接下来会发生什么呢？你来说说看！`;
}

export function storyGameStars(level: KidGameLevel, state: StoryGameState) {
  return starsForResult(level, { success: state.status === 'won', roundsCompleted: state.rounds });
}
