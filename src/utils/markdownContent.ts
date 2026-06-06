const completeCliCommandGroupPattern = /<details open data-cli-command-group="([a-z0-9_-]+)">([\s\S]*?)<\/details>/gi;
const executionProcessSummaryPattern = /^\s*<summary>\s*⚙️\s*执行过程\s*<\/summary>/i;
const nestedDetailsPattern = /<details\b[\s\S]*?<\/details>/gi;
const fencedCodeBlockPattern = /```[\s\S]*?```/g;
const inlineCodePattern = /`([^`\n]+)`/g;

const IMAGE_EXTENSIONS = '(?:png|jpe?g|gif|webp|svg|bmp|ico|avif)';
const markdownImagePattern = new RegExp(
  String.raw`!\[([^\]]*)\]\(\s*([^)\s]+)\s*\)`,
  'g',
);
const htmlImgPattern = /<img\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi;
// 裸的 http(s)/data/blob/asset/tauri URL：遮蔽整段，防止裸路径扫描进入 URL 内部
const plainUrlPattern = /\b(?:https?|data|blob|asset|tauri):\/\/[^\s<>"'`)]+/gi;
// 绝对路径 + 图片扩展名（裸 /Windows 盘符 / file:// 协议）。用占位符先把 URL 类语法遮蔽后再扫
const localImagePathSource = String.raw`(?:(?<![A-Za-z])[A-Za-z]:[\\/]|file:\/\/|\/)[^\s<>"'${'`'}]*?\.${IMAGE_EXTENSIONS}(?:\?[^)\s<>"'${'`'}]*|#[^)\s<>"'${'`'}]*)?`;
const localImagePathPattern = new RegExp(localImagePathSource, 'gi');
const quotedLocalImagePathPattern = new RegExp(String.raw`(["'])(${localImagePathSource})\1`, 'gi');
const standaloneLocalImagePathPattern = new RegExp(String.raw`^${localImagePathSource}$`, 'i');

function isAlreadyResolvableImageUrl(url: string): boolean {
  const trimmed = url.trim();
  return /^(?:https?:|data:|blob:|asset:|tauri:)/i.test(trimmed);
}

function stripImageUrlQuotes(url: string): string {
  const trimmed = url.trim();
  const first = trimmed[0];
  const last = trimmed.at(-1);
  if ((first === '"' || first === "'") && first === last) return trimmed.slice(1, -1);
  return trimmed;
}

