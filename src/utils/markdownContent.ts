const completeCodexCommandGroupPattern = /<details open data-cli-command-group="codex">([\s\S]*?)<\/details>/g;

export function normalizeChatMarkdownContent(content: string): string {
  return content.replace(
    completeCodexCommandGroupPattern,
    '<details data-cli-command-group="codex">$1</details>'
  );
}
