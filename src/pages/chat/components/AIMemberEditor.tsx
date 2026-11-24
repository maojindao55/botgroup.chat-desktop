import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Drawer, Form, Input, Select, Button, Divider } from 'antd';
import { createStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';
import { useAIMemberStore } from '@/store/aiMemberStore';
import { useProviderStore } from '@/store/providerStore';
import type { LLMMember } from '@/config/aiMembers';
import { AvatarPicker } from './AvatarPicker';
import { fieldLabel } from './FieldHelp';
import { TagPicker } from './TagPicker';
import { DryRunModal, type DryRunParams } from './DryRunModal';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { brandPrimaryButtonProps } from '@/lib/theme';

const useStyles = createStyles(({ token, css }) => ({
  form: css`
    padding: 16px 20px 24px;

    .ant-form-item {
      margin-bottom: 14px;
    }
  `,
  stageRow: css`
    display: grid;
    grid-template-columns: 112px minmax(0, 1fr) 32px;
    align-items: start;
    gap: 8px;
    margin-bottom: 8px;

    @media (max-width: 560px) {
      grid-template-columns: 1fr 32px;
    }
  `,
  stagePrompt: css`
    @media (max-width: 560px) {
      grid-column: 1 / -1;
      grid-row: 2;
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
  footerLeft: css`
    min-width: 0;
  `,
}));

interface AIMemberEditorProps {
  open: boolean;
  memberId?: string;
  onClose: () => void;
  onSave?: (savedKind: 'llm') => void;
}

export const AIMemberEditor: React.FC<AIMemberEditorProps> = ({
  open,
  memberId,
  onClose,
  onSave,
}) => {
  const { styles } = useStyles();
  const { t } = useTranslation(['editor', 'common']);
  const [form] = Form.useForm();
  const { get, upsert } = useAIMemberStore();
  const { providers: providersRecord, load: loadProviders } = useProviderStore();
  const providerId = Form.useWatch('providerId', form);
  const model = Form.useWatch('model', form);
  const name = Form.useWatch('name', form);
  const customPrompt = Form.useWatch('customPrompt', form);
  const [dryRunOpen, setDryRunOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Synchronous lock to prevent double-click races on Save.
  // React state updates (`saving`) are async, so two rapid clicks can both
  // enter the handler before the button becomes disabled; the ref does not.
  const submittingRef = useRef(false);
  // Pre-generated stable ID for new members — avoids creating duplicates when
  // handleFinish is invoked more than once (native form submit via Enter key +
  // programmatic form.submit(), React StrictMode double-fire, etc.).
  const pendingIdRef = useRef<string>('');

  const providers = useMemo(
    () => Object.values(providersRecord).filter((p) => p.enabled !== false),
    [providersRecord],
  );
  const selectedProvider = providers.find((p) => p.id === providerId);
  const modelOptions = selectedProvider?.models ?? [];

  useEffect(() => {
    if (open) loadProviders();
  }, [open, loadProviders]);

  useEffect(() => {
    if (open) {
      // Reset submission lock whenever the drawer opens
      submittingRef.current = false;
      if (memberId) {
        pendingIdRef.current = '';
        const member = get(memberId);
        if (member) {
          form.setFieldsValue({
            name: member.name,
            avatar: member.avatar,
            description: member.description,
            tags: member.tags,
            enabled: member.enabled !== false,
            providerId: member.providerId,
            model: member.model,
            schedulerTag: member.schedulerTag,
            customPrompt: member.customPrompt,
            stages: member.stages,
          });
        }
      } else {
        // Pre-generate a stable ID for the new member
        pendingIdRef.current = `llm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        form.resetFields();
        const defaultProvider = providers[0];
        form.setFieldsValue({
          source: 'user',
          enabled: true,
          providerId: defaultProvider?.id,
          model: defaultProvider?.models?.[0],
        });
      }
    }
  }, [open, memberId, form, get, providers]);

  const handleProviderChange = (nextProviderId: string) => {
    const provider = providers.find((p) => p.id === nextProviderId);
    const currentModel = form.getFieldValue('model');
    if (provider && (!currentModel || !provider.models.includes(currentModel))) {
      form.setFieldValue('model', provider.models[0] ?? undefined);
    }
  };

  const handleFinish = async (values: Record<string, unknown>) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    // Use the pre-generated stable ID (or memberId for edits).
    // This guarantees idempotent upsert even if onFinish fires twice.
    const id = memberId || pendingIdRef.current || `llm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const updatedMember: LLMMember = {
      id,
      kind: 'llm',
      name: values.name as string,
      avatar: (values.avatar as string) || '',
      description: (values.description as string) || '',
      tags: (values.tags as string[]) || [],
      source: (memberId ? get(memberId)?.source : 'user') || 'user',
      enabled: values.enabled !== false,
      providerId: values.providerId as string,
      model: values.model as string,
      schedulerTag: (values.schedulerTag as string) || undefined,
      customPrompt: (values.customPrompt as string) || '',
      stages: (values.stages as LLMMember['stages']) || [],
    };

    try {
      await upsert(updatedMember);
      onClose();
      onSave?.(updatedMember.kind);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('member.saveFailed'));
    } finally {
      setSaving(false);
      submittingRef.current = false;
    }
  };

  const dryRunParams: DryRunParams = {
    kind: 'llm',
    name: name || t('member.dryRunName'),
    providerId: providerId || '',
    model: model || '',
    systemPrompt: customPrompt || '',
  };

  const providerSelect = (
    <>
      <Form.Item
        label={t('member.fields.provider')}
        name="providerId"
        rules={[{ required: true, message: t('member.fields.providerRequired') }]}
        extra={providerId?.startsWith('unmapped-') ? t('member.fields.providerUnbound') : undefined}
      >
        <Select placeholder={t('member.fields.providerPlaceholder')} onChange={handleProviderChange}>
          {providers.map((p) => (
            <Select.Option key={p.id} value={p.id}>
              {p.name}
              {p.source === 'builtin' ? t('member.fields.providerBuiltinSuffix') : ''}
            </Select.Option>
          ))}
        </Select>
      </Form.Item>

      <Form.Item
        label={t('member.fields.model')}
        name="model"
        rules={[{ required: true, message: t('member.fields.modelRequired') }]}
      >
        <Select placeholder={t('member.fields.modelPlaceholder')} disabled={!providerId}>
          {modelOptions.map((m) => (
            <Select.Option key={m} value={m}>
              {m}
            </Select.Option>
          ))}
        </Select>
      </Form.Item>
    </>
  );

  return (
    <>
      <Drawer
        title={memberId ? t('member.titleEdit') : t('member.titleCreate')}
        width={540}
        open={open}
        onClose={onClose}
        destroyOnClose
        footer={
          <div className={styles.drawerFooter}>
            <div className={styles.footerLeft}>
              <Button onClick={() => setDryRunOpen(true)}>
                {t('member.dryRun')}
              </Button>
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
          <Form.Item label={t('member.fields.name')} name="name" rules={[{ required: true, message: t('member.fields.nameRequired') }]}>
            <Input placeholder={t('member.fields.namePlaceholder')} />
          </Form.Item>

          <Form.Item label={t('member.fields.avatar')} name="avatar">
            <AvatarPicker />
          </Form.Item>

          <Form.Item label={t('member.fields.description')} name="description">
            <Input.TextArea autoSize={{ minRows: 2 }} placeholder={t('member.fields.descriptionPlaceholder')} />
          </Form.Item>

          <Form.Item label={t('member.fields.tags')} name="tags">
            <TagPicker />
          </Form.Item>

          <Divider style={{ margin: '16px 0' }} />

          {providerSelect}

          <Form.Item
            label={fieldLabel(t('member.fields.schedulerTag'), t('member.fields.schedulerTagTooltip'))}
            name="schedulerTag"
          >
            <Input placeholder={t('member.fields.schedulerTagPlaceholder')} />
          </Form.Item>

          <Form.Item
            label={fieldLabel(t('member.fields.systemPrompt'), t('member.fields.systemPromptHint'))}
            name="customPrompt"
            extra={<span style={{ fontSize: 11, opacity: 0.6 }}>{t('member.fields.promptPlaceholderHint')}</span>}
          >
            <Input.TextArea autoSize={{ minRows: 3, maxRows: 10 }} placeholder={t('member.fields.systemPromptPlaceholder')} />
          </Form.Item>

          <Form.Item
            label={fieldLabel(t('member.fields.gameStages'), t('member.fields.gameStagesHint'))}
            style={{ marginBottom: 0 }}
          >
            <Form.List name="stages">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <div key={key} className={styles.stageRow}>
                      <Form.Item
                        {...restField}
                        name={[name, 'name']}
                        rules={[{ required: true, message: t('member.fields.stageNameRequired') }]}
                        style={{ marginBottom: 0 }}
                      >
                        <Input placeholder={t('member.fields.stageName')} />
                      </Form.Item>
                      <Form.Item
                        {...restField}
                        name={[name, 'prompt']}
                        rules={[{ required: true, message: t('member.fields.stagePromptRequired') }]}
                        className={styles.stagePrompt}
                        style={{ marginBottom: 0 }}
                      >
                        <Input.TextArea autoSize placeholder={t('member.fields.stagePromptPlaceholder')} />
                      </Form.Item>
                      <Button type="text" danger icon={<Trash2 size={16} />} onClick={() => remove(name)} />
                    </div>
                  ))}
                  <Form.Item>
                    <Button type="dashed" onClick={() => add()} block icon={<Plus size={14} />}>
                      {t('member.fields.addStagePrompt')}
                    </Button>
                  </Form.Item>
                </>
              )}
            </Form.List>
          </Form.Item>
        </Form>
      </Drawer>
      <DryRunModal open={dryRunOpen} onClose={() => setDryRunOpen(false)} params={dryRunParams} />
    </>
  );
};
