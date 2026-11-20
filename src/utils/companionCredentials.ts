import { invoke } from '@tauri-apps/api/core';
import { loadKidModel, pickCompanionModel, type ProviderLike } from '@/config/kidModel';
import { resolveLlmCredentials, type ResolvedLlmCredentials } from '@/utils/resolveLlmCredentials';

export const KID_MODEL_MISSING_MESSAGE = '还没有为小伙伴选择模型，请让爸爸妈妈在设置里配置一下。';

/** 解析伙伴调用凭据：成员自带模型 → 家长设置的伙伴模型 → 第一个可用 Provider */
export async function resolveCompanionCredentials(
  model?: string,
  providerId?: string,
): Promise<ResolvedLlmCredentials> {
  let providers: ProviderLike[] = [];
  if (!(model && providerId)) {
    try {
      providers = await invoke<ProviderLike[]>('list_providers');
    } catch {
      providers = [];
    }
  }
  const picked = pickCompanionModel({ providerId, model }, loadKidModel(), providers);
  if (!picked) {
    if (model) return resolveLlmCredentials(model, providerId || undefined);
    throw new Error(KID_MODEL_MISSING_MESSAGE);
  }
  return resolveLlmCredentials(picked.model, picked.providerId);
}
