import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from 'antd';
import type { TextAreaProps } from 'antd/es/input';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import {
  applyMention,
  filterMentionCandidates,
  getActiveMention,
  type ActiveMention,
  type MentionCandidate,
} from '@/utils/mentionAutocomplete';

interface MentionAutocompleteOptions {
  value: string;
  candidates: MentionCandidate[];
  onChange: (value: string) => void;
  getCaret: () => number;
  setCaret: (caret: number) => void;
}

export function useMentionAutocomplete({
  value,
  candidates,
  onChange,
  getCaret,
  setCaret,
}: MentionAutocompleteOptions) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissedMentionKey, setDismissedMentionKey] = useState<string | null>(null);
  const caret = getCaret();
  const activeMention = useMemo<ActiveMention | null>(
    () => getActiveMention(value, caret),
    [value, caret],
  );
  const suggestions = useMemo(
    () => activeMention ? filterMentionCandidates(candidates, activeMention.query) : [],
    [activeMention, candidates],
  );
  const activeMentionKey = activeMention ? `${activeMention.start}:${activeMention.query}` : null;
  const open = suggestions.length > 0 && activeMentionKey !== dismissedMentionKey;

  useEffect(() => {
    setSelectedIndex(0);
    setDismissedMentionKey(null);
  }, [activeMention?.start, activeMention?.query]);

  const selectCandidate = (candidate: MentionCandidate) => {
    const latestActiveMention = getActiveMention(value, getCaret());
    if (!latestActiveMention) return;
    const result = applyMention(value, latestActiveMention, candidate);
    onChange(result.value);
    window.requestAnimationFrame(() => setCaret(result.caret));
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!open) return false;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex(index => (index + 1) % suggestions.length);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex(index => (index - 1 + suggestions.length) % suggestions.length);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      selectCandidate(suggestions[selectedIndex]);
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setSelectedIndex(0);
      setDismissedMentionKey(activeMentionKey);
      return true;
    }
    return false;
  };

  return {
    open,
    selectedIndex,
    suggestions,
    setSelectedIndex,
    handleKeyDown,
    selectCandidate,
  };
}

interface MentionSuggestionPanelProps {
  open: boolean;
  suggestions: MentionCandidate[];
  selectedIndex: number;
  onHover: (index: number) => void;
  onSelect: (candidate: MentionCandidate) => void;
}

export function MentionSuggestionPanel({
  open,
  suggestions,
  selectedIndex,
  onHover,
  onSelect,
}: MentionSuggestionPanelProps) {
  if (!open) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 'calc(100% + 6px)',
        zIndex: 20,
        maxHeight: 220,
        overflowY: 'auto',
        border: '1px solid rgba(0,0,0,0.08)',
        borderRadius: 8,
        background: '#fff',
        boxShadow: '0 10px 30px rgba(0,0,0,0.14)',
        padding: 4,
      }}
    >
      {suggestions.map((candidate, index) => (
        <button
          key={candidate.id}
          type="button"
          onMouseEnter={() => onHover(index)}
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(candidate);
          }}
          style={{
            width: '100%',
            minHeight: 36,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            border: 0,
            borderRadius: 6,
            background: index === selectedIndex ? 'rgba(255,102,0,0.12)' : 'transparent',
            color: '#1f1f1f',
            cursor: 'pointer',
            padding: '6px 8px',
            textAlign: 'left',
          }}
        >
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: 999,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              background: 'rgba(255,102,0,0.16)',
              color: '#c24d00',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {candidate.name.slice(0, 1).toUpperCase()}
          </span>
          <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 13, lineHeight: '18px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {candidate.name}
            </span>
            <span style={{ fontSize: 11, lineHeight: '14px', color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              @{candidate.id}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

interface MentionTextAreaProps extends Omit<TextAreaProps, 'value' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  candidates: MentionCandidate[];
  containerStyle?: React.CSSProperties;
}

export function MentionTextArea({
  value,
  onChange,
  candidates,
  containerStyle,
  onKeyDown,
  onSelect,
  onClick,
  ...props
}: MentionTextAreaProps) {
  const textareaRef = useRef<TextAreaRef>(null);
  const caretRef = useRef(value.length);
  const [, forceCaretRender] = useState(0);

  const getTextarea = () => textareaRef.current?.resizableTextArea?.textArea;
  const updateCaret = (caret: number) => {
    caretRef.current = caret;
    forceCaretRender(value => value + 1);
  };
  const setDomCaret = (caret: number) => {
    const textarea = getTextarea();
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    updateCaret(caret);
  };
  const syncCaretFromEvent = (target: EventTarget | null) => {
    const textarea = target as HTMLTextAreaElement | null;
    if (typeof textarea?.selectionStart === 'number') {
      updateCaret(textarea.selectionStart);
    }
  };

  const mention = useMentionAutocomplete({
    value,
    candidates,
    onChange,
    getCaret: () => caretRef.current,
    setCaret: setDomCaret,
  });

  return (
    <div style={{ position: 'relative', ...containerStyle }}>
      <MentionSuggestionPanel
        open={mention.open}
        suggestions={mention.suggestions}
        selectedIndex={mention.selectedIndex}
        onHover={mention.setSelectedIndex}
        onSelect={mention.selectCandidate}
      />
      <Input.TextArea
        {...props}
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          syncCaretFromEvent(event.target);
          onChange(event.target.value);
        }}
        onClick={(event) => {
          syncCaretFromEvent(event.currentTarget);
          onClick?.(event);
        }}
        onSelect={(event) => {
          syncCaretFromEvent(event.currentTarget);
          onSelect?.(event);
        }}
        onKeyDown={(event) => {
          const handled = mention.handleKeyDown(event);
          if (!handled) onKeyDown?.(event);
        }}
      />
    </div>
  );
}
