import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  MAX_KID_LEVEL,
  buildGameHostPrompt,
  chainCheckMessage,
  generateKidGameLevel,
  getGamesForAge,
  lastChar,
  type KidGameId,
  type KidGameLevel,
} from '@/config/aiGame';
import {
  acceptCompanionWord,
  canRequestHint,
  chainGameStars,
  guessGameStars,
  requestHint,
  revealAnimal,
  startChainGame,
  startGuessGame,
  startStoryGame,
  storyGameStars,
  storyOpening,
  submitChainWord,
  submitGuess,
  submitStoryLine,
  type ChainGameState,
  type GuessGameState,
  type StoryGameState,
} from '@/config/kidGameFlow';
import { isLevelUnlocked } from '@/config/kidRewards';
import { useKid, type KidCompanion } from './KidContext';
import { ChatBubble, CompanionAvatar } from './components/ChatBubble';
import { KidInputBar } from './components/KidInputBar';
import { StarRow } from './components/StarRow';
import { KID_SPEAKER_ID, useKidMessages } from './hooks/useKidMessages';
import { useReadAloud } from './hooks/useReadAloud';

type GameState =
  | { kind: 'guess_animal'; state: GuessGameState }
  | { kind: 'word_chain'; state: ChainGameState }
  | { kind: 'story_chain'; state: StoryGameState };

interface GameResult {
  stars: number;
  starsGained: number;
}

function initialState(level: KidGameLevel): GameState {
  if (level.gameId === 'guess_animal') return { kind: 'guess_animal', state: startGuessGame(level) };
  if (level.gameId === 'word_chain') return { kind: 'word_chain', state: startChainGame() };
  return { kind: 'story_chain', state: startStoryGame() };
}

