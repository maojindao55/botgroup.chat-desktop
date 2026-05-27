import type { AIMember, AIMemberKind } from '@/config/aiMembers';

/** 若用户已基于某官方资源定制，则隐藏对应官方项，列表里只保留一份 */
export function getVisibleMembers(
  members: Record<string, AIMember>,
  kind?: AIMemberKind,
  searchQuery?: string,
): AIMember[] {
  let list = Object.values(members);
  if (kind) {
    list = list.filter((m) => m.kind === kind);
  }

  const replacedBuiltins = new Set(
    list
      .filter((m) => m.source === 'user' && m.forkedFrom)
      .map((m) => m.forkedFrom as string),
  );

  list = list.filter((m) => !(m.source === 'builtin' && replacedBuiltins.has(m.id)));

  const q = searchQuery?.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q) ||
        m.tags?.some((t) => t.toLowerCase().includes(q)),
    );
  }

  return list.sort((a, b) => {
    const rank = (m: AIMember) => {
      if (m.source === 'user' && m.forkedFrom) return 0;
      if (m.source === 'builtin') return 1;
      return 2;
    };
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

/** 新建群/选成员时可用的资源（角色、专家不含官方预设） */
export function getPickableMembers(
  members: Record<string, AIMember>,
  kind: AIMemberKind,
): AIMember[] {
  const list = getVisibleMembers(members, kind);
  if (kind === 'llm' || kind === 'agent') {
    return list.filter((m) => m.source !== 'builtin');
  }
  return list;
}

export function findPersonalCopy(
  members: Record<string, AIMember>,
  templateId: string,
): AIMember | undefined {
  return Object.values(members).find(
    (m) => m.source === 'user' && m.forkedFrom === templateId,
  );
}

/** 按 id 取成员：若存在基于该 id 的定制副本，则返回副本（模板/群聊仍引用官方 id 时也能同步展示与执行） */
export function resolveEffectiveMember(
  members: Record<string, AIMember>,
  memberId: string,
): AIMember | undefined {
  const direct = members[memberId];
  if (direct?.source === 'user') return direct;
  const fork = findPersonalCopy(members, memberId);
  return fork ?? direct;
}

export function resolveEffectiveMembers(
  members: Record<string, AIMember>,
  memberIds: string[],
): AIMember[] {
  return memberIds
    .map((id) => resolveEffectiveMember(members, id))
    .filter((m): m is AIMember => !!m);
}
