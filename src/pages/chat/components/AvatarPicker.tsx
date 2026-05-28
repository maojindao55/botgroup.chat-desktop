import React, { useMemo, useState } from 'react';
import { Input, Popover, Segmented } from 'antd';
import { Avatar as LobeAvatar } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';
import { getLobeIconCDN, toc, type IconToc } from '@lobehub/icons';
import {
  encodeLobehubAvatar,
  isLobehubAvatar,
  parseLobehubAvatar,
  resolveAvatarSource,
} from '@/utils/lobehubAvatar';

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

  const groupOptions = useMemo(
    () =>
      (['all', 'model', 'provider', 'application'] as const).map((value) => ({
        value,
        label: t(`member.avatarPicker.groups.${value}`),
      })),
    [t],
  );

  const previewAvatar = resolveAvatarSource(value) || value;

  const filteredIcons = useMemo(() => {
    return toc.filter((item) => {
      if (group !== 'all' && item.group !== group) return false;
      return iconMatchesQuery(item, query);
    });
  }, [group, query]);

  const selectedIconId = parseLobehubAvatar(value);

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
          style={{ flex: 1 }}
        />
      </div>
    </div>
  );
};