function convertLocalImageUrl(url: string, resolver: (path: string) => string): string {
  const unquoted = stripImageUrlQuotes(url);
  if (isAlreadyResolvableImageUrl(unquoted)) return unquoted;
  const rawPath = unquoted.replace(/^file:\/\//i, '');
  return resolver(rawPath);
}

const CODE_BLOCK_PLACEHOLDER = '\u0000CODE_';
const CLI_DETAILS_PLACEHOLDER = '\u0000CLIDETAILS_';
const URL_PLACEHOLDER = '\u0000URL_';
const MDIMG_PLACEHOLDER = '\u0000MDIMG_';
const HTMLIMG_PLACEHOLDER = '\u0000HTMLIMG_';
const QUOTEDIMG_PLACEHOLDER = '\u0000QUOTEDIMG_';

/**
 * 把 content 中匹配 pattern 的整段替换为 prefix + n + \u0000 占位符（占位符内不含任何 URL），
 * 同时保存每段的「重建后内容」（apply transformInner 后）。后续可由 unmaskSyntax 还原。
 * 这样裸路径扫描阶段看不到 URL，避免对 http(s)://x.com/img.png 这类 URL 的 path 段误伤。
 */
function maskAndRebuild(
  content: string,
  pattern: RegExp,
  prefix: string,
  extractInner: (match: string, groups: string[]) => string,
  transformInner: (inner: string) => string,
): { masked: string; rebuilt: string[] } {
  const rebuilt: string[] = [];
  const masked = content.replace(pattern, (match: string, ...args: unknown[]) => {
    const groups = args.slice(0, -2).map((g) => String(g ?? ''));
    const inner = extractInner(match, groups);
    const transformed = transformInner(inner);
    const rebuiltMatch = transformed === inner ? match : match.replace(inner, transformed);
    rebuilt.push(rebuiltMatch);
    return `${prefix}${rebuilt.length - 1}\u0000`;
  });
  return { masked, rebuilt };
}

function unmaskSyntax(content: string, prefix: string, rebuilt: string[]): string {
  const re = new RegExp(prefix.replace(/\u0000/g, '\\u0000') + '(\\d+)\\u0000', 'g');
  return content.replace(re, (_full, idxStr: string) => {
    return rebuilt[Number(idxStr)] ?? '';
  });
}

function toMarkdownImage(path: string, resolveFileUrl: (absolutePath: string) => string): string {
  const rawPath = path.replace(/^file:\/\//i, '');
  return `![](${resolveFileUrl(rawPath)})`;
}

function standaloneLocalImagePath(input: string): string | null {
  const trimmed = input.trim();
  return standaloneLocalImagePathPattern.test(trimmed) ? trimmed : null;
}

function maskCliCommandDetails(content: string): { masked: string; rebuilt: string[] } {
  const rebuilt: string[] = [];
  let result = '';
  let cursor = 0;
  let match: RegExpExecArray | null;
  const detailsTagPattern = createDetailsTagPattern();

  while ((match = detailsTagPattern.exec(content)) !== null) {
    const tag = match[0];
    const tagStart = match.index;
    const tagEnd = detailsTagPattern.lastIndex;
    if (/^<\s*\/\s*details\b/i.test(tag)) continue;
    if (!/\bdata-cli-command-group\s*=/i.test(tag)) continue;

    const closeEnd = findMatchingDetailsClose(content, tagEnd);
    if (closeEnd === -1) {
      detailsTagPattern.lastIndex = tagEnd;
      continue;
    }

    result += content.slice(cursor, tagStart);
    rebuilt.push(content.slice(tagStart, closeEnd));
    result += `${CLI_DETAILS_PLACEHOLDER}${rebuilt.length - 1}\u0000`;
    cursor = closeEnd;
    detailsTagPattern.lastIndex = closeEnd;
  }

  return { masked: result + content.slice(cursor), rebuilt };
}

/**
 * 将聊天内容中的本地绝对图片路径转成 Tauri asset:// URL，包裹为 markdown 图片语法。
 * 跳过：CLI 执行详情、围栏代码块、命令型内联代码、markdown 链接语法、
 * 已经是 http(s)/data/blob/asset/tauri 的 URL；纯图片路径内联代码会渲染。
 */
export function transformLocalImagePaths(
  content: string,
  resolveFileUrl: (absolutePath: string) => string,
): string {
  if (!content) return content;

  // Phase 0: 遮蔽 CLI 执行过程，里面的路径是日志文本，不参与图片渲染
  const cliDetailsMasked = maskCliCommandDetails(content);
  let masked = cliDetailsMasked.masked;

  // Phase 1: 遮蔽围栏代码块
  const codeRebuilt: string[] = [];
  masked = masked.replace(fencedCodeBlockPattern, (block) => {
    codeRebuilt.push(block);
    return `${CODE_BLOCK_PLACEHOLDER}${codeRebuilt.length - 1}\u0000`;
  });

  // Phase 1b: 行内代码只有在内容本身就是图片路径时渲染；命令示例继续保留为代码
  masked = masked.replace(inlineCodePattern, (match, inner: string) => {
    const imagePath = standaloneLocalImagePath(inner);
    if (imagePath) {
      codeRebuilt.push(match);
      const codePlaceholder = `${CODE_BLOCK_PLACEHOLDER}${codeRebuilt.length - 1}\u0000`;
      return `${codePlaceholder}\n\n${toMarkdownImage(imagePath, resolveFileUrl)}`;
    }
    codeRebuilt.push(match);
    return `${CODE_BLOCK_PLACEHOLDER}${codeRebuilt.length - 1}\u0000`;
  });

  // Phase 2: 先遮蔽 markdown 图片 `![]()` 并转换其 URL（这一步把 image 里的 URL 锁进占位符）
  const mdImgMasked = maskAndRebuild(
    masked,
    markdownImagePattern,
    MDIMG_PLACEHOLDER,
    (_match, groups) => groups[1] ?? '',
    (url) => convertLocalImageUrl(url, resolveFileUrl),
  );
  masked = mdImgMasked.masked;

  // Phase 3: 遮蔽 <img src="..."> 并转换其 URL
  const htmlImgMasked = maskAndRebuild(
    masked,
    htmlImgPattern,
    HTMLIMG_PLACEHOLDER,
    (match) => {
      const dq = match.match(/\bsrc\s*=\s*"([^"]*)"/i)?.[1];
      const sq = match.match(/\bsrc\s*=\s*'([^']*)'/i)?.[1];
      return dq !== undefined ? dq : (sq ?? '');
    },
    (url) => convertLocalImageUrl(url, resolveFileUrl),
  );
  masked = htmlImgMasked.masked;

  // Phase 4: 现在遮蔽裸 URL（http(s)/data/blob/asset/tauri）—— image 里的 URL 已在占位符里，不冲突
  const urlMasked = maskAndRebuild(
    masked,
    plainUrlPattern,
    URL_PLACEHOLDER,
    (match) => match,
    (url) => convertLocalImageUrl(url, resolveFileUrl),
  );
  masked = urlMasked.masked;

  // Phase 5: 扫描带引号的独立图片路径，再扫描裸绝对路径（保留原始路径文本 + 追加渲染图片）
  const quotedImageRebuilt: string[] = [];
  masked = masked.replace(quotedLocalImagePathPattern, (match, _quote: string, path: string) => {
    quotedImageRebuilt.push(`${match}\n\n${toMarkdownImage(path, resolveFileUrl)}`);
    return `${QUOTEDIMG_PLACEHOLDER}${quotedImageRebuilt.length - 1}\u0000`;
  });
  const transformed = masked.replace(localImagePathPattern, (match) => `\`${match}\`\n\n${toMarkdownImage(match, resolveFileUrl)}`);

  // Phase 6: 还原占位符（顺序无关，因为各 prefix 互不冲突）
  let out = unmaskSyntax(transformed, HTMLIMG_PLACEHOLDER, htmlImgMasked.rebuilt);
  out = unmaskSyntax(out, QUOTEDIMG_PLACEHOLDER, quotedImageRebuilt);
  out = unmaskSyntax(out, MDIMG_PLACEHOLDER, mdImgMasked.rebuilt);
  out = unmaskSyntax(out, URL_PLACEHOLDER, urlMasked.rebuilt);
  out = unmaskSyntax(out, CODE_BLOCK_PLACEHOLDER, codeRebuilt);
  return unmaskSyntax(out, CLI_DETAILS_PLACEHOLDER, cliDetailsMasked.rebuilt);
}

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
