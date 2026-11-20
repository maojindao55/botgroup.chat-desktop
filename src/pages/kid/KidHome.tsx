import { Link } from 'react-router-dom';
import { useKid } from './KidContext';
import { CompanionAvatar } from './components/ChatBubble';
import { PLAYGROUND_CHAT_ID } from './kidRoutes';

export default function KidHome() {
  const { companions, companionsLoading, memory } = useKid();
  const name = memory.nickname || '小朋友';

  return (
    <div className="flex-1 overflow-y-auto px-5 pb-8 pt-2">
      <h1 className="mb-5 text-center text-3xl font-extrabold text-slate-800">
        嗨，{name}！今天想和谁玩？
      </h1>

      <Link
        to={`/chat/${PLAYGROUND_CHAT_ID}`}
        data-testid="playground-card"
        className="mx-auto mb-5 flex max-w-5xl items-center gap-4 rounded-[32px] bg-gradient-to-r from-amber-300 to-orange-300 p-5 text-white shadow-lg active:scale-[0.99]"
      >
        <div className="flex -space-x-4">
          {companions.map((c) => (
            <CompanionAvatar key={c.member.id} companion={c} size={64} />
          ))}
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-extrabold">小伙伴乐园</div>
          <div className="text-base opacity-90">大家一起聊天，谁最懂就谁来回答</div>
        </div>
        <span className="ml-auto text-4xl" aria-hidden>🎪</span>
      </Link>

      {companionsLoading && companions.length === 0 ? (
        <p className="text-center text-lg text-slate-500">小伙伴们正在赶来……</p>
      ) : (
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-4 lg:grid-cols-4">
          {companions.map((c) => (
            <Link
              key={c.member.id}
              to={`/chat/${c.member.id}`}
              data-testid={`companion-card-${c.member.id}`}
              className="flex flex-col items-center gap-3 rounded-[32px] border-4 bg-white p-5 text-center shadow-md active:scale-[0.98]"
              style={{ borderColor: `${c.meta.color}55` }}
            >
              <CompanionAvatar companion={c} size={112} />
              <div className="text-2xl font-extrabold" style={{ color: c.meta.color }}>
                {c.meta.emoji} {c.member.name}
              </div>
              <div className="text-base leading-snug text-slate-500">{c.member.description}</div>
              <div className="rounded-full px-3 py-1 text-sm font-medium" style={{ background: `${c.meta.color}18`, color: c.meta.color }}>
                “{c.meta.catchphrase}”
              </div>
            </Link>
          ))}
        </div>
      )}

      <Link
        to="/games"
        className="mx-auto mt-5 flex max-w-5xl items-center justify-center gap-3 rounded-[32px] bg-white/80 p-5 text-2xl font-bold text-sky-600 shadow-md"
      >
        <span aria-hidden>🎲</span> 和小伙伴玩游戏
      </Link>
    </div>
  );
}
