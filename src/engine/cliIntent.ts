const CHANGE_INTENT_PATTERNS = [
  /帮我写/,
  /写一个/,
  /写个/,
  /创建/,
  /新建/,
  /生成.*文件/,
  /实现/,
  /修改/,
  /修复/,
  /改一下/,
  /添加/,
  /删除/,
  /重构/,
  /\b(write|create|generate|implement|modify|fix|add|delete|refactor)\b/i,
];

const READ_ONLY_PATTERNS = [
  /不要修改/,
  /不改文件/,
  /只分析/,
  /讨论/,
  /分析/,
  /\b(read[- ]?only|discuss|analy[sz]e|review only)\b/i,
];

export function isCodeChangeIntent(prompt: string): boolean {
  const normalized = prompt.trim();
  if (!normalized) return false;

  const hasChangeIntent = CHANGE_INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
  if (!hasChangeIntent) return false;

  const hasReadOnlyIntent = READ_ONLY_PATTERNS.some((pattern) => pattern.test(normalized));
  return !hasReadOnlyIntent;
}
