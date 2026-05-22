import React, { useEffect, useState } from 'react';
import { Drawer, Tabs, Input, Button, Tag, Space, Tooltip, Modal, Empty } from 'antd';
import { Avatar as LobeAvatar } from '@lobehub/ui';
import { useAIMemberStore } from '@/store/aiMemberStore';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';
import { AIMember, AIMemberKind } from '@/config/aiMembers';
import { Group } from '@/config/groups';
import { AIMemberEditor } from './AIMemberEditor';
import { Search, Plus, Edit2, Trash2, ShieldAlert, Cpu, Terminal, Users, Sparkles, X } from 'lucide-react';
import { createStyles } from 'antd-style';

/** 桌面端 inline 面板的宽度（用于 ChatUI 窗口宽度联动） */
export const AI_MEMBER_LIBRARY_INLINE_WIDTH = 680;

const useStyles = createStyles(({ token, css }) => ({
  drawerBody: css`
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 0;
  `,
  searchBar: css`
    display: flex;
    gap: 12px;
    padding: 16px 24px;
    background: ${token.colorBgContainer};
    border-bottom: 1px solid ${token.colorBorderSecondary};
    align-items: center;
  `,
  tabContainer: css`
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    .ant-tabs-nav {
      margin: 0 !important;
      padding: 0 24px;
      background: ${token.colorBgContainer};
      border-bottom: 1px solid ${token.colorBorderSecondary};
    }
    .ant-tabs-content-holder {
      flex: 1;
      overflow: auto;
      background: ${token.colorBgLayout};
    }
  `,
  listContainer: css`
    padding: 16px 24px;
  `,
  memberCard: css`
    background: ${token.colorBgContainer};
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    transition: all 0.2s ease;
    display: flex;
    gap: 16px;
    align-items: flex-start;
    &:hover {
      border-color: ${token.colorPrimaryBorderHover};
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
    }
  `,
  infoSection: css`
    flex: 1;
    min-width: 0;
  `,
  headerRow: css`
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    flex-wrap: wrap;
  `,
  name: css`
    font-size: 15px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  description: css`
    font-size: 13px;
    color: ${token.colorTextSecondary};
    margin-bottom: 8px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  `,
  tagContainer: css`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  `,
  metaDetails: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    font-size: 12px;
    color: ${token.colorTextTertiary};
    border-top: 1px dashed ${token.colorBorderSecondary};
    padding-top: 8px;
    margin-top: 8px;
  `,
  metaItem: css`
    display: flex;
    align-items: center;
    gap: 4px;
  `,
  actionColumn: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  badgeBuiltin: css`
    background: ${token.colorPrimaryBg} !important;
    color: ${token.colorPrimaryText} !important;
    border: 1px solid ${token.colorPrimaryBorder} !important;
  `,
  badgeUser: css`
    background: ${token.colorFillAlter} !important;
    color: ${token.colorTextSecondary} !important;
    border: 1px solid ${token.colorBorder} !important;
  `,
  // —— inline 模式（与 CLIGroupSettings 对齐）——
  inlinePanel: css`
    width: ${AI_MEMBER_LIBRARY_INLINE_WIDTH}px;
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
  inlineTitleWrap: css`
    display: flex;
    align-items: center;
    gap: 8px;
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
  inlineBody: css`
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  `,
}));

interface AIMemberLibraryProps {
  open: boolean;
  onClose: () => void;
  groups: Group[];
  /** 桌面端使用内联面板（与 CLI/AI/Agent 群设置一致），移动端走 Drawer */
  inline?: boolean;
}

