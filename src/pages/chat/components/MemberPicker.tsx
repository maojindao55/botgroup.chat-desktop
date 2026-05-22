import React, { useEffect } from 'react';
import { Select, Tag } from 'antd';
import { Avatar as LobeAvatar } from '@lobehub/ui';
import { useAIMemberStore } from '@/store/aiMemberStore';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';

interface MemberPickerProps {
  kind: 'llm' | 'agent' | 'cli';
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

export const MemberPicker: React.FC<MemberPickerProps> = ({
  kind,
  value,
  onChange,
  placeholder = '选择群员...',
  disabled = false,
}) => {
  const { list, load } = useAIMemberStore();

  useEffect(() => {
    load();
  }, []);

  const members = list(kind);

  const options = members.map(m => ({
    label: m.name,
    value: m.id,
    desc: m.description || '',
    avatar: m.avatar,
    tags: m.tags || [],
  }));

  return (
    <Select
      mode="multiple"
      style={{ width: '100%' }}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      disabled={disabled}
      filterOption={(input, option) => {
        const o = option as any;
        return (
          o.label.toLowerCase().includes(input.toLowerCase()) ||
          o.desc.toLowerCase().includes(input.toLowerCase())
        );
      }}
      options={options}
      optionRender={(option) => {
        const data = option.data as any;
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
              {data.desc && (
                <span style={{ fontSize: 11, opacity: 0.6, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {data.desc}
                </span>
              )}
            </div>
            {data.tags && data.tags.slice(0, 2).map((t: string) => (
              <Tag key={t} style={{ margin: 0 }}>{t}</Tag>
            ))}
          </div>
        );
      }}
      tagRender={(props) => {
        const { label, value: val, closable, onClose } = props;
        const member = members.find(m => m.id === val);
        const a = getAvatarData(label as string);
        const url = resolveAvatarByName(label as string, member?.avatar, 16);
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
              title={label as string}
              style={{ flexShrink: 0 }}
            />
            <span>{label}</span>
          </Tag>
        );
      }}
    />
  );
};
