import React, { useEffect, useMemo } from 'react';
import { Select, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { Avatar as LobeAvatar } from '@lobehub/ui';
import { useAIMemberStore } from '@/store/aiMemberStore';
import { useProviderStore } from '@/store/providerStore';
import type { AIMember } from '@/config/aiMembers';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';
import { getPickableMembers, resolveEffectiveMember } from '@/utils/aiMemberDisplay';

interface MemberPickerProps {
  kind: 'llm' | 'agent' | 'cli';
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

function memberMetaLine(
  member: AIMember,
  providerName: string | undefined,
  t: (key: string, options?: { defaultValue?: string }) => string,
): string {
  if (member.kind === 'llm') {
    const unmapped = member.providerId?.startsWith('unmapped-');
    return `${member.model} · ${providerName || member.providerId}${unmapped ? ' ⚠️' : ''}`;
  }
  if (member.kind === 'agent') {
    const tools = member.tools?.filter((tool) => tool.enabled).length ?? 0;
    const unmapped = member.providerId?.startsWith('unmapped-');
    return `${providerName || member.providerId} · ${member.model} · 🛠 ${tools} tools${unmapped ? ' ⚠️' : ''}`;
  }
  return `${member.cli?.adapter || 'cli'} · ${t('chat:memberPicker.cliMemberSuffix', { defaultValue: '开发成员' })}`;
}

export const MemberPicker: React.FC<MemberPickerProps> = ({
  kind,
  value,
  onChange,
  placeholder,
  disabled = false,
}) => {
  const { t } = useTranslation(['chat', 'common']);
  const defaultPlaceholder = t('chat:memberPicker.defaultPlaceholder', { defaultValue: '选择资源...' });
  const members = useAIMemberStore((state) => state.members);
  const { load } = useAIMemberStore();
  const { providers, load: loadProviders } = useProviderStore();

  useEffect(() => {
    load();
    loadProviders();
  }, [load, loadProviders]);

  const pickableMembers = useMemo(
    () => getPickableMembers(members, kind),
    [members, kind],
  );

  const providerMap = useMemo(() => providers, [providers]);

  const options = pickableMembers.map((m) => ({
    label: m.name,
    value: m.id,
    desc: m.description || '',
    avatar: m.avatar,
    tags: m.tags || [],
    meta: memberMetaLine(m, providerMap[m.providerId!]?.name, t),
    member: m,
  }));

  return (
    <Select
      mode="multiple"
      style={{ width: '100%' }}
      placeholder={placeholder ?? defaultPlaceholder}
      value={value}
      onChange={onChange}
      disabled={disabled}
      filterOption={(input, option) => {
        const o = option as { label?: string; desc?: string };
        return (
          (o.label?.toLowerCase().includes(input.toLowerCase()) ?? false) ||
          (o.desc?.toLowerCase().includes(input.toLowerCase()) ?? false)
        );
      }}
      options={options}
      optionRender={(option) => {
        const data = option.data as (typeof options)[0];
        const a = getAvatarData(data.label);
        const url = resolveAvatarByName(data.label, data.avatar, 24);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
            <LobeAvatar
              size={24}
              avatar={url || a.text}
              background={a.backgroundColor}
              shape="circle"
              title={data.label}
              style={{ flexShrink: 0 }}
            />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{data.label}</span>
              <span
                style={{
                  fontSize: 11,
                  opacity: 0.55,
                  maxWidth: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {data.meta}
              </span>
              {data.desc && (
                <span
                  style={{
                    fontSize: 11,
                    opacity: 0.45,
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {data.desc}
                </span>
              )}
            </div>
            {data.tags?.slice(0, 2).map((t: string) => (
              <Tag key={t} style={{ margin: 0 }}>
                {t}
              </Tag>
            ))}
          </div>
        );
      }}
      tagRender={(props) => {
        const { label, value: val, closable, onClose } = props;
        const member = resolveEffectiveMember(members, String(val));
        const displayName = member?.name || (label as string);
        const a = getAvatarData(displayName);
        const url = resolveAvatarByName(displayName, member?.avatar, 16);
        const isLegacyBuiltin = member?.source === 'builtin';
        return (
          <Tag
            closable={closable}
            onClose={onClose}
            style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '2px 4px 2px 0', padding: '2px 6px' }}
          >
            <LobeAvatar
              size={16}
              avatar={url || a.text}
              background={a.backgroundColor}
              shape="circle"
              title={displayName}
              style={{ flexShrink: 0 }}
            />
            <span>{displayName}{isLegacyBuiltin ? ` (${t('common:badges.official')})` : ''}</span>
          </Tag>
        );
      }}
    />
  );
};
