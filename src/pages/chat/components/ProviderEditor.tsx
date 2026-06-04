import React, { useEffect, useRef, useState } from 'react';
import {
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Button,
  Divider,
  Tag,
  message,
} from 'antd';
import { createStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { brandPrimaryButtonProps } from '@/lib/theme';
import { useProviderStore, type ProviderTestResult } from '@/store/providerStore';
import { providerPresets, readLegacyApiKey, type Provider, type ProviderParams } from '@/config/providers';
import { getTranslatedProviderName } from '@/i18n/providerLabels';
import { Copy, Zap } from 'lucide-react';

const useStyles = createStyles(({ token, css }) => ({
  form: css`
    padding: 16px 20px 24px;

    .ant-form-item {
      margin-bottom: 14px;
    }
  `,
  sectionHint: css`
    margin: -4px 0 12px;
    font-size: 11px;
    color: ${token.colorTextTertiary};
    line-height: 1.5;
  `,
  fieldGrid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 12px;

    @media (max-width: 560px) {
      grid-template-columns: 1fr;
    }
  `,
  drawerFooter: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border-top: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
  `,
  footerActions: css`
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    margin-left: auto;
  `,
  testRow: css`
    display: flex;
    justify-content: flex-start;
    margin-top: 4px;
  `,
}));

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

/**
 * 结构化参数表单字段 ↔ OpenAI 兼容接口的原生参数键（snake_case）映射。
 * 其余未列出的键会被归入 customParams（自定义 JSON）以便透传厂商专有参数。
 */
const STRUCTURED_PARAM_MAP: Array<{ field: string; apiKey: string }> = [
  { field: 'temperature', apiKey: 'temperature' },
  { field: 'topP', apiKey: 'top_p' },
  { field: 'topK', apiKey: 'top_k' },
  { field: 'maxTokens', apiKey: 'max_tokens' },
  { field: 'frequencyPenalty', apiKey: 'frequency_penalty' },
  { field: 'presencePenalty', apiKey: 'presence_penalty' },
];

/** 将已存储的 params 拆分为结构化表单字段 + 自定义 JSON 文本。 */
function paramsToFormValues(params?: ProviderParams): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const extra: Record<string, unknown> = {};
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      const mapping = STRUCTURED_PARAM_MAP.find((m) => m.apiKey === k);
      if (mapping) {
        values[mapping.field] = v;
      } else {
        extra[k] = v;
      }
    }
  }
  for (const { field } of STRUCTURED_PARAM_MAP) {
    if (!(field in values)) values[field] = undefined;
  }
  values.customParams = Object.keys(extra).length ? JSON.stringify(extra, null, 2) : '';
  return values;
}

/**
 * 将表单值组装为 params 对象。结构化字段使用原生键名，自定义 JSON 合并在后。
 * 自定义 JSON 解析失败时忽略（调用方应先执行表单校验，保存/测试路径都会拦截）。
 */
function formValuesToParams(values: Record<string, unknown>): ProviderParams | undefined {
  const params: ProviderParams = {};
  for (const { field, apiKey } of STRUCTURED_PARAM_MAP) {
    const v = values[field];
    if (v !== undefined && v !== null && v !== '') {
      params[apiKey] = v as number;
    }
  }
  const customStr = (values.customParams as string)?.trim();
  if (customStr) {
    try {
      const parsed = JSON.parse(customStr);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.assign(params, parsed);
      }
    } catch {
      /* ignored: callers validate form fields before persisting */
    }
  }
  return Object.keys(params).length ? params : undefined;
}

