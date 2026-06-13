export function buildCliUserPrompt(promptText: string, workspacePath: string): string {
  const task = promptText.trim();
  const workspace = workspacePath.trim();

  if (!workspace) return task;

  return [
    `工作目录：${workspace}`,
    '执行约束：只在上述工作目录内理解、读取和修改项目文件；不要根据群聊历史切换到其他仓库或本应用源码目录。',
    '',
    `用户需求：${task}`,
  ].join('\n');
}
