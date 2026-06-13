import { Image, Tooltip } from 'antd';
import { FileText, Image as ImageIcon, X } from 'lucide-react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { createStyles } from 'antd-style';
import { useEffect, useState } from 'react';
import type { ChatAttachment } from '@/config/chatSessions';
import { formatBytes, resolveAttachmentPreviewSrc } from '@/utils/chatAttachments';

const useStyles = createStyles(({ token, css }) => ({
  list: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  `,
  pendingList: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    width: 100%;
    max-width: 900px;
    margin: 0 auto 8px;
  `,
  item: css`
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: min(360px, 100%);
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 7px;
    background: ${token.colorFillQuaternary};
    padding: 6px 8px;
    color: ${token.colorText};
  `,
  thumbnail: css`
    width: 44px;
    height: 44px;
    border-radius: 6px;
    object-fit: cover;
    background: ${token.colorFillSecondary};
    flex: none;
  `,
  icon: css`
    width: 32px;
    height: 32px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: ${token.colorFillSecondary};
    color: ${token.colorTextSecondary};
    flex: none;
  `,
  meta: css`
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  `,
  name: css`
    font-size: 12px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  sub: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  unavailable: css`
    color: ${token.colorError};
  `,
  removeButton: css`
    border: 0;
    background: transparent;
    color: ${token.colorTextTertiary};
    cursor: pointer;
    padding: 2px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    &:hover {
      background: ${token.colorFillSecondary};
      color: ${token.colorText};
    }
  `,
}));

interface ChatAttachmentListProps {
  attachments?: ChatAttachment[];
  pending?: boolean;
  onRemove?: (id: string) => void;
  unavailableLabel?: string;
}

const EMPTY_ATTACHMENTS: ChatAttachment[] = [];

function attachmentSubtitle(attachment: ChatAttachment): string {
  const parts = [
    attachment.mimeType || attachment.extension || attachment.kind,
    typeof attachment.size === 'number' ? formatBytes(attachment.size) : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

export function ChatAttachmentList({
  attachments = EMPTY_ATTACHMENTS,
  pending = false,
  onRemove,
  unavailableLabel = 'Unavailable',
}: ChatAttachmentListProps) {
  const { styles } = useStyles();
  const [availability, setAvailability] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (pending || attachments.length === 0) {
      return;
    }

    let cancelled = false;
    setAvailability({});

    Promise.all(
      attachments.map(async attachment => {
        try {
          const exists = await invoke<boolean>('chat_attachment_exists', { path: attachment.path });
          return [attachment.id, exists] as const;
        } catch {
          return [attachment.id, false] as const;
        }
      }),
    ).then(entries => {
      if (!cancelled) setAvailability(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [attachments, pending]);

  if (attachments.length === 0) return null;

  return (
    <div className={pending ? styles.pendingList : styles.list}>
      {attachments.map(attachment => {
        const isUnavailable = availability[attachment.id] === false;
        const previewSrc = isUnavailable ? null : resolveAttachmentPreviewSrc(attachment, convertFileSrc);

        return (
          <div key={attachment.id} className={styles.item}>
            {previewSrc ? (
              <Image
                src={previewSrc}
                alt={attachment.name}
                className={styles.thumbnail}
                preview={{ src: previewSrc }}
                fallback=""
              />
            ) : (
              <span className={styles.icon}>
                {attachment.kind === 'image' ? <ImageIcon size={16} /> : <FileText size={16} />}
              </span>
            )}

            <Tooltip title={attachment.path}>
              <span className={styles.meta}>
                <span className={styles.name}>{attachment.name}</span>
                <span className={styles.sub}>{attachmentSubtitle(attachment)}</span>
                {isUnavailable && <span className={styles.unavailable}>{unavailableLabel}</span>}
                {!pending && <span className={styles.sub}>{attachment.path}</span>}
              </span>
            </Tooltip>

            {onRemove && (
              <button
                type="button"
                className={styles.removeButton}
                onClick={() => onRemove(attachment.id)}
                aria-label={`Remove ${attachment.name}`}
              >
                <X size={14} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
