import React, { useEffect } from 'react';
import { Drawer, Form, Input, Select, Radio, Checkbox, InputNumber, Button, Space, Divider, Switch } from 'antd';
import { useAIMemberStore } from '@/store/aiMemberStore';
import { modelConfigs } from '@/config/aiCharacters';
import type { AIMember, LLMMember, AgentMember_v2, CLIMember } from '@/config/aiMembers';
import { Plus, Trash2 } from 'lucide-react';

const AVAILABLE_TOOLS = [
  { name: 'web_search', description: '联网搜索获取实时信息' },
  { name: 'code_interpreter', description: '执行代码片段并返回结果' },
  { name: 'http_request', description: '发起 HTTP 请求调用外部 API' },
  { name: 'memory', description: '存储和召回上下文信息' },
];

interface AIMemberEditorProps {
  open: boolean;
  memberId?: string; // If present, edit mode
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
  const kind = Form.useWatch('kind', form) || defaultKind;

  useEffect(() => {
    if (open) {
      if (memberId) {
        const member = get(memberId);
        if (member) {
          form.setFieldsValue({
            ...member,
            tools: member.kind === 'agent' ? member.tools?.filter(t => t.enabled).map(t => t.name) || [] : [],
            cliAdapter: member.kind === 'cli' ? member.cli?.adapter : 'codex',
            cliBinary: member.kind === 'cli' ? member.cli?.binary : '',
            cliExtraArgs: member.kind === 'cli' ? member.cli?.extraArgs : [],
            cliApprovalMode: member.kind === 'cli' ? member.cli?.approvalMode : 'ask',
            cliShowStderr: member.kind === 'cli' ? member.cli?.showStderr !== false : true,
          });
        }
      } else {
        form.resetFields();
        form.setFieldsValue({
          kind: defaultKind,
          source: 'user',
          enabled: true,
          model: modelConfigs[0].model,
          temperature: 0.7,
          maxTurns: 5,
          tools: [],
          cliAdapter: 'codex',
          cliApprovalMode: 'ask',
          cliShowStderr: true,
        });
      }
    }
  }, [open, memberId, defaultKind]);

  const handleFinish = async (values: any) => {
    const id = memberId || `${values.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    
    let updatedMember: AIMember;

    const baseData = {
      id,
      name: values.name,
      avatar: values.avatar || '',
      description: values.description || '',
      tags: values.tags || [],
      source: (memberId ? get(memberId)?.source : 'user') || 'user',
      enabled: values.enabled !== false,
    };

    if (values.kind === 'llm') {
      updatedMember = {
        ...baseData,
        kind: 'llm',
        personality: values.personality || values.name,
        model: values.model,
        customPrompt: values.customPrompt || '',
        stages: values.stages || [],
      } as LLMMember;
    } else if (values.kind === 'agent') {
      const selectedTools = values.tools || [];
      const toolConfigs = AVAILABLE_TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        enabled: selectedTools.includes(t.name),
      }));

      updatedMember = {
        ...baseData,
        kind: 'agent',
        role: values.role || '',
        systemPrompt: values.systemPrompt || '',
        llm: {
          baseURL: values.llmBaseURL || 'https://api.deepseek.com/v1',
          apiKey: values.llmApiKey || '',
          model: values.llmModel || 'deepseek-chat',
        },
        tools: toolConfigs,
        maxTurns: values.maxTurns || 5,
        temperature: values.temperature || 0.7,
      } as AgentMember_v2;
    } else {
      updatedMember = {
        ...baseData,
        kind: 'cli',
        cli: {
          adapter: values.cliAdapter || 'codex',
          binary: values.cliBinary || undefined,
          extraArgs: values.cliExtraArgs || [],
          approvalMode: values.cliApprovalMode || 'ask',
          showStderr: values.cliShowStderr !== false,
        },
      } as CLIMember;
    }

    await upsert(updatedMember);
    onClose();
    if (onSave) onSave();
  };

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
      <Form
        form={form}
        layout="vertical"
        onFinish={handleFinish}
        initialValues={{
          kind: defaultKind,
          model: modelConfigs[0].model,
        }}
      >
        <Form.Item label="群员类型" name="kind">
          <Radio.Group disabled={!!memberId}>
            <Radio.Button value="llm">LLM 角色</Radio.Button>
            <Radio.Button value="agent">Agent</Radio.Button>
            <Radio.Button value="cli">CLI Agent</Radio.Button>
          </Radio.Group>
        </Form.Item>

        <Form.Item
          label="群员名称"
          name="name"
          rules={[{ required: true, message: '请输入群员名称' }]}
        >
          <Input placeholder="名称" />
        </Form.Item>

        <Form.Item label="头像" name="avatar">
          <Input placeholder="头像链接或内置图片名（例：/img/ds.svg）" />
        </Form.Item>

        <Form.Item label="描述" name="description">
          <Input.TextArea autoSize={{ minRows: 2 }} placeholder="描述该群员的功能或定位" />
        </Form.Item>

        <Form.Item label="标签" name="tags">
          <Select mode="tags" placeholder="添加描述标签" tokenSeparators={[',', ' ']} />
        </Form.Item>

        <Divider style={{ margin: '16px 0' }} />

        {/* Kind-specific panels */}
        {kind === 'llm' && (
          <>
            <Form.Item
              label="大模型型号"
              name="model"
              rules={[{ required: true, message: '请选择模型' }]}
            >
              <Select placeholder="选择对话模型">
                {modelConfigs.map((cfg) => (
                  <Select.Option key={cfg.model} value={cfg.model}>
                    {cfg.model}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item label="性格设定/角色标识" name="personality">
              <Input placeholder="例如：SpyMaster, qianwen" />
            </Form.Item>

            <Form.Item label="自定义提示词 (System Prompt)" name="customPrompt">
              <Input.TextArea
                autoSize={{ minRows: 3, maxRows: 10 }}
                placeholder="定义该角色的 System Prompt，支持 #groupName# 占位符"
              />
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
                        <Button
                          type="text"
                          danger
                          icon={<Trash2 size={16} />}
                          onClick={() => remove(name)}
                        />
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

            <Form.Item label="系统设定 (System Prompt)" name="systemPrompt">
              <Input.TextArea
                autoSize={{ minRows: 4 }}
                placeholder="详细定义 Agent 的人格、知识背景和输出风格"
              />
            </Form.Item>

            <Divider orientation={"left" as any} style={{ fontSize: 13, margin: '12px 0' }}>
              大模型连接配置
            </Divider>

            <Form.Item label="API 地址 (Base URL)" name="llmBaseURL">
              <Input placeholder="例如：https://api.deepseek.com/v1" />
            </Form.Item>

            <Form.Item label="模型名称 (Model)" name="llmModel">
              <Input placeholder="例如：deepseek-chat" />
            </Form.Item>

            <Form.Item label="API 密钥 (API Key)" name="llmApiKey">
              <Input.Password placeholder="API Key 字符串或本地环境变量名" />
            </Form.Item>

            <Divider orientation={"left" as any} style={{ fontSize: 13, margin: '12px 0' }}>
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
            <Form.Item
              label="CLI 适配器类型 (Adapter)"
              name="cliAdapter"
              rules={[{ required: true, message: '请选择适配器' }]}
            >
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
      </Form>
    </Drawer>
  );
};
