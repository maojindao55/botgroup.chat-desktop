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
import { Image as AntdImage, Space, message as antdMessage } from 'antd';
import { Download } from 'lucide-react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { CSSProperties, ImgHTMLAttributes, ReactNode } from 'react';
import {
  normalizeChatMarkdownContent,
  transformLocalImagePaths,
} from '@/utils/markdownContent';

export interface ChatMarkdownProps {
  content: string;
  isUser?: boolean;
  className?: string;
  basePath?: string;
}

type MarkdownImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  node?: unknown;
};

const tauriLocalImageSrcPattern = /^(?:asset:|tauri:|https?:\/\/(?:asset|tauri)\.localhost(?:[:/]|$))/i;
const rawLocalImageSrcPattern = /^(?:file:\/\/|\/|[A-Za-z]:[\\/]).+\.(?:png|jpe?g|gif|webp|svg|bmp|ico|avif)(?:[?#].*)?$/i;

const localMarkdownImageStyle: CSSProperties = {
  borderRadius: 8,
  display: 'block',
  height: 'auto',
  marginBlock: '1em',
  maxHeight: 'min(70vh, 520px)',
  maxWidth: '100%',
  objectFit: 'contain',
  width: 'auto',
};

function hasTauriConvertFileSrc(): boolean {
  return typeof window !== 'undefined'
    && typeof (window as typeof window & {
      __TAURI_INTERNALS__?: { convertFileSrc?: unknown };
    }).__TAURI_INTERNALS__?.convertFileSrc === 'function';
}

function isRunningInTauri(): boolean {
  return typeof globalThis !== 'undefined'
    && Boolean((globalThis as typeof globalThis & { isTauri?: boolean }).isTauri || hasTauriConvertFileSrc());
}

function fallbackAssetSrc(path: string): string {
  return `asset://localhost/${encodeURIComponent(path)}`;
}

function isResolvableUrl(path: string): boolean {
  return /^(?:https?:|data:|blob:|asset:|tauri:)/i.test(path);
}

function isAbsolutePath(path: string): boolean {
  return /^(?:\/|[A-Za-z]:[\\/]|file:\/\/)/.test(path);
}

function splitPathSuffix(path: string): [string, string] {
  const queryIndex = path.indexOf('?');
  const hashIndex = path.indexOf('#');
  const suffixIndex = [queryIndex, hashIndex].filter((idx) => idx >= 0).sort((a, b) => a - b)[0];
  if (suffixIndex === undefined) return [path, ''];
  return [path.slice(0, suffixIndex), path.slice(suffixIndex)];
}

function normalizePosixPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

function resolveImagePath(path: string, basePath?: string): string {
  const unquotedPath = stripImageSrcQuotes(path);
  if (isResolvableUrl(unquotedPath)) return unquotedPath;
  const withoutFileProtocol = unquotedPath.replace(/^file:\/\//i, '');
  if (isAbsolutePath(withoutFileProtocol)) return withoutFileProtocol;

  const base = basePath?.trim();
  if (!base || !isAbsolutePath(base)) return withoutFileProtocol;

  const [pathname, suffix] = splitPathSuffix(withoutFileProtocol);
  const cleanPathname = pathname.replace(/^[.][\\/]/, '').replace(/\\/g, '/');
  const cleanBase = base.replace(/^file:\/\//i, '').replace(/\\/g, '/').replace(/\/+$/, '');
  return `${normalizePosixPath(`${cleanBase}/${cleanPathname}`)}${suffix}`;
}

function normalizeRawLocalImageSrc(src: string): string {
  return src.replace(/^file:\/\//i, '');
}

function stripImageSrcQuotes(src: string): string {
  const trimmed = src.trim();
  const first = trimmed[0];
  const last = trimmed.at(-1);
  if ((first === '"' || first === "'") && first === last) return trimmed.slice(1, -1);
  return trimmed;
}

function resolveMarkdownImageSrc(src: unknown): string | null {
  if (typeof src !== 'string') return null;
  const unquotedSrc = stripImageSrcQuotes(src);
  if (tauriLocalImageSrcPattern.test(unquotedSrc)) return unquotedSrc;
  if (!rawLocalImageSrcPattern.test(unquotedSrc)) return null;

  const rawPath = normalizeRawLocalImageSrc(unquotedSrc);
  if (hasTauriConvertFileSrc()) return convertFileSrc(rawPath);
  return isRunningInTauri() ? fallbackAssetSrc(rawPath) : unquotedSrc;
}

function extractLocalPathFromAssetUrl(url: string): string | null {
  // 支持：https://asset.localhost/<encoded>、http://asset.localhost/<encoded>、asset://localhost/<encoded>
  const m = url.match(/^(?:https?:\/\/asset\.localhost|asset:\/\/localhost)\/(.+)$/i);
  if (!m) return null;
  try {
    const decoded = decodeURIComponent(m[1]);
    return decoded.startsWith('/') || /^[A-Za-z]:[\\/]/.test(decoded) ? decoded : `/${decoded}`;
  } catch { return null; }
}

async function downloadImage(url: string, fallbackName: string): Promise<void> {
  const localPath = extractLocalPathFromAssetUrl(url);
  if (localPath) {
    try {
      const saved = await invoke<string | null>('save_image_as', { sourcePath: localPath });
      if (saved) antdMessage.success('已保存');
    } catch (err) {
      antdMessage.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  // 远程 URL 兜底：fetch → blob → anchor download
  const filename = (() => {
    try {
      const u = new URL(url);
      const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
      return last || fallbackName;
    } catch { return fallbackName; }
  })();
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
  } catch (err) {
    antdMessage.error(`下载失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

function ChatMarkdownImage({ node: _node, src, alt, style, loading: _loading, ...props }: MarkdownImageProps) {
  const safeAlt = typeof alt === 'string' ? alt : 'image';
  const resolvedSrc = resolveMarkdownImageSrc(src);
  const imageSrc = resolvedSrc ?? (typeof src === 'string' ? stripImageSrcQuotes(src) : undefined);

  return (
    <AntdImage
      {...(props as Record<string, unknown>)}
      alt={safeAlt}
      data-original-src={src === imageSrc ? undefined : src}
      data-local-cli-image={resolvedSrc ? 'true' : undefined}
      src={imageSrc}
      style={{ ...localMarkdownImageStyle, ...style, cursor: 'zoom-in' }}
      preview={{
        mask: false,
        toolbarRender: (originalNode: ReactNode) => (
          <Space
            size={12}
            align="center"
            style={{
              background: 'rgba(0, 0, 0, 0.65)',
              borderRadius: 100,
              padding: '0 18px',
              height: 44,
              color: '#fff',
            }}
          >
            {originalNode}
            <Download
              size={18}
              style={{ cursor: 'pointer', color: '#fff', display: 'block' }}
              onClick={() => imageSrc && downloadImage(imageSrc, safeAlt || 'image')}
              aria-label="download"
            />
          </Space>
        ),
      }}
    />
  );
}

const chatMarkdownComponents = {
  img: ChatMarkdownImage,
};

const chatMarkdownReactProps = {
  urlTransform: (url: string) => url,
};

export function ChatMarkdown({ content, isUser, className, basePath }: ChatMarkdownProps) {
  const style: CSSProperties | undefined = isUser
    ? { color: '#fff' }
    : undefined;
  const normalizedContent = normalizeChatMarkdownContent(content);
  // 桌面端（Tauri 注入）才把本地绝对路径转成 asset://，Web 端不处理
  const withLocalImages = hasTauriConvertFileSrc()
    ? transformLocalImagePaths(normalizedContent, (path) => convertFileSrc(resolveImagePath(path, basePath)))
    : normalizedContent;

  return (
    <LobeMarkdown
      allowHtml
      enableImageGallery={false}
      enableLatex
      enableMermaid
      fontSize={14}
      variant="chat"
      className={className}
      components={chatMarkdownComponents}
      reactMarkdownProps={chatMarkdownReactProps}
      style={style}
    >
      {withLocalImages}
    </LobeMarkdown>
  );
}

export default ChatMarkdown;
