import React, { useMemo, useRef, useState } from 'react';
import { Button, Input, Popover, Segmented, message } from 'antd';
import { Avatar as LobeAvatar } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';
import { getLobeIconCDN, toc, type IconToc } from '@lobehub/icons';
import { Upload } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import {
  encodeLobehubAvatar,
  isLocalAvatar,
  isLobehubAvatar,
  parseLobehubAvatar,
  resolveAvatarSource,
} from '@/utils/lobehubAvatar';
import { normalizeAvatarInput } from '@/utils/avatarInput';

const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

interface AvatarPickerProps {
  value?: string;
  onChange?: (value: string) => void;
}

type IconGroup = IconToc['group'] | 'all';

function iconMatchesQuery(item: IconToc, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    item.id,
    item.title,
    item.fullTitle,
    item.docsUrl,
  ].some((field) => field.toLowerCase().includes(q));
}

export const AvatarPicker: React.FC<AvatarPickerProps> = ({ value, onChange }) => {
  const { t } = useTranslation('editor');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<IconGroup>('all');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const groupOptions = useMemo(
    () =>
      (['all', 'model', 'provider', 'application'] as const).map((value) => ({
        value,
        label: t(`member.avatarPicker.groups.${value}`),
      })),
    [t],
  );

  const previewAvatar = isLocalAvatar(value)
    ? resolveAvatarSource(value)
    : (resolveAvatarSource(value) || value);

  const filteredIcons = useMemo(() => {
    return toc.filter((item) => {
      if (group !== 'all' && item.group !== group) return false;
      return iconMatchesQuery(item, query);
    });
  }, [group, query]);

  const selectedIconId = parseLobehubAvatar(value);

  const uploadBytes = async (data: Uint8Array) => {
    setUploading(true);
    try {
      const next = await invoke<string>('upload_avatar_image', { data });
      onChange?.(next);
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('member.avatarPicker.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const handlePickFile = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      message.error(t('member.avatarPicker.invalidInput'));
      return;
    }
    if (file.size > MAX_AVATAR_SIZE) {
      message.error(t('member.avatarPicker.tooLarge'));
      return;
    }
    try {
      await uploadBytes(new Uint8Array(await file.arrayBuffer()));
    } catch {
      message.error(t('member.avatarPicker.uploadFailed'));
    }
  };

  /** 失焦/回车时规范化粘贴的链接或本地路径 */
  const applyInput = async () => {
    const normalized = normalizeAvatarInput(value || '');
    if (normalized.kind === 'empty') {
      onChange?.('');
      return;
    }
    if (normalized.kind === 'invalid') {
      message.error(t('member.avatarPicker.invalidInput'));
      return;
    }
    if (normalized.kind === 'lobehub' || normalized.kind === 'url') {
      onChange?.(normalized.value);
      return;
    }
    if (normalized.kind === 'file-path') {
      setUploading(true);
      try {
        const next = await invoke<string>('import_avatar_path', {
          path: normalized.value,
        });
        onChange?.(next);
      } catch (e) {
        message.error(e instanceof Error ? e.message : t('member.avatarPicker.importFailed'));
      } finally {
        setUploading(false);
      }
      return;
    }
    // data:image/... → 落盘为本地文件，避免 base64 进入数据库
    try {
      const blob = await fetch(normalized.value).then((r) => r.blob());
      await uploadBytes(new Uint8Array(await blob.arrayBuffer()));
    } catch {
      message.error(t('member.avatarPicker.uploadFailed'));
    }
  };

  const iconGrid = (
    <div style={{ width: 320 }}>
      <Input
        allowClear
        placeholder={t('member.avatarPicker.searchPlaceholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <Segmented
        block
        size="small"
        options={groupOptions}
        value={group}
        onChange={(next) => setGroup(next as IconGroup)}
        style={{ marginBottom: 8 }}
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, 44px)',
          gap: 8,
          maxHeight: 280,
          overflowY: 'auto',
          padding: 2,
        }}
      >
        {filteredIcons.map((item) => {
          const encoded = encodeLobehubAvatar(item.id);
          const selected = value === encoded || selectedIconId === item.id;
          const src = getLobeIconCDN(item.id, { format: 'avatar', cdn: 'aliyun' });
          return (
            <button
              key={item.id}
              type="button"
              title={item.fullTitle || item.title}
              onClick={() => {
                onChange?.(encoded);
                setOpen(false);
              }}
              style={{
                width: 44,
                height: 44,
                padding: 0,
                border: selected ? '2px solid #ff6600' : '1px solid rgba(0,0,0,0.08)',
                borderRadius: 10,
                overflow: 'hidden',
                cursor: 'pointer',
                background: '#fff',
              }}
            >
              <img
                src={src}
                alt={item.title}
                loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </button>
          );
        })}
      </div>
      {filteredIcons.length === 0 && (
        <div style={{ padding: '16px 0', textAlign: 'center', color: '#999', fontSize: 12 }}>
          {t('member.avatarPicker.empty')}
        </div>
      )}
      <div style={{ marginTop: 8, fontSize: 11, color: '#999', lineHeight: 1.5 }}>
        {t('member.avatarPicker.iconsFrom')}{' '}
        <a href="https://lobehub.com/icons" target="_blank" rel="noreferrer">
          LobeHub Icons
        </a>
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Popover
          open={open}
          onOpenChange={setOpen}
          trigger="click"
          title={t('member.avatarPicker.popoverTitle')}
          content={iconGrid}
        >
          <button
            type="button"
            style={{
              width: 48,
              height: 48,
              borderRadius: 10,
              border: '1px dashed rgba(0,0,0,0.2)',
              background: '#fafafa',
              cursor: 'pointer',
              overflow: 'hidden',
              flexShrink: 0,
              padding: 0,
            }}
          >
            {previewAvatar ? (
              <LobeAvatar avatar={previewAvatar} shape="square" size={48} />
            ) : (
              <span style={{ fontSize: 11, color: '#999' }}>{t('member.avatarPicker.pickIcon')}</span>
            )}
          </button>
        </Popover>
        <Input
          placeholder={
            isLobehubAvatar(value)
              ? t('member.avatarPicker.lobehubSelected', { name: parseLobehubAvatar(value) })
              : t('member.avatarPicker.inputPlaceholder')
          }
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onBlur={applyInput}
          onPressEnter={applyInput}
          style={{ flex: 1 }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            void handlePickFile(file);
          }}
        />
        <Button
          icon={<Upload size={14} />}
          loading={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {t('member.avatarPicker.upload')}
        </Button>
      </div>
    </div>
  );
};
