import React, { useEffect, useMemo, useState } from 'react';
import { Drawer, Form, Input, Select, Radio, Checkbox, InputNumber, Button, Space, Divider, Switch, Tooltip } from 'antd';
import { useAIMemberStore } from '@/store/aiMemberStore';
import { useProviderStore } from '@/store/providerStore';
import type { AIMember, LLMMember, AgentMember_v2, CLIMember } from '@/config/aiMembers';
import { AvatarPicker } from './AvatarPicker';
import { TagPicker } from './TagPicker';
import { DryRunModal, type DryRunParams } from './DryRunModal';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const AVAILABLE_TOOLS = [
  { name: 'web_search', description: '联网搜索获取实时信息' },
  { name: 'code_interpreter', description: '执行代码片段并返回结果' },
  { name: 'http_request', description: '发起 HTTP 请求调用外部 API' },
  { name: 'memory', description: '存储和召回上下文信息' },
];

const PROMPT_PLACEHOLDER_HINT = '可用占位符：{{groupName}} {{aiName}} {{date}} {{time}} {{userName}}';

interface AIMemberEditorProps {
  open: boolean;
  memberId?: string;
  defaultKind?: 'llm' | 'agent' | 'cli';
  onClose: () => void;
  onSave?: () => void;
}

export const AIMemberEditor: React.FC<AIMemberEditorProps> = ({
  open,
  memberId,
  defaultKind = 'llm',
  onClose,
  onSave,
}) => {
  const [form] = Form.useForm();
  const { get, upsert } = useAIMemberStore();
  const { providers: providersRecord, load: loadProviders } = useProviderStore();
  const kind = Form.useWatch('kind', form) || defaultKind;
  const providerId = Form.useWatch('providerId', form);
  const model = Form.useWatch('model', form);
  const name = Form.useWatch('name', form);
  const customPrompt = Form.useWatch('customPrompt', form);
  const systemPrompt = Form.useWatch('systemPrompt', form);
  const temperature = Form.useWatch('temperature', form);
  const [dryRunOpen, setDryRunOpen] = useState(false);

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
      if (memberId) {
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
              tools: member.tools?.filter((t) => t.enabled).map((t) => t.name) || [],
            });
          } else {
            form.setFieldsValue({
              ...base,
              cliAdapter: member.cli?.adapter ?? 'codex',
              cliBinary: member.cli?.binary ?? '',
              cliExtraArgs: member.cli?.extraArgs ?? [],
              cliApprovalMode: member.cli?.approvalMode ?? 'ask',
              cliShowStderr: member.cli?.showStderr !== false,
            });
          }
        }
      } else {
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
    const id = memberId || `${values.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const baseData = {
      id,
      name: values.name as string,
      avatar: (values.avatar as string) || '',
      description: (values.description as string) || '',
      tags: (values.tags as string[]) || [],
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
      const toolConfigs = AVAILABLE_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        enabled: selectedTools.includes(t.name),
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
        },
      } as CLIMember;
    }

    try {
      await upsert(updatedMember);
      onClose();
      onSave?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    }
  };

  const dryRunParams: DryRunParams | null =
    kind === 'llm' || kind === 'agent'
      ? {
          kind,
          name: name || '试运行',
          providerId: providerId || '',
          model: model || '',
          systemPrompt: (kind === 'llm' ? customPrompt : systemPrompt) || '',
          temperature: temperature ?? 0.7,
        }
      : null;

  const providerSelect = (
    <>
      <Form.Item
        label="模型服务 (Provider)"
        name="providerId"
        rules={[{ required: true, message: '请选择 Provider' }]}
        extra={providerId?.startsWith('unmapped-') ? '⚠️ 未绑定 Provider，请重新选择' : undefined}
      >
        <Select placeholder="选择模型服务" onChange={handleProviderChange}>
          {providers.map((p) => (
            <Select.Option key={p.id} value={p.id}>
              {p.name}
              {p.source === 'builtin' ? ' (内置)' : ''}
            </Select.Option>
          ))}
        </Select>
      </Form.Item>

      <Form.Item
        label="模型 (Model)"
        name="model"
        rules={[{ required: true, message: '请选择模型' }]}
      >
        <Select placeholder="选择模型" disabled={!providerId}>
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
    <Drawer
      title={memberId ? '编辑群员' : '新建群员'}
      width={460}
      open={open}
      onClose={onClose}
      destroyOnClose
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" onClick={() => form.submit()}>
            保存
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" onFinish={handleFinish}>
        <Form.Item label="群员类型" name="kind">
          <Radio.Group disabled={!!memberId}>
            <Radio.Button value="llm">LLM 角色</Radio.Button>
            <Radio.Button value="agent">Agent</Radio.Button>
            <Radio.Button value="cli">CLI Agent</Radio.Button>
          </Radio.Group>
        </Form.Item>

        <Form.Item label="群员名称" name="name" rules={[{ required: true, message: '请输入群员名称' }]}>
          <Input placeholder="名称" />
        </Form.Item>

        <Form.Item label="头像" name="avatar">
          <AvatarPicker />
        </Form.Item>

        <Form.Item label="描述" name="description">
          <Input.TextArea autoSize={{ minRows: 2 }} placeholder="描述该群员的功能或定位" />
        </Form.Item>

        <Form.Item label="标签" name="tags">
          <TagPicker />
        </Form.Item>

        <Divider style={{ margin: '16px 0' }} />

        {kind === 'llm' && (
          <>
            {providerSelect}

            <Form.Item
              label={
                <Tooltip title="仅供消息调度分类，不影响运行；可留空">
                  <span>调度标签（高级）</span>
                </Tooltip>
              }
              name="schedulerTag"
            >
              <Input placeholder="例如：SpyMaster, qianwen（可选）" />
            </Form.Item>

            <Form.Item
              label="自定义提示词 (System Prompt)"
              name="customPrompt"
              extra={<span style={{ fontSize: 11, opacity: 0.6 }}>{PROMPT_PLACEHOLDER_HINT}</span>}
            >
              <Input.TextArea autoSize={{ minRows: 3, maxRows: 10 }} placeholder="定义该角色的 System Prompt" />
            </Form.Item>

            <Form.Item label="游戏阶段提示词 (可选)" style={{ marginBottom: 0 }}>
              <Form.List name="stages">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map(({ key, name, ...restField }) => (
                      <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                        <Form.Item
                          {...restField}
                          name={[name, 'name']}
                          rules={[{ required: true, message: '阶段名' }]}
                          style={{ marginBottom: 0 }}
                        >
                          <Input placeholder="阶段名" style={{ width: 100 }} />
                        </Form.Item>
                        <Form.Item
                          {...restField}
                          name={[name, 'prompt']}
                          rules={[{ required: true, message: '提示词' }]}
                          style={{ marginBottom: 0 }}
                        >
                          <Input.TextArea autoSize placeholder="该阶段下的 prompt" style={{ width: 240 }} />
                        </Form.Item>
                        <Button type="text" danger icon={<Trash2 size={16} />} onClick={() => remove(name)} />
                      </Space>
                    ))}
                    <Form.Item>
                      <Button type="dashed" onClick={() => add()} block icon={<Plus size={14} />}>
                        添加阶段提示词
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
            <Form.Item label="角色定位 (Role)" name="role">
              <Input placeholder="例如：负责需求分析、方案评审、用户体验把控" />
            </Form.Item>

            <Form.Item
              label="系统设定 (System Prompt)"
              name="systemPrompt"
              extra={<span style={{ fontSize: 11, opacity: 0.6 }}>{PROMPT_PLACEHOLDER_HINT}</span>}
            >
              <Input.TextArea autoSize={{ minRows: 4 }} placeholder="详细定义 Agent 的人格、知识背景和输出风格" />
            </Form.Item>

            <Divider orientation={'left' as const} style={{ fontSize: 13, margin: '12px 0' }}>
              大模型配置
            </Divider>

            {providerSelect}

            <Divider orientation={'left' as const} style={{ fontSize: 13, margin: '12px 0' }}>
              参数与工具
            </Divider>

            <div style={{ display: 'flex', gap: 16 }}>
              <Form.Item label="Temperature" name="temperature" style={{ flex: 1 }}>
                <InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="最大思考轮数" name="maxTurns" style={{ flex: 1 }}>
                <InputNumber min={1} max={20} style={{ width: '100%' }} />
              </Form.Item>
            </div>

            <Form.Item label="启用工具" name="tools">
              <Checkbox.Group style={{ width: '100%' }}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  {AVAILABLE_TOOLS.map((t) => (
                    <Checkbox key={t.name} value={t.name}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{t.name}</span>
                      <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 8 }}>{t.description}</span>
                    </Checkbox>
                  ))}
                </Space>
              </Checkbox.Group>
            </Form.Item>
          </>
        )}

        {kind === 'cli' && (
          <>
            <Form.Item label="CLI 适配器类型 (Adapter)" name="cliAdapter" rules={[{ required: true, message: '请选择适配器' }]}>
              <Select placeholder="选择适配器">
                <Select.Option value="codex">Codex (自研编码 Agent)</Select.Option>
                <Select.Option value="claude">ClaudeCode (Claude 官方 CLI)</Select.Option>
                <Select.Option value="opencode">OpenCode (开源通用编码)</Select.Option>
                <Select.Option value="aider">Aider (开源 Aider 编码器)</Select.Option>
                <Select.Option value="gemini">Gemini CLI</Select.Option>
                <Select.Option value="generic">Generic (通用 Shell)</Select.Option>
              </Select>
            </Form.Item>

            <Form.Item label="可执行路径 (Binary Path)" name="cliBinary">
              <Input placeholder="不填则使用系统全局安装命令 (如 `claudecode`, `aider` 等)" />
            </Form.Item>

            <Form.Item label="额外运行参数 (Extra Args)" name="cliExtraArgs">
              <Select mode="tags" placeholder="在命令行后添加的参数" tokenSeparators={[' ']} />
            </Form.Item>

            <Form.Item label="自动执行审批" name="cliApprovalMode">
              <Radio.Group>
                <Radio value="ask">人工确认审批 (推荐)</Radio>
                <Radio value="auto">完全自动运行 (高危)</Radio>
              </Radio.Group>
            </Form.Item>

            <Form.Item label="输出错误日志 (Stderr)" name="cliShowStderr" valuePropName="checked">
              <Switch checkedChildren="显示" unCheckedChildren="隐藏" />
            </Form.Item>
          </>
        )}
        {(kind === 'llm' || kind === 'agent') && (
          <Button block style={{ marginTop: 8 }} onClick={() => setDryRunOpen(true)}>
            试运行一句
          </Button>
        )}
      </Form>
      <DryRunModal open={dryRunOpen} onClose={() => setDryRunOpen(false)} params={dryRunParams} />
    </Drawer>
  );
};
