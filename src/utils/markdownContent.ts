const completeCliCommandGroupPattern = /<details open data-cli-command-group="([a-z0-9_-]+)">([\s\S]*?)<\/details>/gi;

export function normalizeChatMarkdownContent(content: string): string {
  return content.replace(
    completeCliCommandGroupPattern,
    '<details data-cli-command-group="$1">$2</details>'
  );
}
