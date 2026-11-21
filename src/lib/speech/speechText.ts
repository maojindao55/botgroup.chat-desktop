/** 把伙伴回复整理成适合朗读的纯文本：去掉 Markdown 符号、链接和表情 */
export function toSpeakableText(text: string): string {
  return (text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_`#>|~]+/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\p{Extended_Pictographic}\uFE0F?/gu, '')
    .replace(/[ \t\u3000]+/g, ' ')
    .replace(/\s*\n+\s*/g, '。')
    .replace(/。{2,}/g, '。')
    .trim();
}