export const AIMemberLibrary: React.FC<AIMemberLibraryProps> = ({ open, onClose, groups, inline }) => {
  const { styles } = useStyles();
  const { list, load, remove, findReferencingGroups } = useAIMemberStore();
  const [activeTab, setActiveTab] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // Editor State
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [editorKind, setEditorKind] = useState<'llm' | 'agent' | 'cli'>('llm');

  useEffect(() => {
    if (open) {
      load();
    }
  }, [open]);

  const handleCreate = (kind: 'llm' | 'agent' | 'cli') => {
    setEditingId(undefined);
    setEditorKind(kind);
    setEditorOpen(true);
  };

  const handleEdit = (member: AIMember) => {
    setEditingId(member.id);
    setEditorKind(member.kind);
    setEditorOpen(true);
  };

  const handleDelete = (member: AIMember) => {
    const referencing = findReferencingGroups(member.id, groups);
    if (referencing.length > 0) {
      Modal.confirm({
        title: '无法直接删除',
        icon: <ShieldAlert style={{ color: '#ff4d4f' }} />,
        content: (
          <div>
            <p>成员 <strong>{member.name}</strong> 正在被以下群聊使用：</p>
            <ul>
              {referencing.map(g => (
                <li key={g.id}>{g.name}</li>
              ))}
            </ul>
            <p>请先在上述群设置中移除该成员后再进行删除。</p>
          </div>
        ),
        okText: '知道了',
        cancelButtonProps: { style: { display: 'none' } }
      });
      return;
    }

    Modal.confirm({
      title: '确认删除成员？',
      content: `确定要删除成员「${member.name}」吗？此操作不可撤销。`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await remove(member.id);
      }
    });
  };

  const getKindLabel = (kind: AIMemberKind) => {
    switch (kind) {
      case 'llm':
        return { label: 'LLM 角色', icon: Cpu, color: 'blue' };
      case 'agent':
        return { label: 'Agent协作', icon: Sparkles, color: 'purple' };
      case 'cli':
        return { label: 'CLI Agent', icon: Terminal, color: 'green' };
    }
  };

  const filterAndSearch = (kind?: AIMemberKind) => {
    let members = list(kind);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      members = members.filter(m => 
        m.name.toLowerCase().includes(q) || 
        m.description?.toLowerCase().includes(q) ||
        m.tags?.some(t => t.toLowerCase().includes(q))
      );
    }
    return members.sort((a, b) => {
      // User-created first, then builtin
      if (a.source === 'user' && b.source === 'builtin') return -1;
      if (a.source === 'builtin' && b.source === 'user') return 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  };

  const renderMemberItem = (member: AIMember) => {
    const a = getAvatarData(member.name);
    const url = resolveAvatarByName(member.name, member.avatar, 48);
    const kindInfo = getKindLabel(member.kind);
    const KindIcon = kindInfo.icon;

    return (
      <div className={styles.memberCard} key={member.id}>
        <LobeAvatar
          size={48}
          avatar={url || a.text}
          background={a.backgroundColor}
          shape="circle"
          title={member.name}
          style={{ flexShrink: 0 }}
        />

        <div className={styles.infoSection}>
          <div className={styles.headerRow}>
            <span className={styles.name}>{member.name}</span>
            <Tag color={kindInfo.color} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <KindIcon size={12} />
              {kindInfo.label}
            </Tag>
            <Tag className={member.source === 'builtin' ? styles.badgeBuiltin : styles.badgeUser}>
              {member.source === 'builtin' ? '系统预设' : '自建'}
            </Tag>
            {!member.enabled && <Tag color="default">已禁用</Tag>}
          </div>

          <div className={styles.description}>
            {member.description || '暂无描述信息'}
          </div>

          {member.tags && member.tags.length > 0 && (
            <div className={styles.tagContainer}>
              {member.tags.map(t => (
                <Tag key={t} style={{ borderRadius: 4 }}>{t}</Tag>
              ))}
            </div>
          )}

          <div className={styles.metaDetails}>
            {member.kind === 'llm' && (
              <>
                <div className={styles.metaItem}>
                  <strong>模型:</strong> {member.model}
                </div>
                {member.personality && (
                  <div className={styles.metaItem}>
                    <strong>标识:</strong> {member.personality}
                  </div>
                )}
              </>
            )}
            {member.kind === 'agent' && (
              <>
                <div className={styles.metaItem}>
                  <strong>角色:</strong> {member.role || '无'}
                </div>
                <div className={styles.metaItem}>
                  <strong>模型:</strong> {member.llm?.model || '无'}
                </div>
                <div className={styles.metaItem}>
                  <strong>工具:</strong> {member.tools?.filter(t => t.enabled).length || 0} 个已启用
                </div>
              </>
            )}
            {member.kind === 'cli' && (
              <>
                <div className={styles.metaItem}>
                  <strong>执行适配器:</strong> {member.cli?.adapter}
                </div>
                {member.cli?.binary && (
                  <div className={styles.metaItem}>
                    <strong>二进制路径:</strong> {member.cli.binary}
                  </div>
                )}
                <div className={styles.metaItem}>
                  <strong>运行审批:</strong> {member.cli?.approvalMode === 'auto' ? '自动运行' : '人工审批'}
                </div>
              </>
            )}
          </div>
        </div>

        <div className={styles.actionColumn}>
          <Button 
            type="text" 
            icon={<Edit2 size={14} />} 
            onClick={() => handleEdit(member)}
            style={{ padding: '4px 8px', height: 'auto' }}
          >
            编辑
          </Button>
          {member.source !== 'builtin' ? (
            <Button 
              type="text" 
              danger 
              icon={<Trash2 size={14} />} 
              onClick={() => handleDelete(member)}
              style={{ padding: '4px 8px', height: 'auto' }}
            >
              删除
            </Button>
          ) : (
            <Tooltip title="内置预设成员无法删除">
              <Button 
                type="text" 
                disabled 
                icon={<Trash2 size={14} />} 
                style={{ padding: '4px 8px', height: 'auto', opacity: 0.4 }}
              >
                删除
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
    );
  };

  const renderTabContent = (kind?: AIMemberKind) => {
    const listData = filterAndSearch(kind);

    if (listData.length === 0) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px' }}>
          <Empty description={searchQuery ? '没有找到符合条件的成员' : '暂无群员'} />
        </div>
      );
    }

    return (
      <div className={styles.listContainer}>
        {listData.map(renderMemberItem)}
      </div>
    );
  };

  const body = (
    <div className={styles.drawerBody}>
      <div className={styles.searchBar}>
        <Input
          placeholder="搜索成员名称、描述或标签..."
          prefix={<Search size={16} style={{ opacity: 0.45 }} />}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{ flex: 1, borderRadius: 8 }}
          allowClear
        />
        <Space>
          <Button type="primary" icon={<Plus size={16} />} onClick={() => handleCreate('llm')}>
            新增 LLM 角色
          </Button>
          <Button icon={<Plus size={16} />} onClick={() => handleCreate('agent')}>
            新增 Agent
          </Button>
          <Button icon={<Plus size={16} />} onClick={() => handleCreate('cli')}>
            新增 CLI Agent
          </Button>
        </Space>
      </div>

      <div className={styles.tabContainer}>
        <Tabs activeKey={activeTab} onChange={setActiveTab}>
          <Tabs.TabPane tab="全部" key="all">
            {renderTabContent()}
          </Tabs.TabPane>
          <Tabs.TabPane tab="LLM 角色" key="llm">
            {renderTabContent('llm')}
          </Tabs.TabPane>
          <Tabs.TabPane tab="Agent 协作" key="agent">
            {renderTabContent('agent')}
          </Tabs.TabPane>
          <Tabs.TabPane tab="CLI Agent" key="cli">
            {renderTabContent('cli')}
          </Tabs.TabPane>
        </Tabs>
      </div>
    </div>
  );

  const editor = (
    <AIMemberEditor
      open={editorOpen}
      memberId={editingId}
      defaultKind={editorKind}
      onClose={() => setEditorOpen(false)}
      onSave={() => {
        load();
      }}
    />
  );

  // 桌面端：与 CLI/AI/Agent 群设置一致的右侧推入式面板
  if (inline) {
    if (!open) return editor;
    return (
      <>
        <div className={styles.inlinePanel}>
          <div className={styles.inlineHeader}>
            <span className={styles.inlineTitleWrap}>
              <Users size={18} style={{ color: '#ff6600' }} />
              AI 群员管理库
            </span>
            <button className={styles.inlineCloseBtn} onClick={onClose} aria-label="关闭群员库">
              <X size={16} />
            </button>
          </div>
          <div className={styles.inlineBody}>{body}</div>
        </div>
        {editor}
      </>
    );
  }

  // 移动端：保留 Drawer
  return (
    <>
      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={20} style={{ color: '#ff6600' }} />
            <span>AI 群员管理库</span>
          </div>
        }
        width={AI_MEMBER_LIBRARY_INLINE_WIDTH}
        open={open}
        onClose={onClose}
        styles={{ body: { padding: 0 } }}
      >
        {body}
      </Drawer>
      {editor}
    </>
  );
};
