const completeCliCommandGroupPattern = /<details open data-cli-command-group="(codex|claude)">([\s\S]*?)<\/details>/g;

export function normalizeChatMarkdownContent(content: string): string {
  return content.replace(
    completeCliCommandGroupPattern,
    '<details data-cli-command-group="$1">$2</details>'
  );
}
