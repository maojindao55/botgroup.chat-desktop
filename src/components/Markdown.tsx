/**
 * ChatMarkdown - 聊天气泡内的 Markdown 渲染（儿童版）
 *
 * 基于 @lobehub/ui 的 <Markdown>，关闭 HTML、公式和 Mermaid；内容先经过
 * toKidFriendlyMarkdown 清洗，只保留文字排版、表情和网络图片。
 */
import { Markdown as LobeMarkdown } from '@lobehub/ui';
import { Image as AntdImage } from 'antd';
import { memo } from 'react';
import type { CSSProperties, ImgHTMLAttributes } from 'react';
import { toKidFriendlyMarkdown } from '@/utils/markdownContent';

export interface ChatMarkdownProps {
  content: string;
  isUser?: boolean;
  className?: string;
  fontSize?: number;
}

type MarkdownImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  node?: unknown;
};

const markdownImageStyle: CSSProperties = {
  borderRadius: 12,
  display: 'block',
  height: 'auto',
  marginBlock: '0.6em',
  maxHeight: 'min(60vh, 420px)',
  maxWidth: '100%',
  objectFit: 'contain',
  width: 'auto',
};

function ChatMarkdownImage({ node: _node, src, alt, style }: MarkdownImageProps) {
  if (typeof src !== 'string' || !src) return null;
  return (
    <AntdImage
      alt={typeof alt === 'string' ? alt : 'image'}
      src={src}
      style={{ ...markdownImageStyle, ...style }}
      preview={{ mask: false }}
    />
  );
}

const chatMarkdownComponents = {
  img: ChatMarkdownImage,
};

export const ChatMarkdown = memo(function ChatMarkdown({ content, isUser, className, fontSize = 14 }: ChatMarkdownProps) {
  const style: CSSProperties | undefined = isUser ? { color: '#fff' } : undefined;
  return (
    <LobeMarkdown
      allowHtml={false}
      enableImageGallery={false}
      enableLatex={false}
      enableMermaid={false}
      fontSize={fontSize}
      variant="chat"
      className={className}
      components={chatMarkdownComponents}
      style={style}
    >
      {toKidFriendlyMarkdown(content)}
    </LobeMarkdown>
  );
});

export default ChatMarkdown;
