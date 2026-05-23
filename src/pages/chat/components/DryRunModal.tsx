import React, { useState } from 'react';
import { Modal, Input, Button, Spin } from 'antd';
import { llmChatComplete } from '@/utils/llmClient';
import { resolveLlmCredentials } from '@/utils/resolveLlmCredentials';
import { applyPromptTemplate } from '@/utils/prompt';

export interface DryRunParams {
  kind: 'llm' | 'agent';
  name: string;
  providerId: string;
  model: string;
  systemPrompt: string;
  temperature?: number;
}

interface DryRunModalProps {
  open: boolean;
  onClose: () => void;
  params: DryRunParams | null;
}

export const DryRunModal: React.FC<DryRunModalProps> = ({ open, onClose, params }) => {
  const [prompt, setPrompt] = useState('你好，做个自我介绍');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    if (!params?.providerId || !params.model) {
      setError('请先选择 Provider 和 Model');
      return;
    }
    setLoading(true);
    setError(null);
    setOutput('');
    const start = performance.now();
    try {
      const creds = await resolveLlmCredentials(params.model, params.providerId);
      const system = applyPromptTemplate(params.systemPrompt, {
        aiName: params.name,
        groupName: '试运行群',
        userName: '本地用户',
      });
      const text = await llmChatComplete({
        ...creds,
        temperature: params.temperature ?? 0.7,
        messages: [
          { role: 'system', content: system || `你是${params.name}。` },
          { role: 'user', content: prompt },
        ],
      });
      setOutput(text);
      setElapsedMs(Math.round(performance.now() - start));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="试运行一句"
      open={open}
      onCancel={onClose}
      width={520}
      footer={[
        <Button key="cancel" onClick={onClose}>
          关闭
        </Button>,
        <Button key="run" type="primary" loading={loading} onClick={handleRun}>
          发送
        </Button>,
      ]}
      destroyOnClose
      afterClose={() => {
        setOutput('');
        setError(null);
        setElapsedMs(null);
        setPrompt('你好，做个自我介绍');
      }}
    >
      <Input.TextArea
        rows={2}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="输入测试消息"
        style={{ marginBottom: 12 }}
      />
      {loading && (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin tip="正在调用模型..." />
        </div>
      )}
      {error && (
        <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 8 }}>{error}</div>
      )}
      {output && (
        <div
          style={{
            background: 'rgba(0,0,0,0.03)',
            borderRadius: 8,
            padding: 12,
            fontSize: 13,
            whiteSpace: 'pre-wrap',
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          {output}
        </div>
      )}
      {elapsedMs != null && (
        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 8 }}>
          耗时 {elapsedMs}ms
        </div>
      )}
    </Modal>
  );
};