function GameSession({ level, host, onReplay }: { level: KidGameLevel; host: KidCompanion; onReplay: () => void }) {
  const navigate = useNavigate();
  const { profile, voice, recordGame, memory } = useKid();
  const { messages, push, askCompanion, busy, pendingId } = useKidMessages();
  const readAloud = useReadAloud();
  const [game, setGame] = useState<GameState>(() => initialState(level));
  const [result, setResult] = useState<GameResult | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const fontSize = profile.band === 'preschool' ? 22 : 19;
  const kidName = memory.nickname || '我';

  const say = (content: string) => {
    push({ speakerId: host.member.id, speakerName: host.member.name, content });
    if (voice.autoReadAloud) readAloud.enqueue(content, host.member.id, level.gameId);
  };

  const ask = async (message: string, gamePrompt: string) => {
    const speech = voice.autoReadAloud ? readAloud.stream(host.member.id, level.gameId) : null;
    const reply = await askCompanion({ companion: host, message, gamePrompt, onText: speech?.onText });
    speech?.finish(reply);
    return reply;
  };

  const finish = (stars: number) => {
    const starsGained = recordGame({ gameId: level.gameId, levelId: level.id, levelNumber: level.levelNumber, stars });
    setResult({ stars, starsGained });
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (game.kind === 'guess_animal') {
      say(`我想好了一种动物，你猜猜是什么？\n提示 1：${game.state.hintsGiven[0]}`);
    } else if (game.kind === 'word_chain') {
      say(`我先说：「${game.state.currentWord}」！请你用「${lastChar(game.state.currentWord)}」字开头接一个词～`);
    } else {
      void ask('我们开始讲故事吧！', buildGameHostPrompt(level, { round: 1 })).then((reply) => {
        if (!reply) say(storyOpening(level));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, result]);

  const handleSend = async (text: string) => {
    if (busy || result) return;
    readAloud.cancel();
    push({ speakerId: KID_SPEAKER_ID, speakerName: kidName, content: text });

    if (game.kind === 'guess_animal') {
      const { state, correct } = submitGuess(game.state, text);
      const judged = `游戏判定：小朋友猜「${text}」，${correct ? '猜对了！' : '猜错了。'}`;
      if (correct) {
        setGame({ kind: 'guess_animal', state });
        say(`猜对啦！就是 ${state.animal.emoji}${state.animal.name}！`);
        await ask(text, `${buildGameHostPrompt(level, { animal: state.animal, hintsGiven: state.hintsGiven })}\n${judged}`);
        finish(guessGameStars(level, state));
        return;
      }
      await ask(text, `${buildGameHostPrompt(level, { animal: state.animal, hintsGiven: state.hintsGiven })}\n${judged}`);
      if (canRequestHint(level, state)) {
        const next = requestHint(level, state);
        setGame({ kind: 'guess_animal', state: next });
        say(`提示 ${next.hintsGiven.length}：${next.hintsGiven[next.hintsGiven.length - 1]}`);
      } else {
        setGame({ kind: 'guess_animal', state });
        say('提示用完啦，再猜一次，或者点「告诉我答案」～');
      }
      return;
    }

    if (game.kind === 'word_chain') {
      const previous = game.state.currentWord;
      const { state, check } = submitChainWord(level, game.state, text);
      if (!check.ok) {
        say(chainCheckMessage(check, previous));
        return;
      }
      setGame({ kind: 'word_chain', state });
      if (state.status === 'won') {
        say(`接得真棒！我们一起接了 ${state.rounds} 次，成功啦！`);
        await ask(text, `${buildGameHostPrompt(level, { round: state.rounds })}\n游戏判定：小朋友完成了全部接龙，请热情地夸奖他，不用再接词。`);
        finish(chainGameStars(level, state));
        return;
      }
      const reply = await ask(text, buildGameHostPrompt(level, { currentWord: state.currentWord, usedWords: state.usedWords, round: state.rounds + 1 }));
      const accepted = acceptCompanionWord(state, reply || '');
      setGame({ kind: 'word_chain', state: accepted.state });
      if (accepted.fallback) {
        say(`这个字有点难，我换一个新词：「${accepted.word}」，请用「${lastChar(accepted.word)}」字开头接吧！`);
      }
      return;
    }

    const { state, accepted } = submitStoryLine(level, game.state, text);
    if (!accepted) {
      say('再多说一点点吧，比如：接下来谁出现了？');
      return;
    }
    setGame({ kind: 'story_chain', state });
    const round = state.status === 'won' ? level.targetRounds : state.rounds + 1;
    await ask(text, buildGameHostPrompt(level, { round }));
    if (state.status === 'won') finish(storyGameStars(level, state));
  };

  const giveHint = () => {
    if (game.kind !== 'guess_animal' || busy) return;
    const next = requestHint(level, game.state);
    if (next === game.state) return;
    setGame({ kind: 'guess_animal', state: next });
    say(`提示 ${next.hintsGiven.length}：${next.hintsGiven[next.hintsGiven.length - 1]}`);
  };

  const reveal = () => {
    if (game.kind !== 'guess_animal' || busy) return;
    const next = revealAnimal(game.state);
    setGame({ kind: 'guess_animal', state: next });
    say(`答案是 ${next.animal.emoji}${next.animal.name}！下次一定能猜到～`);
    finish(0);
  };

  const status = (() => {
    if (game.kind === 'guess_animal') {
      return (
        <span>
          已用提示 <b>{game.state.hintsGiven.length}</b> / {Math.min(level.targetRounds, game.state.animal.hints.length)}
        </span>
      );
    }
    if (game.kind === 'word_chain') {
      return (
        <span className="flex items-center gap-3">
          <span className="rounded-2xl bg-white px-4 py-1 text-2xl font-extrabold text-slate-700" data-testid="chain-current">{game.state.currentWord}</span>
          {game.state.status === 'won' ? (
            <span>✅ 接龙完成啦</span>
          ) : (
            <span>→ 用「<b className="text-2xl text-amber-600">{lastChar(game.state.currentWord)}</b>」开头</span>
          )}
          <span className="ml-auto">第 {game.state.rounds} / {level.targetRounds} 次</span>
        </span>
      );
    }
    return <span>故事进度：{game.state.rounds} / {level.targetRounds} 段</span>;
  })();

  const nextLevel = level.levelNumber < MAX_KID_LEVEL ? level.levelNumber + 1 : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="kid-game" data-game={level.gameId}>
      <div className="flex shrink-0 items-center gap-3 px-4 pb-2">
        <Link to={`/games/${level.gameId}`} aria-label="返回" className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-2xl shadow-sm">←</Link>
        <CompanionAvatar companion={host} size={48} />
        <h1 className="min-w-0 flex-1 truncate text-2xl font-extrabold">第 {level.levelNumber} 关 · {level.title}</h1>
      </div>
      <div className="mx-4 mb-2 rounded-3xl bg-amber-100/80 px-5 py-3 text-lg text-amber-800" data-testid="game-status">{status}</div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {messages.map((m) => {
          const isKid = m.speakerId === KID_SPEAKER_ID;
          return (
            <ChatBubble
              key={m.id}
              isKid={isKid}
              speakerName={m.speakerName}
              content={m.content}
              companion={isKid ? undefined : host}
              fontSize={fontSize}
              pending={m.id === pendingId}
              isError={m.isError}
              onReadAloud={!isKid && readAloud.supported ? () => readAloud.speakNow(m.content, host.member.id, level.gameId) : undefined}
            />
          );
        })}
        {result && (
          <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-[32px] bg-white p-6 text-center shadow-lg" data-testid="game-result">
            <div className="text-3xl font-extrabold">{result.stars > 0 ? '太棒啦！' : '没关系，再来一次！'}</div>
            <StarRow count={result.stars} size={44} />
            {result.starsGained > 0 && <div className="text-lg text-amber-600">获得 {result.starsGained} 颗新星星</div>}
            <div className="mt-2 grid w-full grid-cols-2 gap-3">
              <button type="button" onClick={onReplay} className="h-14 rounded-2xl bg-slate-100 text-lg font-bold text-slate-600">再玩一次</button>
              {result.stars > 0 && nextLevel ? (
                <button
                  type="button"
                  data-testid="next-level"
                  onClick={() => navigate(`/games/${level.gameId}/${nextLevel}`)}
                  className="h-14 rounded-2xl bg-amber-400 text-lg font-bold text-white"
                >
                  下一关
                </button>
              ) : (
                <Link to={`/games/${level.gameId}`} className="flex h-14 items-center justify-center rounded-2xl bg-amber-400 text-lg font-bold text-white">选关卡</Link>
              )}
            </div>
          </div>
        )}
      </div>

      {!result && game.kind === 'guess_animal' && (
        <div className="flex shrink-0 gap-3 px-4 pb-2">
          <button
            type="button"
            onClick={giveHint}
            disabled={busy || !canRequestHint(level, game.state)}
            data-testid="hint-button"
            className="h-14 flex-1 rounded-2xl bg-white text-lg font-bold text-sky-600 shadow-sm disabled:opacity-40"
          >
            💡 再给个提示
          </button>
          <button type="button" onClick={reveal} disabled={busy} className="h-14 flex-1 rounded-2xl bg-white text-lg font-bold text-slate-500 shadow-sm disabled:opacity-40">
            🙈 告诉我答案
          </button>
        </div>
      )}
      {!result && (
        <KidInputBar
          disabled={busy}
          onSend={handleSend}
          placeholder={game.kind === 'guess_animal' ? '我猜是……' : game.kind === 'word_chain' ? '接一个词' : '接下来发生了……'}
        />
      )}
    </div>
  );
}

export default function KidGamePlay() {
  const { gameId, level } = useParams();
  const { profile, rewards, companions, companionsLoading } = useKid();
  const [replayKey, setReplayKey] = useState(0);
  const game = getGamesForAge(profile.band).find((g) => g.id === gameId);
  const levelNumber = Number(level);
  const levelDef = useMemo(
    () => (game ? generateKidGameLevel(game.id as KidGameId, levelNumber, profile.band) : null),
    [game, levelNumber, profile.band],
  );

  if (!game || !levelDef || levelDef.levelNumber !== levelNumber || !isLevelUnlocked(rewards, game.id, levelNumber)) {
    return <Navigate to={game ? `/games/${game.id}` : '/games'} replace />;
  }
  const host = companions.find((c) => c.member.id === game.hostCompanionId) || companions[0];
  if (!host) {
    return companionsLoading ? <p className="p-8 text-center text-lg text-slate-500">小伙伴正在赶来……</p> : <Navigate to="/" replace />;
  }
  return <GameSession key={`${levelDef.id}-${replayKey}`} level={levelDef} host={host} onReplay={() => setReplayKey((k) => k + 1)} />;
}
