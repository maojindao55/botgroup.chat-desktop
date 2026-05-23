import React, { useState } from 'react';
import { Input, Popover, Tabs } from 'antd';
import { BUILTIN_AVATARS } from '@/config/builtinAvatars';

interface AvatarPickerProps {
  value?: string;
  onChange?: (value: string) => void;
}

export const AvatarPicker: React.FC<AvatarPickerProps> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);

  const grid = (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 48px)',
        gap: 8,
        maxWidth: 280,
        maxHeight: 240,
        overflowY: 'auto',
        padding: 4,
      }}
    >
      {BUILTIN_AVATARS.map((item) => (
        <button
          key={item.path}
          type="button"
          title={item.label}
          onClick={() => {
            onChange?.(item.path);
            setOpen(false);
          }}
          style={{
            width: 48,
            height: 48,
            padding: 0,
            border: value === item.path ? '2px solid #ff6600' : '1px solid rgba(0,0,0,0.1)',
            borderRadius: 8,
            overflow: 'hidden',
            cursor: 'pointer',
            background: '#fff',
          }}
        >
          <img src={item.path} alt={item.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </button>
      ))}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Popover
          open={open}
          onOpenChange={setOpen}
          trigger="click"
          content={
            <Tabs
              size="small"
              items={[
                { key: 'builtin', label: '内置图库', children: grid },
                {
                  key: 'url',
                  label: '链接',
                  children: (
                    <Input
                      placeholder="https://... 或 /img/xxx.png"
                      value={value}
                      onChange={(e) => onChange?.(e.target.value)}
                    />
                  ),
                },
              ]}
            />
          }
        >
          <button
            type="button"
            style={{
              width: 48,
              height: 48,
              borderRadius: 8,
              border: '1px dashed rgba(0,0,0,0.2)',
              background: '#fafafa',
              cursor: 'pointer',
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            {value ? (
              <img src={value} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontSize: 11, color: '#999' }}>选头像</span>
            )}
          </button>
        </Popover>
        <Input
          placeholder="头像路径或 URL（例：/img/ds.svg）"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>
    </div>
  );
};
