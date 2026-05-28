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
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation(['editor', 'common']);
  const [form] = Form.useForm();
  const { get, upsert, hasSecret, ensureSecret, testConnection, clone } = useProviderStore();
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
    setSaving(true);
    try {
      const id = providerId || `user-${Date.now()}`;
      if (readOnly) {
        const apiKey = (values.apiKey as string)?.trim();
        if (apiKey) {
          await ensureSecret(id, apiKey);
          setSecretConfigured(true);
          message.success(t('provider.secretSaved'));
        } else {
          message.info(t('provider.secretEmpty'));
        }
        onClose();
        onSave?.();
      } else {
        await persistProvider(values, id);
        message.success(t('provider.saveSuccess'));
        onClose();
        onSave?.();
      }
    } catch {
      message.error(t('provider.saveFailed'));
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
        message.warning(t('provider.validation.baseUrlRequired'));
        return;
      }
      if (!models.length) {
        message.warning(t('provider.validation.modelsRequired'));
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
          message.warning(t('provider.validation.secretRequired'));
          return;
        }
        const result = await invoke<ProviderTestResult>('provider_test', {
          providerId: id,
        });
        if (result.ok) {
          message.success(
            t('editor:provider.testSuccess', {
              latency: result.latencyMs,
              model: result.modelEcho ? ` · ${result.modelEcho}` : '',
            }),
          );
        } else {
          message.error(result.message || t('provider.testFailedDetail', { errorClass: result.errorClass || 'unknown' }));
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
        await ensureSecret(id, apiKey);
        setSecretConfigured(true);
        message.success(
          t('editor:provider.testSuccess', {
            latency: result.latencyMs,
            model: result.modelEcho ? ` · ${result.modelEcho}` : '',
          }),
        );
      } else {
        message.error(result.message || t('provider.testFailedDetail', { errorClass: result.errorClass || 'unknown' }));
      }
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return;
      console.error('[ProviderEditor] test connection failed:', e);
      message.error(formatInvokeError(e) || t('provider.testFailed'));
    } finally {
      setTesting(false);
    }
  };

  const handleClone = async () => {
    if (!providerId) return;

    setCloning(true);
    try {
      const copied = await clone(providerId);
      message.success(t('provider.cloneSuccess'));
      onCloneEdit?.(copied.id);
      onSave?.();
    } catch (e) {
      message.error(formatInvokeError(e) || t('provider.cloneFailed'));
    } finally {
      setCloning(false);
    }
  };

  return (
    <Drawer
      title={providerId ? t('provider.titleEdit') : t('provider.titleCreate')}
      width={460}
      open={open}
      onClose={onClose}
      destroyOnClose
      extra={
        <Space>
          {isBuiltin && (
            <Button icon={<Copy size={14} />} loading={cloning} onClick={handleClone}>
              {t('provider.cloneEdit')}
            </Button>
          )}
          <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button type="primary" loading={saving} onClick={() => form.submit()}>
            {t('common:actions.save')}
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" onFinish={handleFinish}>
        <Form.Item
          label={t('provider.fields.name')}
          name="name"
          rules={[{ required: true, message: t('provider.fields.nameRequired') }]}
        >
          <Input placeholder={t('provider.fields.namePlaceholder')} disabled={readOnly} />
        </Form.Item>

        <Form.Item
          label={t('provider.fields.baseUrl')}
          name="baseURL"
          rules={[{ required: true, message: t('provider.fields.baseUrlRequired') }]}
        >
          <Input placeholder={t('provider.fields.baseUrlPlaceholder')} disabled={readOnly} />
        </Form.Item>

        <Form.Item label={t('provider.fields.models')} name="models">
          <Select
            mode="tags"
            placeholder={t('provider.fields.modelsPlaceholder')}
            tokenSeparators={[',', ' ']}
            disabled={readOnly}
          />
        </Form.Item>

        <Form.Item label={t('provider.fields.description')} name="description">
          <Input.TextArea
            autoSize={{ minRows: 2 }}
            placeholder={t('provider.fields.descriptionPlaceholder')}
            disabled={readOnly}
          />
        </Form.Item>

        <Form.Item label={t('provider.fields.enabled')} name="enabled" valuePropName="checked">
          <Switch checkedChildren={t('provider.fields.enabledOn')} unCheckedChildren={t('provider.fields.enabledOff')} disabled={readOnly} />
        </Form.Item>

        <Divider orientation={'left' as 'left'} style={{ fontSize: 13, margin: '12px 0' }}>
          {t('provider.fields.secretSection')}
          {secretConfigured !== null && (
            <Tag
              color={secretConfigured ? 'success' : 'warning'}
              style={{ marginLeft: 8, fontWeight: 400 }}
            >
              {secretConfigured ? t('provider.fields.secretConfigured') : t('provider.fields.secretMissing')}
            </Tag>
          )}
        </Divider>

        <Form.Item
          label="API Key"
          name="apiKey"
          extra={readOnly ? t('provider.fields.secretBuiltinHint') : undefined}
        >
          <Input.Password
            placeholder={secretConfigured ? t('provider.fields.secretPlaceholderConfigured') : t('provider.fields.secretPlaceholderEmpty')}
          />
        </Form.Item>

        <Space style={{ marginTop: 8 }}>
          <Button
            icon={<Zap size={14} />}
            loading={testing}
            onClick={handleTest}
            disabled={readOnly && !providerId}
          >
            {t('provider.fields.testConnection')}
          </Button>
        </Space>
      </Form>
    </Drawer>
  );
};
