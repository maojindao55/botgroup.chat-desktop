import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { KidProvider, useKid } from './KidContext';
import { ParentCornerBadge } from './components/ParentGate';

const navItems = [
  { to: '/', label: '小伙伴', emoji: '🏠', end: true },
  { to: '/games', label: '小游戏', emoji: '🎲', end: false },
  { to: '/stars', label: '我的星星', emoji: '⭐', end: false },
];

function BadgeCelebration() {
  const { celebration, dismissCelebration } = useKid();

  useEffect(() => {
    if (!celebration.length) return;
    const timer = setTimeout(dismissCelebration, 4000);
    return () => clearTimeout(timer);
  }, [celebration, dismissCelebration]);

  if (!celebration.length) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="badge-celebration"
      className="pointer-events-none fixed right-4 top-20 z-40 flex min-h-16 items-center gap-3 rounded-3xl bg-white px-5 py-3 shadow-xl ring-4 ring-amber-200"
    >
      <span className="text-3xl" aria-hidden>{celebration[celebration.length - 1].emoji}</span>
      <span className="text-left">
        <span className="block text-sm text-amber-600">得到新徽章啦！</span>
        <span className="block text-lg font-bold text-slate-800">{celebration.map((b) => b.name).join('、')}</span>
      </span>
    </div>
  );
}

function KidShell() {
  const { rewards, profile } = useKid();
  return (
    <div
      className="flex h-[100dvh] flex-col overflow-hidden bg-gradient-to-b from-amber-50 via-orange-50 to-sky-50 text-slate-800"
      style={{ fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif' }}
      data-age-band={profile.band}
    >
      <header className="flex shrink-0 items-center gap-3 px-4 pb-2 pt-[max(12px,env(safe-area-inset-top))]">
        <ParentCornerBadge />
        <nav className="flex flex-1 justify-center gap-2" aria-label="儿童导航">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex min-h-14 items-center gap-2 rounded-full px-4 text-lg font-bold transition sm:px-5 ${
                  isActive ? 'bg-amber-400 text-white shadow-md' : 'bg-white/70 text-slate-600'
                }`
              }
            >
              <span aria-hidden>{item.emoji}</span>
              <span className="hidden sm:inline">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="flex h-14 shrink-0 items-center gap-1 rounded-2xl bg-white/80 px-4 text-xl font-bold text-amber-500 shadow-sm" data-testid="star-total" aria-label={`星星 ${rewards.stars} 颗`}>
          <span aria-hidden>⭐</span>
          {rewards.stars}
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
      <BadgeCelebration />
    </div>
  );
}

export default function KidLayout() {
  return (
    <KidProvider>
      <KidShell />
    </KidProvider>
  );
}
