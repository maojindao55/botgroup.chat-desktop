import Markdown from '@/components/Markdown';
import type { KidCompanion } from '../KidContext';

export function CompanionAvatar({ companion, size = 56 }: { companion?: KidCompanion; size?: number }) {
  if (!companion) {
    return (
      <div className="flex shrink-0 items-center justify-center rounded-full bg-amber-100 text-2xl" style={{ width: size, height: size }} aria-hidden>
        🌈
      </div>
    );
  }
  return (
    <img
      src={companion.member.avatar}
      alt={companion.member.name}
      className="shrink-0 rounded-full bg-white object-cover shadow-sm"
      style={{ width: size, height: size, boxShadow: `0 0 0 3px ${companion.meta.color}33` }}
      draggable={false}
    />
  );
}

interface ChatBubbleProps {
  isKid: boolean;
  speakerName: string;
  content: string;
  companion?: KidCompanion;
  fontSize: number;
  pending?: boolean;
  isError?: boolean;
  onReadAloud?: () => void;
}

export function ChatBubble({ isKid, speakerName, content, companion, fontSize, pending, isError, onReadAloud }: ChatBubbleProps) {
  if (isKid) {
    return (
      <div className="flex justify-end" data-testid="kid-bubble">
        <div
          className="max-w-[78%] whitespace-pre-wrap break-words rounded-[28px] rounded-br-lg bg-amber-400 px-5 py-3 font-medium text-white shadow-sm"
          style={{ fontSize, lineHeight: 1.6 }}
        >
          {content}
        </div>
      </div>
    );
  }
  const color = companion?.meta.color || '#F59E0B';
  return (
    <div className="flex items-end gap-3" data-testid="companion-bubble" data-speaker={speakerName}>
      <CompanionAvatar companion={companion} size={52} />
      <div className="flex min-w-0 max-w-[78%] flex-col gap-1">
        <span className="pl-2 text-sm font-semibold" style={{ color }}>{speakerName}</span>
        <div
          className={`rounded-[28px] rounded-bl-lg border-2 bg-white px-5 py-3 text-slate-700 shadow-sm ${isError ? 'border-rose-200 bg-rose-50' : ''}`}
          style={{ borderColor: isError ? undefined : `${color}40` }}
        >
          {pending && !content ? (
            <span className="inline-flex gap-1 py-2" aria-label="正在想">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-3 w-3 animate-bounce rounded-full" style={{ background: color, animationDelay: `${i * 150}ms` }} />
              ))}
            </span>
          ) : (
            <Markdown content={content} fontSize={fontSize} />
          )}
        </div>
      </div>
      {onReadAloud && content && !pending && !isError && (
        <button
          type="button"
          onClick={onReadAloud}
          aria-label="再读一遍"
          className="mb-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-xl shadow-sm"
        >
          🔊
        </button>
      )}
    </div>
  );
}
