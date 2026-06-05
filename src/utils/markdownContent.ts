const completeCliCommandGroupPattern = /<details open data-cli-command-group="([a-z0-9_-]+)">([\s\S]*?)<\/details>/gi;
const executionProcessSummaryPattern = /^\s*<summary>\s*⚙️\s*执行过程\s*<\/summary>/i;
const nestedDetailsPattern = /<details\b[\s\S]*?<\/details>/gi;

export function normalizeChatMarkdownContent(content: string): string {
  const commandGroupsNormalized = content.replace(
    completeCliCommandGroupPattern,
    '<details data-cli-command-group="$1">$2</details>'
  );
  return unwrapLegacyExecutionProcessDetails(commandGroupsNormalized);
}

function unwrapLegacyExecutionProcessDetails(content: string): string {
  let result = '';
  let cursor = 0;
  let match: RegExpExecArray | null;
  const detailsTagPattern = createDetailsTagPattern();

  while ((match = detailsTagPattern.exec(content)) !== null) {
    const tag = match[0];
    const tagStart = match.index;
    const tagEnd = detailsTagPattern.lastIndex;
    if (/^<\s*\/\s*details\b/i.test(tag)) continue;

    const closeEnd = findMatchingDetailsClose(content, tagEnd);
    if (closeEnd === -1) {
      detailsTagPattern.lastIndex = tagEnd;
      continue;
    }

    const inner = content.slice(tagEnd, closeEnd - '</details>'.length);
    const summaryMatch = inner.match(executionProcessSummaryPattern);
    if (!summaryMatch || !looksLikeLegacyWrappedReply(inner.slice(summaryMatch[0].length))) {
      detailsTagPattern.lastIndex = tagEnd;
      continue;
    }

    result += content.slice(cursor, tagStart);
    result += cleanupLegacyExecutionProcessBody(inner.slice(summaryMatch[0].length));
    result += '\n\n';
    cursor = closeEnd;
    detailsTagPattern.lastIndex = closeEnd;
  }

  return result + content.slice(cursor);
}

function findMatchingDetailsClose(content: string, startIndex: number): number {
  let depth = 1;
  let match: RegExpExecArray | null;
  const detailsTagPattern = createDetailsTagPattern();

  detailsTagPattern.lastIndex = startIndex;
  while ((match = detailsTagPattern.exec(content)) !== null) {
    const tag = match[0];
    if (/^<\s*\/\s*details\b/i.test(tag)) {
      depth -= 1;
      if (depth === 0) return detailsTagPattern.lastIndex;
    } else {
      depth += 1;
    }
  }

  return -1;
}

function createDetailsTagPattern(): RegExp {
  return /<\s*\/?\s*details\b[^>]*>/gi;
}

function looksLikeLegacyWrappedReply(body: string): boolean {
  const visibleText = body
    .replace(nestedDetailsPattern, '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('> 📝'))
    .join('\n')
    .trim();

  return visibleText.length > 0;
}

function cleanupLegacyExecutionProcessBody(body: string): string {
  return body
    .split('\n')
    .filter(line => !line.trim().startsWith('> 📝'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '');
}
