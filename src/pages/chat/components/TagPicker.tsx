import React from 'react';
import { Select, Tag } from 'antd';
import { ALL_SYSTEM_TAGS, SYSTEM_TAGS } from '@/config/tagTaxonomy';

interface TagPickerProps {
  value?: string[];
  onChange?: (value: string[]) => void;
}

export const TagPicker: React.FC<TagPickerProps> = ({ value = [], onChange }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Object.entries(SYSTEM_TAGS).map(([category, tags]) => (
        <div key={category}>
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>{category}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {tags.map((tag) => {
              const active = value.includes(tag);
              return (
                <Tag
                  key={tag}
                  color={active ? 'orange' : 'default'}
                  style={{ cursor: 'pointer', margin: 0 }}
                  onClick={() => {
                    const next = active ? value.filter((t) => t !== tag) : [...value, tag];
                    onChange?.(next);
                  }}
                >
                  {tag}
                </Tag>
              );
            })}
          </div>
        </div>
      ))}
      <Select
        mode="tags"
        style={{ width: '100%' }}
        placeholder="输入自定义标签..."
        value={value}
        onChange={onChange}
        tokenSeparators={[',', ' ']}
        options={ALL_SYSTEM_TAGS.map((t) => ({ label: t, value: t }))}
      />
    </div>
  );
};
