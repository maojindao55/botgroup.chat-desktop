import { Link, Navigate, useParams } from 'react-router-dom';
import { getGamesForAge, getKidGame, getKidGameLevels, type KidGameId } from '@/config/aiGame';
import { isLevelUnlocked } from '@/config/kidRewards';
import { useKid } from './KidContext';
import { CompanionAvatar } from './components/ChatBubble';
import { StarRow } from './components/StarRow';

export function KidGameList() {
  const { profile, companions } = useKid();
  const games = getGamesForAge(profile.band);

  return (
    <div className="flex-1 overflow-y-auto px-5 pb-8 pt-2">
      <h1 className="mb-5 text-center text-3xl font-extrabold">和小伙伴一起玩游戏</h1>
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {games.map((game) => {
          const host = companions.find((c) => c.member.id === game.hostCompanionId);
          return (
            <Link
              key={game.id}
              to={`/games/${game.id}`}
              data-testid={`game-card-${game.id}`}
              className="flex flex-col gap-3 rounded-[32px] bg-white p-6 shadow-md active:scale-[0.99]"
            >
              <div className="flex items-center gap-3">
                <span className="text-5xl" aria-hidden>{game.emoji}</span>
                <span className="text-2xl font-extrabold">{game.name}</span>
              </div>
              <p className="text-lg text-slate-500">{game.description}</p>
              {host && (
                <div className="mt-auto flex items-center gap-2 text-base text-slate-500">
                  <CompanionAvatar companion={host} size={40} />
                  {host.member.name}主持
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function KidGameLevels() {
  const { gameId } = useParams();
  const { profile, rewards } = useKid();
  const games = getGamesForAge(profile.band);
  const game = games.find((g) => g.id === gameId);
  if (!game) return <Navigate to="/games" replace />;
  const levels = getKidGameLevels(game.id as KidGameId, profile.band);
  const definition = getKidGame(game.id);

  return (
    <div className="flex-1 overflow-y-auto px-5 pb-8 pt-2">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex items-center gap-3">
          <Link to="/games" aria-label="返回" className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-2xl shadow-sm">←</Link>
          <h1 className="text-3xl font-extrabold">{definition.emoji} {definition.name}</h1>
        </div>
        <ol className="mb-5 flex flex-wrap gap-2 text-base text-slate-600">
          {definition.howToPlay.map((step, i) => (
            <li key={step} className="rounded-full bg-white/80 px-4 py-2">{i + 1}. {step}</li>
          ))}
        </ol>
        <div className="grid grid-cols-3 gap-4">
          {levels.map((level) => {
            const unlocked = isLevelUnlocked(rewards, level.gameId, level.levelNumber);
            const stars = rewards.levelStars[level.id] ?? 0;
            const body = (
              <>
                <span className="text-3xl font-extrabold">{unlocked ? level.levelNumber : '🔒'}</span>
                <span className="text-base font-semibold">{level.title}</span>
                <StarRow count={stars} size={22} />
              </>
            );
            return unlocked ? (
              <Link
                key={level.id}
                to={`/games/${level.gameId}/${level.levelNumber}`}
                data-testid={`level-${level.levelNumber}`}
                className="flex min-h-32 flex-col items-center justify-center gap-1 rounded-[28px] bg-white p-3 text-center text-slate-700 shadow-md active:scale-[0.98]"
              >
                {body}
              </Link>
            ) : (
              <div key={level.id} className="flex min-h-32 flex-col items-center justify-center gap-1 rounded-[28px] bg-white/50 p-3 text-center text-slate-400" aria-disabled>
                {body}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
