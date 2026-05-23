import React, { useEffect, useState } from 'react';
import {
  Drawer,
  Form,
  Input,
  Select,
  Switch,
  Button,
  Space,
  Divider,
  Tag,
  message,
} from 'antd';
import { invoke } from '@tauri-apps/api/core';
import { useProviderStore, type ProviderTestResult } from '@/store/providerStore';
import { readLegacyApiKey, type Provider } from '@/config/providers';
import { Copy, Zap } from 'lucide-react';

interface ProviderEditorProps {
  open: boolean;
  providerId?: string;
  onClose: () => void;
  onSave?: () => void;
  onCloneEdit?: (newId: string) => void;
}

function formatInvokeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return String(e);
}

export const ProviderEditor: React.FC<ProviderEditorProps> = ({
  open,
  providerId,
  onClose,
  onSave,
  onCloneEdit,
}) => {
  const [form] = Form.useForm();
  const { get, upsert, hasSecret, ensureSecret, testConnection } = useProviderStore();
  const [secretConfigured, setSecretConfigured] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);

  const provider = providerId ? get(providerId) : undefined;
  const isBuiltin = provider?.source === 'builtin';
  const readOnly = isBuiltin;

  useEffect(() => {
    if (!open) return;

    if (providerId) {
      const p = get(providerId);
      if (p) {
        form.setFieldsValue({
          name: p.name,
          baseURL: p.baseURL,
          models: p.models || [],
          description: p.description || '',
          enabled: p.enabled !== false,
          apiKey: '',
        });
        hasSecret(providerId)
          .then(setSecretConfigured)
          .catch(() => setSecretConfigured(false));
      }
    } else {
      form.resetFields();
      form.setFieldsValue({
        enabled: true,
        models: [],
        apiKey: '',
      });
      setSecretConfigured(null);
    }
  }, [open, providerId, get, hasSecret, form]);

  const buildProvider = (values: Record<string, unknown>, id: string): Provider => ({
    id,
    name: values.name as string,
    baseURL: values.baseURL as string,
    apiKeyRef: provider?.apiKeyRef && provider.id === id ? provider.apiKeyRef : `provider:${id}`,
    models: (values.models as string[]) || [],
    source: provider?.source === 'builtin' && provider.id === id ? 'builtin' : 'user',
    enabled: values.enabled !== false,
    description: (values.description as string) || '',
  });

  const persistProvider = async (values: Record<string, unknown>, id: string) => {
    const p = buildProvider(values, id);
    await upsert(p);

    const apiKey = (values.apiKey as string)?.trim();
    if (apiKey) {
      await ensureSecret(id, apiKey);
      setSecretConfigured(true);
    }

    return p;
  };

  const handleFinish = async (values: Record<string, unknown>) => {
    if (readOnly) return;

    setSaving(true);
    try {
      const id = providerId || `user-${Date.now()}`;
      await persistProvider(values, id);
      message.success('保存成功');
      onClose();
      onSave?.();
    } catch {
      message.error('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    try {
      setTesting(true);

      const id = providerId || `user-${Date.now()}`;
      const formValues = form.getFieldsValue();
      const baseURL = (formValues.baseURL as string)?.trim() || provider?.baseURL;
      const models = (formValues.models as string[]) || provider?.models || [];
      const name = (formValues.name as string)?.trim() || provider?.name;

      if (!baseURL) {
        message.warning('请填写 API 地址 (Base URL)');
        return;
      }
      if (!models.length) {
        message.warning('请至少添加一个可用模型（如 qwen-plus）');
        return;
      }

      if (!readOnly) {
        await persistProvider({ ...formValues, name, baseURL, models }, id);
      }

      const inlineKey = (formValues.apiKey as string)?.trim();
      let apiKey = inlineKey || readLegacyApiKey(id) || readLegacyApiKey(provider?.id || '') || '';

      if (!apiKey) {
        const configured = await hasSecret(id);
        if (!configured) {
          message.warning('未配置 API 密钥：请在下方输入 API Key');
          return;
        }
        // Key in vault only — use provider_test path (reads vault server-side)
        const result = await invoke<ProviderTestResult>('provider_test', {
          providerId: id,
        });
        if (result.ok) {
          message.success(`连接成功 (${result.latencyMs}ms${result.modelEcho ? ` · ${result.modelEcho}` : ''})`);
        } else {
          message.error(result.message || `连接失败 (${result.errorClass || 'unknown'})`);
        }
        return;
      }

      const result = await testConnection({
        id,
        baseURL,
        apiKey,
        models,
      });

      if (result.ok) {
        // Persist key to vault after successful ping
        await ensureSecret(id, apiKey);
        setSecretConfigured(true);
        message.success(`连接成功 (${result.latencyMs}ms${result.modelEcho ? ` · ${result.modelEcho}` : ''})`);
      } else {
        message.error(result.message || `连接失败 (${result.errorClass || 'unknown'})`);
      }
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return;
      console.error('[ProviderEditor] test connection failed:', e);
      message.error(formatInvokeError(e) || '测试连接失败，请检查配置');
    } finally {
      setTesting(false);
    }
  };

  const handleClone = async () => {
    if (!provider) return;

    setCloning(true);
    try {
      const newId = `user-${provider.id}-copy-${Date.now()}`;
      const clone: Provider = {
        ...provider,
        id: newId,
        name: `${provider.name} (副本)`,
        source: 'user',
        apiKeyRef: `provider:${newId}`,
      };
      await upsert(clone);
      message.success('已创建副本，可继续编辑');
      onCloneEdit?.(newId);
      onSave?.();
    } catch {
      message.error('克隆失败，请重试');
    } finally {
      setCloning(false);
    }
  };

  return (
    <Drawer
      title={providerId ? '编辑模型服务' : '新建模型服务'}
      width={460}
      open={open}
      onClose={onClose}
      destroyOnClose
      extra={
        <Space>
          {isBuiltin && (
            <Button icon={<Copy size={14} />} loading={cloning} onClick={handleClone}>
              克隆并编辑
            </Button>
          )}
          <Button onClick={onClose}>取消</Button>
          {!readOnly && (
            <Button type="primary" loading={saving} onClick={() => form.submit()}>
              保存
            </Button>
          )}
        </Space>
      }
    >
      <Form form={form} layout="vertical" onFinish={handleFinish}>
        <Form.Item
          label="服务名称"
          name="name"
          rules={[{ required: true, message: '请输入服务名称' }]}
        >
          <Input placeholder="例如：DeepSeek" disabled={readOnly} />
        </Form.Item>

        <Form.Item
          label="API 地址 (Base URL)"
          name="baseURL"
          rules={[{ required: true, message: '请输入 API 地址' }]}
        >
          <Input placeholder="例如：https://api.deepseek.com/v1" disabled={readOnly} />
        </Form.Item>

        <Form.Item label="可用模型" name="models">
          <Select
            mode="tags"
            placeholder="输入模型 ID，回车添加"
            tokenSeparators={[',', ' ']}
            disabled={readOnly}
          />
        </Form.Item>

        <Form.Item label="描述" name="description">
          <Input.TextArea
            autoSize={{ minRows: 2 }}
            placeholder="可选，描述该模型服务的用途"
            disabled={readOnly}
          />
        </Form.Item>

        <Form.Item label="启用" name="enabled" valuePropName="checked">
          <Switch checkedChildren="启用" unCheckedChildren="禁用" disabled={readOnly} />
        </Form.Item>

        <Divider orientation={'left' as 'left'} style={{ fontSize: 13, margin: '12px 0' }}>
          API 密钥
          {secretConfigured !== null && (
            <Tag
              color={secretConfigured ? 'success' : 'warning'}
              style={{ marginLeft: 8, fontWeight: 400 }}
            >
              {secretConfigured ? '已配置' : '未配置'}
            </Tag>
          )}
        </Divider>

        <Form.Item
          label="API Key"
          name="apiKey"
          extra={readOnly ? '系统预设服务的密钥可在此单独配置（不会修改预设的地址和模型列表）' : undefined}
        >
          <Input.Password
            placeholder={secretConfigured ? '留空则保留现有密钥' : '输入 API Key'}
          />
        </Form.Item>

        <Space style={{ marginTop: 8 }}>
          <Button
            icon={<Zap size={14} />}
            loading={testing}
            onClick={handleTest}
            disabled={readOnly && !providerId}
          >
            测试连接
          </Button>
        </Space>
      </Form>
    </Drawer>
  );
};
