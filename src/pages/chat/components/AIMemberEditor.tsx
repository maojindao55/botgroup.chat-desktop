import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Drawer, Form, Input, Select, Radio, Checkbox, InputNumber, Button, Space, Divider, Switch, Tooltip } from 'antd';
import { createStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';
import { useAIMemberStore } from '@/store/aiMemberStore';
import { useProviderStore } from '@/store/providerStore';
import type { AIMember, LLMMember, AgentMember_v2, CLIMember } from '@/config/aiMembers';
import { AvatarPicker } from './AvatarPicker';
import { TagPicker } from './TagPicker';
import { DryRunModal, type DryRunParams } from './DryRunModal';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { resolveCLIExecutors, useCLIExecutorStore } from '@/store/cliExecutorStore';
import { brandPrimaryButtonProps } from '@/lib/theme';

const useStyles = createStyles(({ token, css }) => ({
  form: css`
    padding: 16px 20px 24px;

    .ant-form-item {
      margin-bottom: 14px;
    }
  `,
  fieldGrid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 12px;

    @media (max-width: 560px) {
      grid-template-columns: 1fr;
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

const BUILTIN_TOOLS = [
  { name: 'web_search' },
  { name: 'code_interpreter' },
  { name: 'http_request' },
  { name: 'memory' },
];

interface AIMemberEditorProps {
  open: boolean;
  memberId?: string;
  defaultKind?: 'llm' | 'agent' | 'cli';
  onClose: () => void;
  onSave?: (savedKind: 'llm' | 'agent' | 'cli') => void;
}

export const AIMemberEditor: React.FC<AIMemberEditorProps> = ({
  open,
  memberId,
  defaultKind = 'llm',
  onClose,
  onSave,
}) => {
  const { styles } = useStyles();
  const { t } = useTranslation(['editor', 'common']);
  const [form] = Form.useForm();
  const { get, upsert } = useAIMemberStore();
  const { providers: providersRecord, load: loadProviders } = useProviderStore();
  const executorOverrides = useCLIExecutorStore((state) => state.overrides);
  const executors = useMemo(() => resolveCLIExecutors(executorOverrides), [executorOverrides]);
  const kind = Form.useWatch('kind', form) || defaultKind;
  const showLegacyAgentKind = !!memberId && kind === 'agent';
  const providerId = Form.useWatch('providerId', form);
  const model = Form.useWatch('model', form);
  const name = Form.useWatch('name', form);
  const customPrompt = Form.useWatch('customPrompt', form);
  const systemPrompt = Form.useWatch('systemPrompt', form);
  const temperature = Form.useWatch('temperature', form);
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
          const base: Record<string, unknown> = {
            kind: member.kind,
            name: member.name,
            avatar: member.avatar,
            description: member.description,
            tags: member.tags,
            enabled: member.enabled !== false,
          };
          if (member.kind === 'llm') {
            form.setFieldsValue({
              ...base,
              providerId: member.providerId,
              model: member.model,
              schedulerTag: member.schedulerTag,
              customPrompt: member.customPrompt,
              stages: member.stages,
            });
          } else if (member.kind === 'agent') {
            form.setFieldsValue({
              ...base,
              role: member.role,
              systemPrompt: member.systemPrompt,
              providerId: member.providerId,
              model: member.model,
              temperature: member.temperature,
              maxTurns: member.maxTurns,
              tools: member.tools?.filter((tool) => tool.enabled).map((tool) => tool.name) || [],
            });
          } else {
            form.setFieldsValue({
              ...base,
              cliAdapter: member.cli?.adapter ?? 'codex',
              cliBinary: member.cli?.binary ?? '',
              cliExtraArgs: member.cli?.extraArgs ?? [],
              cliApprovalMode: member.cli?.approvalMode ?? 'ask',
              cliShowStderr: member.cli?.showStderr !== false,
              cliWsl: member.cli?.wsl === true,
              cliWslDistro: member.cli?.wslDistro ?? '',
            });
          }
        }
      } else {
        // Pre-generate a stable ID for the new member
        pendingIdRef.current = `${defaultKind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        form.resetFields();
        const defaultProvider = providers[0];
        form.setFieldsValue({
          kind: defaultKind,
          source: 'user',
          enabled: true,
          providerId: defaultProvider?.id,
          model: defaultProvider?.models?.[0],
          temperature: 0.7,
          maxTurns: 5,
          tools: [],
          cliAdapter: 'codex',
          cliApprovalMode: 'ask',
          cliShowStderr: true,
          cliWsl: false,
          cliWslDistro: '',
        });
      }
    }
  }, [open, memberId, defaultKind, form, get, providers]);

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
    const id = memberId || pendingIdRef.current || `${values.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const baseData = {
      id,
      name: values.name as string,
      avatar: (values.avatar as string) || '',
      description: (values.description as string) || '',
      tags: values.kind === 'llm' ? ((values.tags as string[]) || []) : [],
      source: (memberId ? get(memberId)?.source : 'user') || 'user',
      enabled: values.enabled !== false,
    };

    let updatedMember: AIMember;

    if (values.kind === 'llm') {
      updatedMember = {
        ...baseData,
        kind: 'llm',
        providerId: values.providerId as string,
        model: values.model as string,
        schedulerTag: (values.schedulerTag as string) || undefined,
        customPrompt: (values.customPrompt as string) || '',
        stages: (values.stages as LLMMember['stages']) || [],
      } as LLMMember;
    } else if (values.kind === 'agent') {
      const selectedTools = (values.tools as string[]) || [];
      const toolConfigs = BUILTIN_TOOLS.map((tool) => ({
        name: tool.name,
        description: t(`member.tools.${tool.name}`),
        enabled: selectedTools.includes(tool.name),
      }));

      updatedMember = {
        ...baseData,
        kind: 'agent',
        role: (values.role as string) || '',
        systemPrompt: (values.systemPrompt as string) || '',
        providerId: values.providerId as string,
        model: values.model as string,
        tools: toolConfigs,
        maxTurns: (values.maxTurns as number) || 5,
        temperature: (values.temperature as number) || 0.7,
      } as AgentMember_v2;
    } else {
      updatedMember = {
        ...baseData,
        kind: 'cli',
        cli: {
          adapter: (values.cliAdapter as CLIMember['cli']['adapter']) || 'codex',
          binary: (values.cliBinary as string) || undefined,
          extraArgs: (values.cliExtraArgs as string[]) || [],
          approvalMode: (values.cliApprovalMode as 'auto' | 'ask') || 'ask',
          showStderr: values.cliShowStderr !== false,
          wsl: values.cliWsl === true,
          wslDistro: (values.cliWslDistro as string)?.trim() || undefined,
        },
      } as CLIMember;
    }

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

  const dryRunParams: DryRunParams | null =
    kind === 'llm' || kind === 'agent'
      ? {
          kind,
          name: name || t('member.dryRunName'),
          providerId: providerId || '',
          model: model || '',
          systemPrompt: (kind === 'llm' ? customPrompt : systemPrompt) || '',
          temperature: temperature ?? 0.7,
        }
      : null;

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
              {(kind === 'llm' || kind === 'agent') && (
                <Button onClick={() => setDryRunOpen(true)}>
                  {t('member.dryRun')}
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
          <Form.Item label={t('member.fields.kind')} name="kind">
            <Radio.Group disabled={!!memberId}>
              <Radio.Button value="llm">{t('member.kinds.llm')}</Radio.Button>
              {showLegacyAgentKind && (
                <Radio.Button value="agent">{t('member.kinds.agent')}</Radio.Button>
              )}
              <Radio.Button value="cli">{t('member.kinds.cli')}</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item label={t('member.fields.name')} name="name" rules={[{ required: true, message: t('member.fields.nameRequired') }]}>
            <Input placeholder={t('member.fields.namePlaceholder')} />
          </Form.Item>

          <Form.Item label={t('member.fields.avatar')} name="avatar">
            <AvatarPicker />
          </Form.Item>

          <Form.Item label={t('member.fields.description')} name="description">
            <Input.TextArea autoSize={{ minRows: 2 }} placeholder={t('member.fields.descriptionPlaceholder')} />
          </Form.Item>

          {kind === 'llm' && (
            <Form.Item label={t('member.fields.tags')} name="tags">
              <TagPicker />
            </Form.Item>
          )}

          <Divider style={{ margin: '16px 0' }} />

          {kind === 'llm' && (
            <>
              {providerSelect}

              <Form.Item
                label={
                  <Tooltip title={t('member.fields.schedulerTagTooltip')}>
                    <span>{t('member.fields.schedulerTag')}</span>
                  </Tooltip>
                }
                name="schedulerTag"
              >
                <Input placeholder={t('member.fields.schedulerTagPlaceholder')} />
              </Form.Item>

              <Form.Item
                label={t('member.fields.systemPrompt')}
                name="customPrompt"
                extra={<span style={{ fontSize: 11, opacity: 0.6 }}>{t('member.fields.promptPlaceholderHint')}</span>}
              >
                <Input.TextArea autoSize={{ minRows: 3, maxRows: 10 }} placeholder={t('member.fields.systemPromptPlaceholder')} />
              </Form.Item>

              <Form.Item label={t('member.fields.gameStages')} style={{ marginBottom: 0 }}>
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
            </>
          )}

          {kind === 'agent' && (
            <>
              <Form.Item label={t('member.fields.agentRole')} name="role">
                <Input placeholder={t('member.fields.agentRolePlaceholder')} />
              </Form.Item>

              <Form.Item
                label={t('member.fields.agentSystemPrompt')}
                name="systemPrompt"
                extra={<span style={{ fontSize: 11, opacity: 0.6 }}>{t('member.fields.promptPlaceholderHint')}</span>}
              >
                <Input.TextArea autoSize={{ minRows: 4 }} placeholder={t('member.fields.agentSystemPromptPlaceholder')} />
              </Form.Item>

              <Divider orientation="left" style={{ fontSize: 13, margin: '12px 0' }}>
                {t('member.fields.llmConfigSection')}
              </Divider>

              {providerSelect}

              <Divider orientation="left" style={{ fontSize: 13, margin: '12px 0' }}>
                {t('member.fields.paramsToolsSection')}
              </Divider>

              <div className={styles.fieldGrid}>
                <Form.Item label="Temperature" name="temperature">
                  <InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label={t('member.fields.maxTurns')} name="maxTurns">
                  <InputNumber min={1} max={20} style={{ width: '100%' }} />
                </Form.Item>
              </div>

              <Form.Item label={t('member.fields.enabledTools')} name="tools">
                <Checkbox.Group style={{ width: '100%' }}>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {BUILTIN_TOOLS.map((tool) => (
                      <Checkbox key={tool.name} value={tool.name}>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{tool.name}</span>
                        <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 8 }}>
                          {t(`member.tools.${tool.name}`)}
                        </span>
                      </Checkbox>
                    ))}
                  </Space>
                </Checkbox.Group>
              </Form.Item>
            </>
          )}

          {kind === 'cli' && (
            <>
              <Form.Item label={t('member.fields.cliAdapter')} name="cliAdapter" rules={[{ required: true, message: t('member.fields.cliAdapterRequired') }]}>
                <Select placeholder={t('member.fields.cliAdapterPlaceholder')}>
                  {executors.filter((executor) => executor.enabled).map((adapter) => (
                    <Select.Option key={adapter.id} value={adapter.id}>
                      {adapter.label}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item label={t('member.fields.cliBinary')} name="cliBinary">
                <Input placeholder={t('member.fields.cliBinaryPlaceholder')} />
              </Form.Item>

              <Form.Item label={t('member.fields.cliExtraArgs')} name="cliExtraArgs">
                <Select mode="tags" placeholder={t('member.fields.cliExtraArgsPlaceholder')} tokenSeparators={[' ']} />
              </Form.Item>

              <Form.Item label={t('member.fields.cliApproval')} name="cliApprovalMode">
                <Radio.Group>
                  <Radio value="ask">{t('member.fields.cliApprovalAsk')}</Radio>
                  <Radio value="auto">{t('member.fields.cliApprovalAuto')}</Radio>
                </Radio.Group>
              </Form.Item>

              <Form.Item label={t('member.fields.cliStderr')} name="cliShowStderr" valuePropName="checked">
                <Switch checkedChildren={t('member.fields.cliStderrShow')} unCheckedChildren={t('member.fields.cliStderrHide')} />
              </Form.Item>

              <Form.Item
                label={t('member.fields.cliWsl')}
                name="cliWsl"
                valuePropName="checked"
                tooltip={t('member.fields.cliWslHint')}
              >
                <Switch checkedChildren={t('member.fields.cliWslOn')} unCheckedChildren={t('member.fields.cliWslOff')} />
              </Form.Item>

              <Form.Item noStyle shouldUpdate={(prev, cur) => prev.cliWsl !== cur.cliWsl}>
                {({ getFieldValue }) =>
                  getFieldValue('cliWsl') ? (
                    <Form.Item label={t('member.fields.cliWslDistro')} name="cliWslDistro">
                      <Input placeholder={t('member.fields.cliWslDistroPlaceholder')} />
                    </Form.Item>
                  ) : null
                }
              </Form.Item>
            </>
          )}
        </Form>
      </Drawer>
      <DryRunModal open={dryRunOpen} onClose={() => setDryRunOpen(false)} params={dryRunParams} />
    </>
  );
};
