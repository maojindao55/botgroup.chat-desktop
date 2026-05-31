export interface MentionCandidate {
  id: string;
  name: string;
  avatar?: string;
}

export interface ActiveMention {
  start: number;
  end: number;
  query: string;
}

export interface AppliedMention {
  value: string;
  caret: number;
}

export function getActiveMention(value: string, caret: number): ActiveMention | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  const beforeCaret = value.slice(0, safeCaret);
  const match = /(^|\s)@([^\s@]*)$/.exec(beforeCaret);
  if (!match) return null;

  const mentionText = `@${match[2] ?? ''}`;
  return {
    start: beforeCaret.length - mentionText.length,
    end: safeCaret,
    query: match[2] ?? '',
  };
}

export function filterMentionCandidates(
  candidates: MentionCandidate[],
  query: string,
  limit = 8,
): MentionCandidate[] {
  const normalizedQuery = query.trim().toLowerCase();
  const seen = new Set<string>();
  const filtered: MentionCandidate[] = [];

  for (const candidate of candidates) {
    if (!candidate?.id || !candidate?.name || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    const haystack = `${candidate.name}\n${candidate.id}`.toLowerCase();
    if (normalizedQuery && !haystack.includes(normalizedQuery)) continue;
    filtered.push(candidate);
    if (filtered.length >= limit) break;
  }

  return filtered;
}

export function applyMention(
  value: string,
  activeMention: ActiveMention,
  candidate: MentionCandidate,
): AppliedMention {
  const mention = `@${candidate.name} `;
  const suffixStart = value[activeMention.end] === ' ' ? activeMention.end + 1 : activeMention.end;
  const nextValue = `${value.slice(0, activeMention.start)}${mention}${value.slice(suffixStart)}`;
  return {
    value: nextValue,
    caret: activeMention.start + mention.length,
  };
}
