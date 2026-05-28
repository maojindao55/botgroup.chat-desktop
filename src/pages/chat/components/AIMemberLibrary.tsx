import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Drawer, Tabs, Button, Tag, Modal, Empty } from 'antd';
import { Avatar as LobeAvatar } from '@lobehub/ui';
import { useAIMemberStore } from '@/store/aiMemberStore';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';
import { getVisibleMembers } from '@/utils/aiMemberDisplay';
import { AIMember, AIMemberKind } from '@/config/aiMembers';
import { Group } from '@/config/groups';
import { AIMemberEditor } from './AIMemberEditor';
import { ProviderLibrary } from './ProviderLibrary';
import { ProviderEditor } from './ProviderEditor';
import { useProviderStore } from '@/store/providerStore';
import type { Provider } from '@/config/providers';
import { Plus, Edit2, Trash2, ShieldAlert, Cpu, Terminal, Users, Sparkles, X, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { createStyles } from 'antd-style';

/** 桌面端 inline 面板的宽度（用于 ChatUI 窗口宽度联动） */
export const AI_MEMBER_LIBRARY_INLINE_WIDTH = 680;

const useStyles = createStyles(({ token, css }) => ({
  drawerBody: css`
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    height: 100%;
    padding: 0;
    overflow: hidden;
  `,
  tabToolbar: css`
    display: flex;
    justify-content: flex-end;
    padding: 16px 24px 0;
    flex-shrink: 0;
  `,
  tabContainer: css`
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;

    .ant-tabs {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .ant-tabs-nav {
      margin: 0 !important;
      padding: 0 24px;
      background: ${token.colorBgContainer};
      border-bottom: 1px solid ${token.colorBorderSecondary};
      flex-shrink: 0;
    }

    .ant-tabs-content-holder {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      background: ${token.colorBgLayout};
    }

    .ant-tabs-content,
    .ant-tabs-tabpane-active {
      height: auto;
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
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: ${token.colorBgContainer};
    border-left: 1px solid ${token.colorBorderSecondary};
    flex-shrink: 0;
    z-index: 5;
    overflow: hidden;
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
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  `,
  drawerContent: css`
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  `,
}));

interface AIMemberLibraryProps {
  open: boolean;
  onClose: () => void;
  groups: Group[];
  /** 桌面端使用内联面板（与群设置一致），移动端走 Drawer */
  inline?: boolean;
}

export const AIMemberLibrary: React.FC<AIMemberLibraryProps> = ({ open, onClose, groups, inline }) => {
  const { t } = useTranslation(['library', 'common', 'product']);
  const { styles } = useStyles();
  const members = useAIMemberStore((state) => state.members);
  const { load, remove, ensurePersonalCopy, findReferencingGroups } = useAIMemberStore();
  const { load: loadProviders } = useProviderStore();
  const [activeTab, setActiveTab] = useState<string>('cli');
  // Editor State
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [editorKind, setEditorKind] = useState<'llm' | 'agent' | 'cli'>('llm');

  // Provider editor state
  const [providerEditorOpen, setProviderEditorOpen] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (open) {
      load();
    }
  }, [open]);

  useEffect(() => {
    if (open && activeTab === 'providers') {
      loadProviders();
    }
  }, [open, activeTab, loadProviders]);

  const handleCreate = (kind: 'llm' | 'agent' | 'cli') => {
    setEditingId(undefined);
    setEditorKind(kind);
    setEditorOpen(true);
  };

  const handleEdit = async (member: AIMember) => {
    try {
      const target = member.source === 'builtin'
        ? await ensurePersonalCopy(member.id)
        : member;
      setEditingId(target.id);
      setEditorKind(target.kind);
      setEditorOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('library:toast.editOpenFailed'));
    }
  };

  const handleCreateProvider = () => {
    setEditingProviderId(undefined);
    setProviderEditorOpen(true);
  };

  const handleEditProvider = (provider: Provider) => {
    setEditingProviderId(provider.id);
    setProviderEditorOpen(true);
  };

  const handleDelete = (member: AIMember) => {
    const referencing = findReferencingGroups(member.id, groups);
    if (referencing.length > 0) {
      Modal.confirm({
        title: t('library:deleteMember.blockedTitle'),
        icon: <ShieldAlert style={{ color: '#ff4d4f' }} />,
        content: (
          <div>
            <p>{t('library:deleteMember.inUseIntro', { name: member.name })}</p>
            <ul>
              {referencing.map(g => (
                <li key={g.id}>{g.name}</li>
              ))}
            </ul>
            <p>{t('library:deleteMember.inUseHint')}</p>
          </div>
        ),
        okText: t('common:actions.gotIt'),
        cancelButtonProps: { style: { display: 'none' } }
      });
      return;
    }

    Modal.confirm({
      title: t('library:deleteMember.confirmTitle'),
      content: member.forkedFrom
        ? t('library:deleteMember.confirmForked', { name: member.name })
        : t('library:deleteMember.confirmDefault', { name: member.name }),
      okText: t('common:actions.confirmDelete'),
      okType: 'danger',
      cancelText: t('common:actions.cancel'),
      onOk: async () => {
        await remove(member.id);
      }
    });
  };

  const getKindLabel = (kind: AIMemberKind) => {
    switch (kind) {
      case 'llm':
        return { label: t('product:memberKinds.character'), icon: Cpu, color: 'blue' };
      case 'agent':
        return { label: t('product:memberKinds.expert'), icon: Sparkles, color: 'purple' };
      case 'cli':
        return { label: t('product:memberKinds.cliMember'), icon: Terminal, color: 'green' };
    }
  };

  const getMembersByKind = (kind: AIMemberKind) => {
    const list = getVisibleMembers(members, kind);
    // 角色、专家不提供官方预设，仅展示用户自建资源
    if (kind === 'llm' || kind === 'agent') {
      return list.filter((m) => m.source !== 'builtin');
    }
    return list;
  };

  const memberSourceTag = (member: AIMember) => {
    if (member.source === 'builtin') {
      return <Tag className={styles.badgeBuiltin}>{t('common:badges.builtin')}</Tag>;
    }
    if (!member.forkedFrom) {
      return <Tag className={styles.badgeUser}>{t('common:badges.userCreated')}</Tag>;
    }
    return null;
  };

  const renderMemberMeta = (member: AIMember) => (
    <>
      {member.kind === 'llm' && (
        <>
          <div className={styles.metaItem}>
            <strong>{t('library:meta.model')}</strong> {member.model}
            {member.providerId?.startsWith('unmapped-') && (
              <span style={{ color: '#ef4444', marginLeft: 6 }}>{t('library:meta.unboundProvider')}</span>
            )}
          </div>
          {member.schedulerTag && (
            <div className={styles.metaItem}>
              <strong>{t('library:meta.schedulerTag')}</strong> {member.schedulerTag}
            </div>
          )}
        </>
      )}
      {member.kind === 'agent' && (
        <>
          <div className={styles.metaItem}>
            <strong>{t('library:meta.role')}</strong> {member.role || t('common:status.none')}
          </div>
          <div className={styles.metaItem}>
            <strong>{t('library:meta.model')}</strong> {member.model}
            {member.providerId?.startsWith('unmapped-') && (
              <span style={{ color: '#ef4444', marginLeft: 6 }}>{t('library:meta.unboundProvider')}</span>
            )}
          </div>
          <div className={styles.metaItem}>
            <strong>{t('library:meta.tools')}</strong>{' '}
            {t('library:meta.toolsEnabled', { count: member.tools?.filter((tool) => tool.enabled).length || 0 })}
          </div>
        </>
      )}
      {member.kind === 'cli' && (
        <>
          <div className={styles.metaItem}>
            <strong>{t('library:meta.adapter')}</strong> {member.cli?.adapter}
          </div>
          {member.cli?.binary && (
            <div className={styles.metaItem}>
              <strong>{t('library:meta.binaryPath')}</strong> {member.cli.binary}
            </div>
          )}
          <div className={styles.metaItem}>
            <strong>{t('library:meta.approvalMode')}</strong>{' '}
            {member.cli?.approvalMode === 'auto'
              ? t('library:meta.autoRun')
              : t('library:meta.manualApproval')}
          </div>
        </>
      )}
    </>
  );

  const renderMemberItem = (member: AIMember) => {
    const a = getAvatarData(member.name);
    const url = resolveAvatarByName(member.name, member.avatar, 48);
    const kindInfo = getKindLabel(member.kind);
    const KindIcon = kindInfo.icon;
    const canDelete = member.source === 'user';
    const isBuiltin = member.source === 'builtin';

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
            {memberSourceTag(member)}
            {!member.enabled && <Tag color="default">{t('common:status.disabled')}</Tag>}
          </div>

          <div className={styles.description}>
            {member.description || t('library:meta.noDescription')}
          </div>

          {member.kind === 'llm' && member.tags && member.tags.length > 0 && (
            <div className={styles.tagContainer}>
              {member.tags.map((tag) => (
                <Tag key={tag} style={{ borderRadius: 4 }}>{tag}</Tag>
              ))}
            </div>
          )}

          <div className={styles.metaDetails}>
            {renderMemberMeta(member)}
          </div>
        </div>

        <div className={styles.actionColumn}>
          <Button
            type="text"
            icon={isBuiltin ? <Copy size={14} /> : <Edit2 size={14} />}
            onClick={() => handleEdit(member)}
            style={{ padding: '4px 8px', height: 'auto' }}
          >
            {isBuiltin ? t('common:actions.copy') : t('common:actions.edit')}
          </Button>
          {canDelete && (
            <Button
              type="text"
              danger
              icon={<Trash2 size={14} />}
              onClick={() => handleDelete(member)}
              style={{ padding: '4px 8px', height: 'auto' }}
            >
              {t('common:actions.delete')}
            </Button>
          )}
        </div>
      </div>
    );
  };

  const createLabelForKind = (kind: AIMemberKind) => {
    switch (kind) {
      case 'cli':
        return t('library:create.cli');
      case 'llm':
        return t('library:create.llm');
      case 'agent':
        return t('library:create.agent');
    }
  };

  const renderTabContent = (kind: AIMemberKind) => {
    const list = getMembersByKind(kind);

    return (
      <>
        <div className={styles.tabToolbar}>
          <Button type="primary" icon={<Plus size={16} />} onClick={() => handleCreate(kind)}>
            {createLabelForKind(kind)}
          </Button>
        </div>
        {list.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px' }}>
            <Empty description={t('library:empty.resources')} />
          </div>
        ) : (
          <div className={styles.listContainer}>
            {list.map(renderMemberItem)}
          </div>
        )}
      </>
    );
  };

  const body = (
    <div className={styles.drawerBody}>
      <div className={styles.tabContainer}>
        <Tabs activeKey={activeTab} onChange={setActiveTab}>
          <Tabs.TabPane tab={t('library:tabs.cli')} key="cli">
            {renderTabContent('cli')}
          </Tabs.TabPane>
          <Tabs.TabPane tab={t('library:tabs.providers')} key="providers">
            <ProviderLibrary onCreate={handleCreateProvider} onEdit={handleEditProvider} />
          </Tabs.TabPane>
          <Tabs.TabPane tab={t('library:tabs.llm')} key="llm">
            {renderTabContent('llm')}
          </Tabs.TabPane>
          <Tabs.TabPane tab={t('library:tabs.agent')} key="agent">
            {renderTabContent('agent')}
          </Tabs.TabPane>
        </Tabs>
      </div>
    </div>
  );

  const editor = (
    <>
      <AIMemberEditor
        open={editorOpen}
        memberId={editingId}
        defaultKind={editorKind}
        onClose={() => setEditorOpen(false)}
        onSave={() => {
          load();
        }}
      />
      <ProviderEditor
        open={providerEditorOpen}
        providerId={editingProviderId}
        onClose={() => setProviderEditorOpen(false)}
        onSave={() => {
          loadProviders();
        }}
        onCloneEdit={(newId) => {
          setEditingProviderId(newId);
          setProviderEditorOpen(true);
        }}
      />
    </>
  );

  // 桌面端：与群设置一致的右侧推入式面板
  if (inline) {
    if (!open) return editor;
    return (
      <>
        <div className={styles.inlinePanel}>
          <div className={styles.inlineHeader}>
            <span className={styles.inlineTitleWrap}>
              <Users size={18} style={{ color: '#ff6600' }} />
              {t('library:title')}
            </span>
            <button className={styles.inlineCloseBtn} onClick={onClose} aria-label={t('library:closeAria')}>
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
            <span>{t('library:title')}</span>
          </div>
        }
        width={AI_MEMBER_LIBRARY_INLINE_WIDTH}
        open={open}
        onClose={onClose}
        styles={{
          body: { padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
        }}
        classNames={{ body: styles.drawerContent }}
      >
        {body}
      </Drawer>
      {editor}
    </>
  );
};
