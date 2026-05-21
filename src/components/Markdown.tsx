/**
 * ChatMarkdown - 聊天气泡内 Markdown 渲染统一组件
 *
 * 基于 @lobehub/ui 的 <Markdown>，内置 remark-gfm / remark-math /
 * rehype-katex 与 shiki 语法高亮；同时通过 allowHtml 保留 <details>
 * <summary> 执行过程折叠块的原生渲染能力。
 *
 * 调用方约束：保持 props 形态为 { content, isUser, className }。
 */
import { Markdown as LobeMarkdown } from '@lobehub/ui';
import type { CSSProperties } from 'react';

export interface ChatMarkdownProps {
  content: string;
  isUser?: boolean;
  className?: string;
}

export function ChatMarkdown({ content, isUser, className }: ChatMarkdownProps) {
  const style: CSSProperties | undefined = isUser
    ? { color: '#fff' }
    : undefined;

  return (
    <LobeMarkdown
      allowHtml
      enableImageGallery
      enableLatex
      enableMermaid
      fontSize={14}
      variant="chat"
      className={className}
      style={style}
    >
      {content}
    </LobeMarkdown>
  );
}

export default ChatMarkdown;