export const ProviderEditor: React.FC<ProviderEditorProps> = ({
  open,
  providerId,
  onClose,
  onSave,
  onCloneEdit,
}) => {
  const { styles } = useStyles();
  const { t } = useTranslation(['editor', 'common']);
  const [form] = Form.useForm();
  const { get, upsert, hasSecret, ensureSecret, testConnection, clone } = useProviderStore();
  const [secretConfigured, setSecretConfigured] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [presetType, setPresetType] = useState<string | undefined>(undefined);
  // Synchronous lock to prevent double-click races on Save/Test/Clone.
  // React state updates (`saving`) are async, so two rapid clicks can both
  // enter the handler before the button becomes disabled; the ref does not.
  const submittingRef = useRef(false);
  // Pre-generated stable ID for new providers — avoids creating duplicates when
  // handleFinish is invoked more than once.
  const pendingProviderIdRef = useRef<string>('');

  const provider = providerId ? get(providerId) : undefined;
  const isBuiltin = provider?.source === 'builtin';
  const readOnly = isBuiltin;

  useEffect(() => {
    if (!open) return;

    // Reset submission lock whenever the drawer opens
    submittingRef.current = false;
    setPresetType(undefined);

    if (providerId) {
      pendingProviderIdRef.current = '';
      const p = get(providerId);
      if (p) {
        form.setFieldsValue({
          name: p.name,
          baseURL: p.baseURL,
          models: p.models || [],
          description: p.description || '',
          enabled: p.enabled !== false,
          apiKey: '',
          ...paramsToFormValues(p.params),
        });
        hasSecret(providerId)
          .then(setSecretConfigured)
          .catch(() => setSecretConfigured(false));
      }
    } else {
      // Pre-generate a stable ID for the new provider
      pendingProviderIdRef.current = `user-${Date.now()}`;
      form.resetFields();
      form.setFieldsValue({
        enabled: true,
        models: [],
        apiKey: '',
        ...paramsToFormValues(undefined),
      });
      setSecretConfigured(null);
    }
  }, [open, providerId, get, hasSecret, form]);

  const buildProvider = (values: Record<string, unknown>, id: string): Provider => ({    id,
    name: values.name as string,
    baseURL: values.baseURL as string,
    apiKeyRef: provider?.apiKeyRef && provider.id === id ? provider.apiKeyRef : `provider:${id}`,
    models: (values.models as string[]) || [],
    source: provider?.source === 'builtin' && provider.id === id ? 'builtin' : 'user',
    enabled: values.enabled !== false,
    description: (values.description as string) || '',
    params: formValuesToParams(values),
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
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    try {
      const id = providerId || pendingProviderIdRef.current || `user-${Date.now()}`;
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
      submittingRef.current = false;
    }
  };

  const handleTest = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      setTesting(true);

      const id = providerId || pendingProviderIdRef.current || `user-${Date.now()}`;
      await form.validateFields(['customParams']);
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
        // Validate custom params before persisting: getFieldsValue() bypasses
        // Form validators, so an invalid customParams JSON would otherwise be
        // silently dropped (deleting previously stored params) on Test.
        try {
          await form.validateFields(['customParams']);
        } catch {
          message.error(t('provider.fields.customParamsInvalid'));
          return;
        }
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
      submittingRef.current = false;
    }
  };

  const handleClone = async () => {
    if (!providerId) return;
    if (submittingRef.current) return;
    submittingRef.current = true;

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
      submittingRef.current = false;
    }
  };

  const handlePresetChange = (value?: string) => {
    setPresetType(value);
    if (!value) return;
    const preset = providerPresets.find((p) => p.id === value);
    if (!preset || preset.id === 'custom') return;
    // 仅自动填入名称与 API 地址；模型保持为空，由用户自行填写
    form.setFieldsValue({
      name: getTranslatedProviderName(preset.id, preset.name),
      baseURL: preset.baseURL,
    });
  };

  return (
    <Drawer
      title={providerId ? t('provider.titleEdit') : t('provider.titleCreate')}
      width={540}
      open={open}
      onClose={onClose}
      destroyOnClose
      footer={
        <div className={styles.drawerFooter}>
          <div>
            {isBuiltin && (
              <Button icon={<Copy size={14} />} loading={cloning} onClick={handleClone}>
                {t('provider.cloneEdit')}
              </Button>
            )}
          </div>
          <div className={styles.footerActions}>
            <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
            <Button loading={saving} onClick={() => form.submit()} {...brandPrimaryButtonProps}>
              {t('common:actions.save')}
            </Button>
          </div>
        </div>
      }
      styles={{
        body: { padding: 0 },
        header: { padding: '14px 18px' },
        footer: { padding: 0 },
      }}
    >
      <Form form={form} layout="vertical" onFinish={handleFinish} className={styles.form}>
        {!providerId && (
          <Form.Item
            label={t('provider.fields.presetType')}
            extra={t('provider.fields.presetTypeHint')}
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              value={presetType}
              onChange={handlePresetChange}
              placeholder={t('provider.fields.presetTypePlaceholder')}
              options={providerPresets.map((p) => ({
                value: p.id,
                label: getTranslatedProviderName(p.id, p.name),
              }))}
            />
          </Form.Item>
        )}

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

        <Divider orientation="left" style={{ fontSize: 13, margin: '12px 0' }}>
          {t('provider.fields.paramsSection')}
        </Divider>
        <div className={styles.sectionHint}>
          {t('provider.fields.paramsHint')}
        </div>

        <div className={styles.fieldGrid}>
          <Form.Item label={t('provider.fields.temperature')} name="temperature">
            <InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} placeholder={t('provider.fields.paramDefault')} disabled={readOnly} />
          </Form.Item>
          <Form.Item label={t('provider.fields.topP')} name="topP">
            <InputNumber min={0} max={1} step={0.05} style={{ width: '100%' }} placeholder={t('provider.fields.paramDefault')} disabled={readOnly} />
          </Form.Item>
          <Form.Item label={t('provider.fields.topK')} name="topK">
            <InputNumber min={0} step={1} precision={0} style={{ width: '100%' }} placeholder={t('provider.fields.paramDefault')} disabled={readOnly} />
          </Form.Item>
          <Form.Item label={t('provider.fields.maxTokens')} name="maxTokens">
            <InputNumber min={1} step={1} precision={0} style={{ width: '100%' }} placeholder={t('provider.fields.paramDefault')} disabled={readOnly} />
          </Form.Item>
          <Form.Item label={t('provider.fields.frequencyPenalty')} name="frequencyPenalty">
            <InputNumber min={-2} max={2} step={0.1} style={{ width: '100%' }} placeholder={t('provider.fields.paramDefault')} disabled={readOnly} />
          </Form.Item>
          <Form.Item label={t('provider.fields.presencePenalty')} name="presencePenalty">
            <InputNumber min={-2} max={2} step={0.1} style={{ width: '100%' }} placeholder={t('provider.fields.paramDefault')} disabled={readOnly} />
          </Form.Item>
        </div>

        <Form.Item
          label={t('provider.fields.customParams')}
          name="customParams"
          extra={<span style={{ fontSize: 11, opacity: 0.6 }}>{t('provider.fields.customParamsHint')}</span>}
          rules={[
            {
              validator: (_rule, value: string) => {
                const trimmed = (value || '').trim();
                if (!trimmed) return Promise.resolve();
                try {
                  const parsed = JSON.parse(trimmed);
                  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    return Promise.reject(new Error(t('provider.fields.customParamsInvalid')));
                  }
                  return Promise.resolve();
                } catch {
                  return Promise.reject(new Error(t('provider.fields.customParamsInvalid')));
                }
              },
            },
          ]}
        >
          <Input.TextArea
            autoSize={{ minRows: 2, maxRows: 8 }}
            placeholder={'{\n  "repetition_penalty": 1.1\n}'}
            disabled={readOnly}
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          />
        </Form.Item>

        <Divider orientation="left" style={{ fontSize: 13, margin: '12px 0' }}>
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

        <div className={styles.testRow}>
          <Button
            icon={<Zap size={14} />}
            loading={testing}
            onClick={handleTest}
            disabled={readOnly && !providerId}
          >
            {t('provider.fields.testConnection')}
          </Button>
        </div>
      </Form>
    </Drawer>
  );
};
