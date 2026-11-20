/**
 * 儿童端语音偏好。未设置时跟随年龄档默认值：3-6 岁按住说话加自动朗读，7-12 岁打字、朗读可选。
 */
import type { AgeBand, AgeProfile, KidInputMode } from './ageProfile';

export interface KidVoicePrefs {
  autoReadAloud?: boolean;
  inputMode?: KidInputMode;
}

export interface ResolvedVoicePrefs {
  autoReadAloud: boolean;
  inputMode: KidInputMode;
}

const PREFS_KEY = 'kid_voice_prefs';

function key(band: AgeBand) {
  return `${PREFS_KEY}:${band}`;
}

export function resolveVoicePrefs(
  profile: AgeProfile,
  prefs: KidVoicePrefs,
  capabilities: { canRecognize: boolean; canSpeak: boolean },
): ResolvedVoicePrefs {
  const wantedInput = prefs.inputMode ?? profile.defaultInputMode;
  return {
    autoReadAloud: capabilities.canSpeak && (prefs.autoReadAloud ?? profile.autoReadAloud),
    inputMode: wantedInput === 'voice' && capabilities.canRecognize ? 'voice' : 'text',
  };
}

export function loadVoicePrefs(band: AgeBand): KidVoicePrefs {
  try {
    const raw = localStorage.getItem(key(band));
    const parsed = raw ? JSON.parse(raw) : {};
    const prefs: KidVoicePrefs = {};
    if (typeof parsed?.autoReadAloud === 'boolean') prefs.autoReadAloud = parsed.autoReadAloud;
    if (parsed?.inputMode === 'voice' || parsed?.inputMode === 'text') prefs.inputMode = parsed.inputMode;
    return prefs;
  } catch {
    return {};
  }
}

export function saveVoicePrefs(band: AgeBand, prefs: KidVoicePrefs): void {
  try {
    localStorage.setItem(key(band), JSON.stringify(prefs));
  } catch {
    // ignore
  }
}
