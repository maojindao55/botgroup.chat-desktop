import type { Provider } from '@/config/providers';

export type TitleModelCandidate = {
  providerId: string;
  model: string;
  source: Provider['source'];
};

function titleModelWeight(model: string): number {
  const normalized = model.toLowerCase();
  if (/(reasoner|thinking|\br1\b|o1|o3)/.test(normalized)) return 30;
  if (/(turbo|flash|mini|lite)/.test(normalized)) return 0;
  if (/(chat|instruct)/.test(normalized)) return 10;
  return 20;
}

export function buildTitleModelCandidates(providers: Provider[]): TitleModelCandidate[] {
  return providers
    .filter(provider => provider.enabled !== false)
    .filter(provider => !provider.id.startsWith('unmapped-'))
    .flatMap(provider => (
      (provider.models || [])
        .filter(model => model.trim())
        .map(model => ({
          providerId: provider.id,
          model,
          source: provider.source,
        }))
    ))
    .sort((a, b) => {
      if (a.source === 'user' && b.source !== 'user') return -1;
      if (b.source === 'user' && a.source !== 'user') return 1;
      const weightDiff = titleModelWeight(a.model) - titleModelWeight(b.model);
      if (weightDiff !== 0) return weightDiff;
      const providerDiff = a.providerId.localeCompare(b.providerId);
      if (providerDiff !== 0) return providerDiff;
      return a.model.localeCompare(b.model);
    });
}

