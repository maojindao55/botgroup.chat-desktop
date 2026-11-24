import React from 'react';
import { Tooltip } from 'antd';
import { HelpCircle } from 'lucide-react';

interface FieldHelpProps {
  /** 说明文案（调用方负责 i18n） */
  title: string;
}

/**
 * 配置项旁的「?」悬浮说明，统一样式与可访问性。
 */
export const FieldHelp: React.FC<FieldHelpProps> = ({ title }) => (
  <Tooltip title={title} mouseEnterDelay={0.2}>
    <span
      role="img"
      aria-label={title}
      tabIndex={0}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        marginInlineStart: 4,
        color: 'currentColor',
        opacity: 0.45,
        cursor: 'help',
        outline: 'none',
      }}
    >
      <HelpCircle size={13} />
    </span>
  </Tooltip>
);

/** 用于 Form.Item label 的「标题 + ?」组合 */
export function fieldLabel(text: string, hint?: string): React.ReactNode {
  if (!hint) return text;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      {text}
      <FieldHelp title={hint} />
    </span>
  );
}
