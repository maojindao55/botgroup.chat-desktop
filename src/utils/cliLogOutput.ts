import { cleanCliOutputLine, shouldSuppressCliOutputLine } from './cliOutput';

export interface CliLogEntryLike {
  type?: string;
  content?: string;
}

export function reconstructCliOutputFromLogEntries(
  entries: CliLogEntryLike[],
  options: { includeStderr?: boolean } = {},
): string {
  const lines: string[] = [];

  for (const entry of entries) {
    if (typeof entry.content !== 'string') continue;
    if (entry.type !== 'stdout' && !(options.includeStderr && entry.type === 'stderr')) continue;

    const line = cleanCliOutputLine(entry.content);
    if (shouldSuppressCliOutputLine(line)) continue;
    if (entry.type === 'stderr') {
      lines.push(`> _${line.replace(/_/g, '\\_')}_`);
    } else {
      lines.push(line);
    }
  }

  return lines.join('\n').trim();
}
