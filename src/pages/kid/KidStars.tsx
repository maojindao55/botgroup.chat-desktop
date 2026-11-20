import { badgeDefinitions } from '@/config/kidRewards';
import { useKid } from './KidContext';

export default function KidStars() {
  const { rewards } = useKid();
  const owned = new Set(rewards.badges);

  return (
    <div className="flex-1 overflow-y-auto px-5 pb-8 pt-2">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-col items-center gap-1 rounded-[32px] bg-white p-6 shadow-md">
          <span className="text-6xl" aria-hidden>⭐</span>
          <span className="text-4xl font-extrabold text-amber-500" data-testid="stars-page-total">{rewards.stars}</span>
          <span className="text-lg text-slate-500">玩游戏过关就能收集星星</span>
        </div>
        <h2 className="mb-4 text-2xl font-extrabold">我的徽章</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {badgeDefinitions.map((badge) => {
            const earned = owned.has(badge.id);
            return (
              <div
                key={badge.id}
                data-testid={`badge-${badge.id}`}
                data-earned={earned}
                className={`flex flex-col items-center gap-2 rounded-[28px] p-5 text-center shadow-sm ${earned ? 'bg-white' : 'bg-white/50'}`}
              >
                <span className="text-5xl" aria-hidden style={{ filter: earned ? undefined : 'grayscale(1)', opacity: earned ? 1 : 0.4 }}>
                  {badge.emoji}
                </span>
                <span className={`text-lg font-bold ${earned ? 'text-slate-800' : 'text-slate-400'}`}>{badge.name}</span>
                <span className="text-sm text-slate-500">{badge.description}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
