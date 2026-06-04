import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Tag, Modal, Empty } from 'antd';
import { Avatar as LobeAvatar } from '@lobehub/ui';
import { useAIMemberStore } from '@/store/aiMemberStore';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';
import { getVisibleMembers } from '@/utils/aiMemberDisplay';
import { AIMember, AIMemberKind } from '@/config/aiMembers';
import { Group } from '@/config/groups';
import type { AppSettingsSection } from '@/config/appSettings';
import { AIMemberEditor } from './AIMemberEditor';
import { ProviderLibrary } from './ProviderLibrary';
import { ProviderEditor } from './ProviderEditor';
import { useProviderStore } from '@/store/providerStore';
import type { Provider } from '@/config/providers';
import { Plus, Edit2, Trash2, ShieldAlert, Cpu, Terminal, Sparkles, Copy } from 'lucide-react';
import { BRAND_ON_PRIMARY, brandPrimaryButtonProps } from '@/lib/theme';
import { toast } from 'sonner';
import { createStyles } from 'antd-style';

const useStyles = createStyles(({ token, css }) => ({
  root: css`
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  `,
  scrollBody: css`
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  `,
  actionBar: css`
    display: flex;
    justify-content: flex-end;
    align-items: center;
    flex-shrink: 0;
    padding: 8px 20px;
    background: ${token.colorBgContainer};
    border-bottom: 1px solid ${token.colorBorderSecondary};
  `,
  listContainer: css`
    padding: 10px 20px 20px;
  `,
  memberCard: css`
    background: ${token.colorBgContainer};
    border-radius: 8px;
    padding: 10px 12px;
    margin-bottom: 7px;
    border: 1px solid ${token.colorBorderSecondary};
    transition: border-color 0.15s ease, background 0.15s ease;
    display: flex;
    gap: 12px;
    align-items: flex-start;
    min-width: 0;
    &:hover {
      border-color: ${token.colorPrimaryBorderHover};
      background: ${token.colorFillQuaternary};
    }

    @media (max-width: 720px) {
      flex-wrap: wrap;
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
    font-size: 14px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  description: css`
    font-size: 13px;
    color: ${token.colorTextSecondary};
    margin-bottom: 6px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  `,
  tagContainer: css`
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-bottom: 6px;
  `,
  metaDetails: css`
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    font-size: 12px;
    color: ${token.colorTextTertiary};
    border-top: 1px solid ${token.colorBorderSecondary};
    padding-top: 7px;
    margin-top: 7px;
  `,
  metaItem: css`
    display: flex;
    align-items: center;
    gap: 4px;
  `,
  actionColumn: css`
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 4px;
    flex-shrink: 0;

    @media (max-width: 720px) {
      width: 100%;
      justify-content: flex-start;
      padding-left: 48px;
    }
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
}));

type ResourceSection = Exclude<AppSettingsSection, 'general'>;

interface ResourceLibraryContentProps {
  section: ResourceSection;
  groups: Group[];
  /** 父级弹框是否打开，用于触发数据加载 */
  active: boolean;
  /** 保存成员后切换到对应分区（当保存的 kind 与当前 section 不同时） */
  onSectionChange?: (section: ResourceSection) => void;
}

export const ResourceLibraryContent: React.FC<ResourceLibraryContentProps> = ({
  section,
  groups,
  active,
  onSectionChange,
}) => {
  const { t } = useTranslation(['library', 'common', 'product']);
  const { styles } = useStyles();
  const members = useAIMemberStore((state) => state.members);
  const { load, remove, ensurePersonalCopy, findReferencingGroups } = useAIMemberStore();
  const { load: loadProviders } = useProviderStore();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [editorKind, setEditorKind] = useState<'llm' | 'agent' | 'cli'>('llm');

  const [providerEditorOpen, setProviderEditorOpen] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (active) {
      load();
    }
  }, [active, load]);

  useEffect(() => {
    if (active && section === 'providers') {
      loadProviders();
    }
  }, [active, section, loadProviders]);

  const handleCreate = (kind: AIMemberKind) => {
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
        cancelButtonProps: { style: { display: 'none' } },
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
      },
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
          size={36}
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
            style={{ padding: '3px 8px', height: 26, borderRadius: 6 }}
          >
            {isBuiltin ? t('common:actions.copy') : t('common:actions.edit')}
          </Button>
          {canDelete && (
            <Button
              type="text"
              danger
              icon={<Trash2 size={14} />}
              onClick={() => handleDelete(member)}
              style={{ padding: '3px 8px', height: 26, borderRadius: 6 }}
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

  const renderMemberSection = (kind: AIMemberKind) => {
    const list = getMembersByKind(kind);

    return (
      <>
        <div className={styles.actionBar}>
          <Button
            icon={<Plus size={16} color={BRAND_ON_PRIMARY} />}
            onClick={() => handleCreate(kind)}
            {...brandPrimaryButtonProps}
          >
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

  const body = section === 'providers' ? (
    <ProviderLibrary onCreate={handleCreateProvider} onEdit={handleEditProvider} />
  ) : (
    renderMemberSection(section)
  );

  return (
    <div className={styles.root}>
      <div className={styles.scrollBody}>{body}</div>
      <AIMemberEditor
        open={editorOpen}
        memberId={editingId}
        defaultKind={editorKind}
        onClose={() => setEditorOpen(false)}
        onSave={(savedKind) => {
          load();
          // 若保存的成员类型与当前分区不同，自动切换到对应分区
          if (savedKind !== section) {
            onSectionChange?.(savedKind);
          }
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
    </div>
  );
};
