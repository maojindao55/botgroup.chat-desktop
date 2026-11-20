/**
 * 儿童聊天气泡的内容清洗：只保留文字、表情、列表、粗体等基础排版和网络图片。
 * 代码块、公式、Mermaid、HTML 标签和链接都去掉（链接只留文字），避免孩子看到看不懂或会跳走的内容。
 */

const IMAGE_PLACEHOLDER = '\u0000IMG_';
const markdownImagePattern = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
const safeImageUrlPattern = /^(?:https?:\/\/|data:image\/)/i;
const mermaidBlockPattern = /```\s*mermaid\b[\s\S]*?```/gi;
const fencedCodeBlockPattern = /```[^\n]*\n?([\s\S]*?)```/g;
const inlineCodePattern = /`([^`\n]+)`/g;
const blockMathPattern = /\$\$([\s\S]+?)\$\$/g;
const inlineMathPattern = /\\\(([\s\S]+?)\\\)|\$([^$\n]+)\$/g;
const htmlTagPattern = /<\/?[A-Za-z][^<>]*>/g;
const markdownLinkPattern = /\[([^\]]*)\]\(([^)]*)\)/g;
const bareUrlPattern = /\b(?:https?:\/\/|www\.)[^\s<>"'）)]+/gi;

export function toKidFriendlyMarkdown(content: string): string {
  if (!content) return '';

  const images: string[] = [];
  let out = content.replace(markdownImagePattern, (_match, alt: string, rawUrl: string) => {
    const url = rawUrl.replace(/^<|>$/g, '');
    if (!safeImageUrlPattern.test(url)) return alt || '';
    images.push(`![${alt}](${url})`);
    return `${IMAGE_PLACEHOLDER}${images.length - 1}\u0000`;
  });

  out = out
    .replace(mermaidBlockPattern, '')
    .replace(fencedCodeBlockPattern, (_match, inner: string) => inner.trim())
    .replace(inlineCodePattern, '$1')
    .replace(blockMathPattern, (_match, inner: string) => inner.trim())
    .replace(inlineMathPattern, (_match, paren: string | undefined, dollar: string | undefined) => (paren ?? dollar ?? '').trim())
    .replace(htmlTagPattern, '')
    .replace(markdownLinkPattern, '$1')
    .replace(bareUrlPattern, '');

  out = out.replace(/\u0000IMG_(\d+)\u0000/g, (_match, index: string) => images[Number(index)] ?? '');
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
