/**
 * Agent 群聊配置面板
 * 管理自定义 Agent 成员、LLM配置、执行策略、工具等
 */
import { useState } from 'react';
import { Drawer, Button, Input, InputNumber, Tooltip, Collapse, Checkbox } from 'antd';
import { Avatar as LobeAvatar, ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Plus, Trash2, Mic, MicOff, X } from 'lucide-react';
import type { AgentGroup, AgentMember, AgentStrategy, AgentTool } from '@/config/groups';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';

const AVAILABLE_TOOLS: AgentTool[] = [
  { name: 'web_search', description: '联网搜索获取实时信息', enabled: false },
  { name: 'code_interpreter', description: '执行代码片段并返回结果', enabled: false },
  { name: 'http_request', description: '发起 HTTP 请求调用外部 API', enabled: false },
  { name: 'memory', description: '存储和召回上下文信息', enabled: false },
];

interface AgentGroupSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: AgentGroup;
  mutedUsers: string[];
  onToggleMute: (userId: string) => void;
  onUpdateGroup: (updates: Partial<AgentGroup>) => void;
  inline?: boolean;
}

const useStyles = createStyles(({ token, css }) => ({
  scrollArea: css`
    height: calc(100vh - 80px);
    overflow: auto;
    padding-right: 8px;
  `,
  strategyGrid: css`
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  `,
  strategyBtn: css`
    padding: 8px;
    border-radius: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    background: transparent;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    transition: all 0.15s;
    text-align: center;
    color: ${token.colorText};
    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  strategyBtnActive: css`
    border-color: #ff6600;
    background: rgba(255, 102, 0, 0.08);
    color: #ff6600;
    &:hover {
      background: rgba(255, 102, 0, 0.12);
    }
  `,
  strategyDesc: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
    margin-top: 6px;
  `,
  supervisorBadge: css`
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(255, 102, 0, 0.12);
    color: #ff6600;
    font-weight: 500;
    white-space: nowrap;
  `,
  agentHeader: css`
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  `,
  llmGrid: css`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  `,
  inlinePanel: css`
    width: 440px;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: ${token.colorBgContainer};
    border-left: 1px solid ${token.colorBorderSecondary};
    flex-shrink: 0;
    z-index: 5;
  `,
  inlineHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    height: 52px;
    flex-shrink: 0;
  `,
  inlineTitle: css`
    font-size: 14px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  inlineCloseBtn: css`
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: ${token.colorTextSecondary};
    border-radius: 4px;
    transition: background 0.2s;
    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  inlineContent: css`
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  `,
}));

export const AgentGroupSettings = ({
  open,
  onOpenChange,
  group,
  mutedUsers,
  onToggleMute,
  onUpdateGroup,
  inline,
}: AgentGroupSettingsProps) => {
  const { styles, cx } = useStyles();
  const [activeAgentKeys, setActiveAgentKeys] = useState<string[]>([]);

  const updateAgent = (agentId: string, updates: Partial<AgentMember>) => {
    onUpdateGroup({
      agents: group.agents.map((a) => (a.id === agentId ? { ...a, ...updates } : a)),
    });
  };

  const addAgent = () => {
    const newAgent: AgentMember = {
      id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: '',
      role: '',
      systemPrompt: '',
      llm: { baseURL: '', apiKey: '', model: '' },
      tools: AVAILABLE_TOOLS.map((t) => ({ ...t })),
      maxTurns: 5,
      temperature: 0.7,
    };
    onUpdateGroup({ agents: [...group.agents, newAgent] });
    setActiveAgentKeys([newAgent.id]);
  };

  const removeAgent = (agentId: string) => {
    onUpdateGroup({ agents: group.agents.filter((a) => a.id !== agentId) });
  };

  const strategyOptions: { value: AgentStrategy; label: string }[] = [
    { value: 'sequential', label: '顺序执行' },
    { value: 'router', label: '意图路由' },
    { value: 'discussion', label: '全员讨论' },
    { value: 'react', label: 'ReAct' },
    { value: 'pipeline', label: '流水线' },
    { value: 'debate', label: '辩论' },
    { value: 'mapreduce', label: 'MapReduce' },
    { value: 'supervisor', label: '监督者' },
  ];

  const strategyDescriptions: Record<AgentStrategy, string> = {
    sequential: '按成员顺序依次执行，后者可看到前者的输出',
    router: '智能分析用户意图，选择最相关的 Agent 回答',
    discussion: '所有 Agent 并行回复同一消息',
    react: '协调者分析→分派任务→执行→判断是否完成→循环',
    pipeline: '按角色分工形成流水线，每阶段产出作为下一阶段输入',
    debate: '多 Agent 独立回答→互相评论→最终综合裁决',
    mapreduce: '自动拆分任务→各 Agent 并行处理→汇总合并结果',
    supervisor: '监督者分派任务→审查质量→反馈修改→直到满意',
  };

  const showCoordinatorPrompt = ['router', 'react', 'discussion', 'supervisor', 'debate', 'mapreduce'].includes(
    group.strategy,
  );

  const agentItems = group.agents.map((agent) => {
    const avatarData = getAvatarData(agent.name || 'A');
    const avatarUrl = resolveAvatarByName(agent.name || 'A', agent.avatar, 28);
    const isSupervisor = group.strategy === 'supervisor' && group.agents[0]?.id === agent.id;
    const muted = mutedUsers.includes(agent.id);

    return {
      key: agent.id,
      label: (
        <div className={styles.agentHeader}>
          <LobeAvatar
            shape="circle"
            avatar={avatarUrl || avatarData.text}
            background={avatarData.backgroundColor}
            size={28}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {agent.name || '未命名 Agent'}
              </span>
              {isSupervisor && <span className={styles.supervisorBadge}>👑 监督者</span>}
            </div>
            <div
              style={{
                fontSize: 10,
                opacity: 0.6,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {agent.role || '未设置角色'}
            </div>
          </div>
          {muted && <span style={{ fontSize: 10, color: '#ef4444' }}>禁言</span>}
          <Tooltip title={muted ? '取消禁言' : '禁言'}>
            <span
              onClick={(e) => {
                e.stopPropagation();
                onToggleMute(agent.id);
              }}
              style={{ display: 'inline-flex' }}
            >
              <ActionIcon
                icon={muted ? MicOff : Mic}
                size="small"
                style={{ color: muted ? '#ef4444' : '#22c55e' }}
                title=""
              />
            </span>
          </Tooltip>
        </div>
      ),
      children: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Input
            placeholder="Agent 名称"
            value={agent.name}
            onChange={(e) => updateAgent(agent.id, { name: e.target.value })}
          />
          <Input
            placeholder="角色定位"
            value={agent.role}
            onChange={(e) => updateAgent(agent.id, { role: e.target.value })}
          />

          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>LLM 配置</div>
          <div className={styles.llmGrid}>
            <Input
              placeholder="API 地址"
              value={agent.llm.baseURL}
              onChange={(e) =>
                updateAgent(agent.id, { llm: { ...agent.llm, baseURL: e.target.value } })
              }
            />
            <Input
              placeholder="模型名"
              value={agent.llm.model}
              onChange={(e) =>
                updateAgent(agent.id, { llm: { ...agent.llm, model: e.target.value } })
              }
            />
          </div>
          <Input.Password
            placeholder="API Key"
            value={agent.llm.apiKey}
            onChange={(e) =>
              updateAgent(agent.id, { llm: { ...agent.llm, apiKey: e.target.value } })
            }
          />

          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>System Prompt</div>
          <Input.TextArea
            autoSize={{ minRows: 3, maxRows: 8 }}
            placeholder="定义 Agent 人设和能力..."
            value={agent.systemPrompt}
            onChange={(e) => updateAgent(agent.id, { systemPrompt: e.target.value })}
          />

          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>工具能力</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {agent.tools.map((tool, tIdx) => (
              <Checkbox
                key={tool.name}
                checked={tool.enabled}
                onChange={(e) => {
                  const newTools = [...agent.tools];
                  newTools[tIdx] = { ...newTools[tIdx], enabled: e.target.checked };
                  updateAgent(agent.id, { tools: newTools });
                }}
              >
                <span style={{ fontSize: 11 }}>{tool.name}</span>
              </Checkbox>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, opacity: 0.6 }}>Temperature:</span>
              <InputNumber
                size="small"
                value={agent.temperature}
                step={0.1}
                min={0}
                max={2}
                style={{ width: 70 }}
                onChange={(v) => updateAgent(agent.id, { temperature: Number(v) })}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, opacity: 0.6 }}>MaxTurns:</span>
              <InputNumber
                size="small"
                value={agent.maxTurns}
                min={1}
                max={20}
                style={{ width: 60 }}
                onChange={(v) => updateAgent(agent.id, { maxTurns: Number(v) })}
              />
            </div>
          </div>

          <Button
            danger
            ghost
            size="small"
            icon={<Trash2 size={14} />}
            onClick={() => removeAgent(agent.id)}
            block
          >
            删除此 Agent
          </Button>
        </div>
      ),
    };
  });

  const settingsContent = (
    <div className={styles.scrollArea} style={inline ? { height: 'auto', paddingRight: 0 } : undefined}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* 执行策略 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 14, fontWeight: 500 }}>执行策略</label>
          <div className={styles.strategyGrid}>
            {strategyOptions.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => onUpdateGroup({ strategy: item.value })}
                className={cx(
                  styles.strategyBtn,
                  group.strategy === item.value && styles.strategyBtnActive,
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className={styles.strategyDesc}>{strategyDescriptions[group.strategy]}</p>
        </div>

        {/* 协调者 Prompt */}
        {showCoordinatorPrompt && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 14, fontWeight: 500 }}>协调者 Prompt</label>
            <Input.TextArea
              autoSize={{ minRows: 3, maxRows: 6 }}
              placeholder="定义协调者如何分派任务..."
              value={group.coordinatorPrompt || ''}
              onChange={(e) => onUpdateGroup({ coordinatorPrompt: e.target.value })}
            />
          </div>
        )}

        {/* 最大轮数 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap' }}>最大轮数</label>
          <InputNumber
            value={group.maxRounds}
            min={1}
            max={10}
            style={{ width: 80 }}
            onChange={(v) => onUpdateGroup({ maxRounds: Number(v) })}
          />
        </div>

        {/* Agent 成员列表 */}
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 500 }}>
              Agent 成员（{group.agents.length}）
            </span>
            <Button size="small" icon={<Plus size={14} />} onClick={addAgent}>
              添加
            </Button>
          </div>

          <Collapse
            activeKey={activeAgentKeys}
            onChange={(keys) =>
              setActiveAgentKeys(Array.isArray(keys) ? (keys as string[]) : [keys as string])
            }
            items={agentItems}
            size="small"
          />
        </div>
      </div>
    </div>
  );

  if (inline) {
    if (!open) return null;
    return (
      <div className={styles.inlinePanel}>
        <div className={styles.inlineHeader}>
          <span className={styles.inlineTitle}>Agent 群聊配置</span>
          <button className={styles.inlineCloseBtn} onClick={() => onOpenChange(false)}>
            <X size={16} />
          </button>
        </div>
        <div className={styles.inlineContent}>
          {settingsContent}
        </div>
      </div>
    );
  }

  return (
    <Drawer
      title="Agent 群聊配置"
      placement="right"
      open={open}
      onClose={() => onOpenChange(false)}
      width={440}
    >
      {settingsContent}
    </Drawer>
  );
};

export default AgentGroupSettings;
