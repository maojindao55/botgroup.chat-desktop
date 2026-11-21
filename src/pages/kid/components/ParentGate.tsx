import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { checkChallengeAnswer, createArithmeticChallenge, unlockParentArea } from '@/config/parentGate';

const LONG_PRESS_MS = 1500;

/** 左上角的彩虹角标：长按 1.5 秒弹出算术题，答对进入家长设置 */
export function ParentCornerBadge() {
  const [pressing, setPressing] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancel = () => {
    clearTimeout(timer.current);
    setPressing(false);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <>
      <button
        type="button"
        aria-label="家长入口（长按）"
        data-testid="parent-corner"
        className="relative flex h-14 w-14 shrink-0 select-none items-center justify-center rounded-2xl bg-white/80 text-3xl shadow-sm"
        style={{ touchAction: 'none', WebkitTouchCallout: 'none' }}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={() => {
          setPressing(true);
          timer.current = setTimeout(() => {
            setPressing(false);
            setOpen(true);
          }, LONG_PRESS_MS);
        }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
      >
        <span aria-hidden>🌈</span>
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-2xl border-4 border-amber-400"
          style={{
            opacity: pressing ? 1 : 0,
            transform: pressing ? 'scale(1)' : 'scale(0.6)',
            transition: pressing ? `all ${LONG_PRESS_MS}ms linear` : 'all 150ms ease-out',
          }}
        />
      </button>
      {open && <ParentGateDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function ParentGateDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [challenge, setChallenge] = useState(() => createArithmeticChallenge());
  const [answer, setAnswer] = useState('');
  const [wrong, setWrong] = useState(false);

  const submit = () => {
    if (checkChallengeAnswer(challenge, answer)) {
      unlockParentArea();
      navigate('/parent?view=home');
      return;
    }
    setWrong(true);
    setAnswer('');
    setChallenge(createArithmeticChallenge());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6" role="dialog" aria-modal="true" aria-labelledby="parent-gate-title">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
        <h2 id="parent-gate-title" className="text-xl font-bold text-slate-800">家长验证</h2>
        <p className="mt-1 text-sm text-slate-500">请家长回答下面的算术题，进入模型和年龄设置。</p>
        <p className="mt-5 text-center text-3xl font-bold tracking-wide text-slate-800" data-testid="parent-question">{challenge.question}</p>
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            autoFocus
            inputMode="numeric"
            aria-label="答案"
            data-testid="parent-answer"
            value={answer}
            onChange={(e) => {
              setAnswer(e.target.value);
              setWrong(false);
            }}
            className="h-14 w-full rounded-2xl border-2 border-slate-200 px-4 text-center text-2xl outline-none focus:border-amber-400"
          />
          {wrong && <p className="mt-2 text-center text-sm text-rose-500">答案不对，换一道题再试试。</p>}
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button type="button" onClick={onClose} className="h-12 rounded-2xl bg-slate-100 text-base font-semibold text-slate-600">
              取消
            </button>
            <button type="submit" className="h-12 rounded-2xl bg-amber-400 text-base font-semibold text-white">
              确定
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
