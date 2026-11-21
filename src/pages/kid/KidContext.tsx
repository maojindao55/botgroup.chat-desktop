import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { KID_COMPANION_IDS, getCompanionMeta, type AIMember, type CompanionMeta } from '@/config/aiMembers';
import { loadAgeProfile, type AgeProfile } from '@/config/ageProfile';
import { loadKidMemory, type KidMemory } from '@/config/kidMemory';
import { loadVoicePrefs, resolveVoicePrefs, saveVoicePrefs, type KidVoicePrefs, type ResolvedVoicePrefs } from '@/config/kidPrefs';
import {
  applyGameResult,
  applyMessage,
  loadRewardStats,
  saveRewardStats,
  type BadgeDefinition,
  type KidRewardStats,
} from '@/config/kidRewards';
import type { KidGameId } from '@/config/ageProfile';
import { getSpeechRecognizer, getSpeechSynthesizer, type SpeechRecognizer, type SpeechSynthesizer } from '@/lib/speech';
import { useAIMemberStore } from '@/store/aiMemberStore';

export interface KidCompanion {
  member: AIMember;
  meta: CompanionMeta;
}

interface KidContextValue {
  profile: AgeProfile;
  memory: KidMemory;
  refreshMemory: () => void;
  companions: KidCompanion[];
  companionsLoading: boolean;
  rewards: KidRewardStats;
  recordMessage: (companionIds: string[]) => void;
  recordGame: (result: { gameId: KidGameId; levelId: string; levelNumber: number; stars: number }) => number;
  celebration: BadgeDefinition[];
  dismissCelebration: () => void;
  voice: ResolvedVoicePrefs;
  setVoicePrefs: (prefs: KidVoicePrefs) => void;
  recognizer: SpeechRecognizer;
  synthesizer: SpeechSynthesizer;
}

const KidContext = createContext<KidContextValue | null>(null);

export function KidProvider({ children }: { children: ReactNode }) {
  const [profile] = useState(loadAgeProfile);
  const [memory, setMemory] = useState(loadKidMemory);
  const [rewards, setRewards] = useState(loadRewardStats);
  const [celebration, setCelebration] = useState<BadgeDefinition[]>([]);
  const [voicePrefs, setVoicePrefsState] = useState(() => loadVoicePrefs(profile.band));
  const recognizer = useMemo(getSpeechRecognizer, []);
  const synthesizer = useMemo(getSpeechSynthesizer, []);

  const members = useAIMemberStore((s) => s.members);
  const loading = useAIMemberStore((s) => s.loading);
  const loadMembers = useAIMemberStore((s) => s.load);
  const [loadedOnce, setLoadedOnce] = useState(false);

  useEffect(() => {
    loadMembers().finally(() => setLoadedOnce(true));
  }, [loadMembers]);

  const companions = useMemo(
    () =>
      KID_COMPANION_IDS.flatMap((id) => {
        const member = members[id];
        const meta = getCompanionMeta(id);
        return member && meta && member.enabled !== false ? [{ member, meta }] : [];
      }),
    [members],
  );

  const commitRewards = useCallback((next: KidRewardStats, newBadges: BadgeDefinition[]) => {
    saveRewardStats(next);
    setRewards(next);
    if (newBadges.length) setCelebration((prev) => [...prev, ...newBadges]);
  }, []);

  const recordMessage = useCallback(
    (companionIds: string[]) => {
      const { stats, newBadges } = applyMessage(loadRewardStats(), companionIds);
      commitRewards(stats, newBadges);
    },
    [commitRewards],
  );

  const recordGame = useCallback(
    (result: { gameId: KidGameId; levelId: string; levelNumber: number; stars: number }) => {
      const { stats, newBadges, starsGained } = applyGameResult(loadRewardStats(), result);
      commitRewards(stats, newBadges);
      return starsGained;
    },
    [commitRewards],
  );

  const voice = useMemo(
    () => resolveVoicePrefs(profile, voicePrefs, { canRecognize: recognizer.supported, canSpeak: synthesizer.supported }),
    [profile, voicePrefs, recognizer, synthesizer],
  );

  const setVoicePrefs = useCallback(
    (prefs: KidVoicePrefs) => {
      setVoicePrefsState((prev) => {
        const next = { ...prev, ...prefs };
        saveVoicePrefs(profile.band, next);
        return next;
      });
    },
    [profile.band],
  );

  const refreshMemory = useCallback(() => setMemory(loadKidMemory()), []);
  const dismissCelebration = useCallback(() => setCelebration([]), []);

  const value: KidContextValue = {
    profile,
    memory,
    refreshMemory,
    companions,
    companionsLoading: loading || !loadedOnce,
    rewards,
    recordMessage,
    recordGame,
    celebration,
    dismissCelebration,
    voice,
    setVoicePrefs,
    recognizer,
    synthesizer,
  };

  return <KidContext.Provider value={value}>{children}</KidContext.Provider>;
}

export function useKid(): KidContextValue {
  const ctx = useContext(KidContext);
  if (!ctx) throw new Error('useKid must be used inside KidProvider');
  return ctx;
}
