import { useEffect, useMemo, useRef } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { capResponders } from '@/config/ageProfile';
import { pickCompanions } from '@/config/companionScheduler';
import { rememberFromMessage } from '@/config/kidMemory';
import { useKid, type KidCompanion } from './KidContext';
import { ChatBubble, CompanionAvatar } from './components/ChatBubble';
import { KidInputBar } from './components/KidInputBar';
import { KID_SPEAKER_ID, useKidMessages } from './hooks/useKidMessages';
import { useReadAloud } from './hooks/useReadAloud';
import { PLAYGROUND_CHAT_ID } from './kidRoutes';

const suggestionsByCompanion: Record<string, string[]> = {
  'kid-curious-doctor': ['天空为什么是蓝色的？', '恐龙吃什么？', '月亮为什么会变？'],
  'kid-story-fairy': ['给我讲个故事吧', '讲一个小兔子的故事', '我们一起编故事'],
  'kid-math-bear': ['我们来数数吧', '考考我加法', '三角形有几条边？'],
  'kid-drawing-bunny': ['我想画一只小猫', '彩虹有几种颜色？', '红色和黄色混在一起是什么颜色？'],
  [PLAYGROUND_CHAT_ID]: ['大家好！', '给我讲个故事吧', '为什么会下雨？'],
};

function ChatView({ chatId, members }: { chatId: string; members: KidCompanion[] }) {
  const { profile, memory, recordMessage, refreshMemory, voice, setVoicePrefs, companions } = useKid();
  const { messages, push, askCompanion, busy, pendingId } = useKidMessages(chatId);
  const readAloud = useReadAloud();
  const listRef = useRef<HTMLDivElement>(null);
  const isPlayground = chatId === PLAYGROUND_CHAT_ID;
  const fontSize = profile.band === 'preschool' ? 22 : 19;
  const byId = useMemo(() => new Map(companions.map((c) => [c.member.id, c])), [companions]);

  const greeted = useRef(false);
  useEffect(() => {
    if (greeted.current || messages.length > 0) return;
    greeted.current = true;
    const greeter = members[0];
    const greeting = isPlayground
      ? `欢迎来到小伙伴乐园！${memory.nickname ? `${memory.nickname}，` : ''}想聊什么都可以，最懂这个话题的小伙伴会来回答你哦～`
      : greeter.meta.greeting;
    push({ speakerId: greeter.member.id, speakerName: isPlayground ? '小伙伴乐园' : greeter.member.name, content: greeting });
    if (voice.autoReadAloud) readAloud.enqueue(greeting, greeter.member.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (text: string) => {
    if (busy) return;
    readAloud.cancel();
    rememberFromMessage(text);
    refreshMemory();
    push({ speakerId: KID_SPEAKER_ID, speakerName: memory.nickname || '我', content: text });

    const lastSpeakerIds = [...messages].reverse().filter((m) => m.speakerId !== KID_SPEAKER_ID).slice(0, 1).map((m) => m.speakerId);
    const responders = isPlayground
      ? capResponders(
          pickCompanions(
            text,
            members.map((c) => ({ id: c.member.id, name: c.member.name, tags: c.member.tags, companion: c })),
            profile.maxRespondersPerTurn,
            { lastSpeakerIds },
          ),
          profile,
        ).map((picked) => picked.companion)
      : members;
    recordMessage(responders.map((c) => c.member.id));

    const allNames = members.map((c) => c.member.name);
    for (const companion of responders) {
      const speech = voice.autoReadAloud ? readAloud.stream(companion.member.id) : null;
      const reply = await askCompanion({ companion, message: text, allNames, onText: speech?.onText });
      speech?.finish(reply);
    }
  };

  const title = isPlayground ? '小伙伴乐园' : members[0].member.name;
  const accent = isPlayground ? '#F59E0B' : members[0].meta.color;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="kid-chat">
      <div className="flex shrink-0 items-center gap-3 px-4 pb-2">
        <Link to="/" aria-label="返回" className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-2xl shadow-sm">
          ←
        </Link>
        <div className="flex -space-x-3">
          {members.map((c) => (
            <CompanionAvatar key={c.member.id} companion={c} size={48} />
          ))}
        </div>
        <h1 className="min-w-0 flex-1 truncate text-2xl font-extrabold" style={{ color: accent }}>{title}</h1>
        {readAloud.supported && (
          <button
            type="button"
            onClick={() => {
              if (voice.autoReadAloud) readAloud.cancel();
              setVoicePrefs({ autoReadAloud: !voice.autoReadAloud });
            }}
            aria-pressed={voice.autoReadAloud}
            data-testid="toggle-read-aloud"
            className={`flex h-14 items-center gap-2 rounded-full px-4 text-base font-bold shadow-sm ${
              voice.autoReadAloud ? 'bg-sky-400 text-white' : 'bg-white text-slate-500'
            }`}
          >
            <span aria-hidden>{voice.autoReadAloud ? '🔊' : '🔈'}</span>
            {voice.autoReadAloud ? '自动朗读' : '朗读关'}
          </button>
        )}
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3" data-testid="kid-message-list">
        {messages.map((m) => {
          const isKid = m.speakerId === KID_SPEAKER_ID;
          return (
            <ChatBubble
              key={m.id}
              isKid={isKid}
              speakerName={m.speakerName}
              content={m.content}
              companion={isKid ? undefined : byId.get(m.speakerId)}
              fontSize={fontSize}
              pending={m.id === pendingId}
              isError={m.isError}
              onReadAloud={!isKid && readAloud.supported ? () => readAloud.speakNow(m.content, m.speakerId) : undefined}
            />
          );
        })}
      </div>

      <KidInputBar disabled={busy} onSend={handleSend} suggestions={suggestionsByCompanion[chatId]} />
    </div>
  );
}

export default function KidChat() {
  const { chatId = '' } = useParams();
  const { companions, companionsLoading } = useKid();
  const members = chatId === PLAYGROUND_CHAT_ID ? companions : companions.filter((c) => c.member.id === chatId);

  if (members.length === 0) {
    if (companionsLoading) return <p className="p-8 text-center text-lg text-slate-500">小伙伴正在赶来……</p>;
    return <Navigate to="/" replace />;
  }
  return <ChatView key={chatId} chatId={chatId} members={members} />;
}
