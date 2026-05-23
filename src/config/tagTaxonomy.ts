export const SYSTEM_TAGS = {
  用途: ['聊天', '信息总结', '新闻报道', '广告文案', '需求分析', '产品设计'],
  能力: ['编码', '调试', '重构', '深度推理', '数学', '分析数据', '系统设计', '编程', '技术评审', '协作'],
  风格: ['娱乐', '文字游戏', '学生', '协作'],
} as const;

export const TAG_SYNONYMS: Record<string, string> = {
  对话: '聊天',
  编程: '编码',
  分析: '分析数据',
  总结: '信息总结',
  推理: '深度推理',
  游戏: '文字游戏',
  微信聊天: '聊天',
};

/** 同义词合并 + 去重，保持首次出现顺序 */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const canonical = TAG_SYNONYMS[trimmed] ?? trimmed;
    if (!seen.has(canonical)) {
      seen.add(canonical);
      result.push(canonical);
    }
  }
  return result;
}

export const ALL_SYSTEM_TAGS: string[] = Object.values(SYSTEM_TAGS).flat();
