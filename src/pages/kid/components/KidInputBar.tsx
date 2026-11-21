import { useEffect, useRef, useState } from 'react';
import type { SpeechErrorCode, SpeechRecognizer } from '@/lib/speech';
import { useKid } from '../KidContext';

interface KidInputBarProps {
  disabled?: boolean;
  /** 按住说话是否禁用，默认同 disabled */
  talkDisabled?: boolean;
  placeholder?: string;
  onSend: (text: string) => void;
  /** 一键发送的快捷话题 */
  suggestions?: string[];
  /** 替换默认的语音识别（实时语音对话） */
  recognizer?: SpeechRecognizer;
  /** 为 true 时语音结果不再走 onSend，由 recognizer 自己处理回复 */
  voiceRepliesItself?: boolean;
}

const speechErrorText: Partial<Record<SpeechErrorCode, string>> = {
  'not-allowed': '麦克风没有打开，请让爸爸妈妈帮忙打开权限。',
  'no-speech': '没有听到声音，再按住说一次吧～',
  network: '网络不太好，可以先打字哦。',
};

export function KidInputBar({
  disabled,
  talkDisabled = disabled,
  placeholder = '想说点什么？',
  onSend,
  suggestions,
  recognizer: recognizerOverride,
  voiceRepliesItself,
}: KidInputBarProps) {
  const { voice, setVoicePrefs, recognizer: defaultRecognizer, profile } = useKid();
  const recognizer = recognizerOverride || defaultRecognizer;
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [partial, setPartial] = useState('');
  const [hint, setHint] = useState('');
  const listeningRef = useRef(false);
  const useVoice = voice.inputMode === 'voice' && recognizer.supported;
  const fontSize = profile.band === 'preschool' ? 22 : 19;

  useEffect(() => () => recognizer.abort(), [recognizer]);

  const send = (value: string) => {
    const content = value.trim();
    if (!content || disabled) return;
    onSend(content);
    setText('');
  };

  const startListening = () => {
    if (talkDisabled || listeningRef.current) return;
    listeningRef.current = true;
    setListening(true);
    setPartial('');
    setHint('');
    recognizer.start(
      {
        onPartial: setPartial,
        onFinal: (result) => {
          listeningRef.current = false;
          setListening(false);
          setRecognizing(false);
          setPartial('');
          if (voiceRepliesItself) return;
          if (result) send(result);
          else setHint(speechErrorText['no-speech'] || '');
        },
        onError: (error, message) => {
          listeningRef.current = false;
          setListening(false);
          setRecognizing(false);
          setHint(message || speechErrorText[error] || '没听清楚，再试一次吧～');
        },
      },
      { lang: 'zh-CN' },
    );
  };

  const stopListening = () => {
    if (!listeningRef.current) return;
    setRecognizing(true);
    recognizer.stop();
  };

  return (
    <div className="border-t-2 border-amber-100 bg-white/90 px-4 pb-4 pt-3 backdrop-blur" data-testid="kid-input-bar">
      {suggestions && suggestions.length > 0 && (
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              disabled={disabled}
              onClick={() => send(s)}
              className="min-h-12 shrink-0 rounded-full border-2 border-amber-200 bg-amber-50 px-4 text-base font-medium text-amber-700 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {hint && <p className="mb-2 text-center text-sm text-rose-500">{hint}</p>}
      <div className="flex items-center gap-3">
        {recognizer.supported && (
          <button
            type="button"
            aria-label={useVoice ? '切换到打字' : '切换到说话'}
            onClick={() => setVoicePrefs({ inputMode: useVoice ? 'text' : 'voice' })}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-slate-100 text-2xl"
          >
            {useVoice ? '⌨️' : '🎤'}
          </button>
        )}
        {useVoice ? (
          <button
            type="button"
            disabled={talkDisabled}
            data-testid="push-to-talk"
            style={{ touchAction: 'none' }}
            onPointerDown={startListening}
            onPointerUp={stopListening}
            onPointerLeave={stopListening}
            onPointerCancel={stopListening}
            onContextMenu={(e) => e.preventDefault()}
            className={`flex h-16 flex-1 select-none items-center justify-center gap-2 rounded-full text-xl font-bold text-white shadow-md transition disabled:opacity-50 ${
              listening ? 'scale-[1.02] bg-rose-400' : 'bg-amber-400'
            }`}
          >
            <span aria-hidden>{recognizing ? '🤔' : listening ? '👂' : '🎤'}</span>
            <span className="truncate">
              {recognizing ? partial || '我想想你说了什么…' : listening ? partial || '我在听，说完松开～' : '按住说话'}
            </span>
          </button>
        ) : (
          <form
            className="flex flex-1 items-center gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={placeholder}
              aria-label={placeholder}
              data-testid="kid-text-input"
              maxLength={200}
              className="h-14 min-w-0 flex-1 rounded-full border-2 border-amber-200 bg-white px-5 text-slate-700 outline-none focus:border-amber-400"
              style={{ fontSize }}
            />
            <button
              type="submit"
              disabled={disabled || !text.trim()}
              aria-label="发送"
              data-testid="kid-send"
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-amber-400 text-2xl text-white shadow-md disabled:opacity-40"
            >
              ➤
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
