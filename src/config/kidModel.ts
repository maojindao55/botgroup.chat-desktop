/**
 * 「伙伴模型」：内置伙伴不绑定具体模型，统一使用家长在设置里选的 Provider + 模型。
 */

export interface KidModelSetting {
  providerId: string;
  model: string;
}

export interface ProviderLike {
  id: string;
  enabled?: boolean;
  models?: string[];
}

const KID_MODEL_KEY = 'kid_model';

export function loadKidModel(): KidModelSetting | null {
  try {
    const raw = localStorage.getItem(KID_MODEL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.providerId === 'string' && parsed.providerId && typeof parsed?.model === 'string' && parsed.model) {
      return { providerId: parsed.providerId, model: parsed.model };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveKidModel(setting: KidModelSetting | null): void {
  try {
    if (setting) localStorage.setItem(KID_MODEL_KEY, JSON.stringify(setting));
    else localStorage.removeItem(KID_MODEL_KEY);
  } catch {
    // ignore
  }
}

/**
 * 选出本次调用要用的模型：成员自己配置的 → 家长设置的伙伴模型 → 第一个可用 Provider 的第一个模型。
 * 都没有时返回 null，由调用方提示家长去配置。
 */
export function pickCompanionModel(
  member: { providerId?: string; model?: string },
  setting: KidModelSetting | null,
  providers: ProviderLike[],
): KidModelSetting | null {
  if (member.providerId && member.model) return { providerId: member.providerId, model: member.model };
  if (setting) return setting;
  const fallback = providers.find((p) => p.enabled !== false && (p.models || []).length > 0);
  return fallback ? { providerId: fallback.id, model: (fallback.models as string[])[0] } : null;
}
