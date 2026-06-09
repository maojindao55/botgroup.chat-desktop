import React, { useMemo, useState } from 'react';
import { Button, Empty, Form, Input, Modal, Select, Switch, Tag, Tooltip } from 'antd';
import { createStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Copy, Download, Edit2, Play, RefreshCw, RotateCcw, Terminal, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { parseCLICommandInput, resolveCLIExecutors, type ResolvedCLIExecutor, type CLIExecutorOverride } from '@/store/cliExecutorStore';
import { useCLIExecutorStore } from '@/store/cliExecutorStore';
import { request } from '@/utils/request';

interface CliStatus {
  installed: boolean;
  version?: string;
  path?: string;
}

type StatusValue = CliStatus | 'loading' | undefined;

const useStyles = createStyles(({ token, css }) => ({
  toolbar: css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
    padding: 8px 20px;
    background: ${token.colorBgContainer};
    border-bottom: 1px solid ${token.colorBorderSecondary};
  `,
  toolbarText: css`
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  listContainer: css`
    padding: 10px 20px 20px;
  `,
  executorCard: css`
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
  iconWrap: css`
    width: 32px;
    height: 32px;
    border-radius: 7px;
    background: ${token.colorPrimaryBg};
    color: ${token.colorPrimary};
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
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
    max-width: 100%;
  `,
  codeText: css`
    font-family: var(--ant-font-family-code);
    word-break: break-all;
  `,
  statusOk: css`
    color: ${token.colorSuccess};
    display: inline-flex;
    align-items: center;
    gap: 4px;
  `,
  statusError: css`
    color: ${token.colorError};
    display: inline-flex;
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
      padding-left: 44px;
    }
  `,
  modalForm: css`
    .ant-form-item {
      margin-bottom: 14px;
    }
  `,
}));

type TranslationFn = ReturnType<typeof useTranslation>['t'];
type StyleMap = ReturnType<typeof useStyles>['styles'];

function getStatusNode(status: StatusValue, t: TranslationFn, styles: StyleMap) {
  if (status === 'loading') {
    return <Tag icon={<RefreshCw size={12} />}>{t('library:executors.status.checking')}</Tag>;
  }
  if (!status) {
    return <Tag>{t('library:executors.status.unknown')}</Tag>;
  }
  if (status.installed) {
    return (
      <span className={styles.statusOk}>
        <CheckCircle2 size={14} />
        {status.version || t('library:executors.status.installed')}
      </span>
    );
  }
  return (
    <span className={styles.statusError}>
      <XCircle size={14} />
      {t('library:executors.status.notInstalled')}
    </span>
  );
}

export const CLIExecutorLibrary: React.FC = () => {
  const { t } = useTranslation(['library', 'common']);
  const { styles } = useStyles();
  const [form] = Form.useForm();
  const overrides = useCLIExecutorStore((state) => state.overrides);
  const upsertOverride = useCLIExecutorStore((state) => state.upsertOverride);
  const resetOverride = useCLIExecutorStore((state) => state.resetOverride);
  const duplicateExecutor = useCLIExecutorStore((state) => state.duplicateExecutor);
  const executors = useMemo(() => resolveCLIExecutors(overrides), [overrides]);
  const [statusMap, setStatusMap] = useState<Record<string, StatusValue>>({});
  const [installingMap, setInstallingMap] = useState<Record<string, boolean>>({});
  const [editingExecutor, setEditingExecutor] = useState<ResolvedCLIExecutor | null>(null);

  const checkExecutor = async (executor: ResolvedCLIExecutor) => {
    setStatusMap(prev => ({ ...prev, [executor.id]: 'loading' }));
    try {
      const res = await request('/api/cli/check', {
        method: 'POST',
        body: JSON.stringify({ adapter: executor.runtimeAdapter, binary: parseCLICommandInput(executor.binary).binary || executor.binary }),
      });
      const json = await res.json();
      setStatusMap(prev => ({
        ...prev,
        [executor.id]: json.success ? (json.data || { installed: false }) : { installed: false },
      }));
    } catch {
      setStatusMap(prev => ({ ...prev, [executor.id]: { installed: false } }));
    }
  };

  const checkAll = async () => {
    for (const executor of executors) {
      await checkExecutor(executor);
    }
  };

  const runInstall = async (executor: ResolvedCLIExecutor) => {
    const hint = executor.installHint;
    if (!hint) return;
    setInstallingMap(prev => ({ ...prev, [executor.id]: true }));
    try {
      const res = await request('/api/cli/install', {
        method: 'POST',
        body: JSON.stringify({ command: hint }),
      });
      const json = await res.json();
      if (json.success && json.data?.success) {
        toast.success(t('library:executors.toast.installSuccess'));
        // 安装成功后自动检测
        await checkExecutor(executor);
      } else {
        const stderr = json.data?.stderr?.trim?.() || '';
        const msg = stderr || t('library:executors.toast.installFailed');
        toast.error(msg);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`${t('library:executors.toast.installFailed')}: ${msg}`);
    } finally {
      setInstallingMap(prev => ({ ...prev, [executor.id]: false }));
    }
  };

  const openEditor = (executor: ResolvedCLIExecutor) => {
    setEditingExecutor(executor);
    form.setFieldsValue({
      label: executor.label,
      binary: executor.binary,
      extraArgs: executor.extraArgs || [],
      installHint: executor.installHint || '',
      docsUrl: executor.docsUrl || '',
      enabled: executor.enabled,
    });
  };

  const handleSave = async () => {
    if (!editingExecutor) return;
    const values = await form.validateFields();
    upsertOverride({
      id: editingExecutor.id,
      baseAdapter: editingExecutor.baseAdapter as CLIExecutorOverride['baseAdapter'],
      label: values.label,
      binary: values.binary,
      extraArgs: values.extraArgs || [],
      installHint: values.installHint,
      docsUrl: values.docsUrl,
      enabled: values.enabled !== false,
    });
    setEditingExecutor(null);
    toast.success(t('library:executors.toast.saved'));
  };

  const handleReset = (executor: ResolvedCLIExecutor) => {
    resetOverride(executor.id);
    setStatusMap(prev => {
      const next = { ...prev };
      delete next[executor.id];
      return next;
    });
    toast.success(t('library:executors.toast.reset'));
  };

  const handleDuplicate = (executor: ResolvedCLIExecutor) => {
    const copied = duplicateExecutor(executor.id);
    if (copied) {
      toast.success(t('library:executors.toast.duplicated'));
      openEditor(copied);
    }
  };

  const renderExecutor = (executor: ResolvedCLIExecutor) => {
    const status = statusMap[executor.id];
    const supportsSession = executor.capabilities.toolSession;

    return (
      <div className={styles.executorCard} key={executor.id}>
        <div className={styles.iconWrap}>
          <Terminal size={18} />
        </div>

        <div className={styles.infoSection}>
          <div className={styles.headerRow}>
            <span className={styles.name}>{executor.label}</span>
            <Tag>{executor.id}</Tag>
            <Tag color={executor.enabled ? 'green' : 'default'}>
              {executor.enabled ? t('library:executors.status.enabled') : t('library:executors.status.disabled')}
            </Tag>
            {executor.source === 'customized' && <Tag color="orange">{t('library:executors.status.customized')}</Tag>}
            {executor.source === 'custom' && <Tag color="purple">{t('library:executors.status.copied')}</Tag>}
            <Tag color={supportsSession ? 'green' : 'default'}>
              {supportsSession
                ? t('library:executors.capabilities.toolSession')
                : t('library:executors.capabilities.noToolSession')}
            </Tag>
            {executor.capabilities.openCodeSessionTitle && (
              <Tag color="blue">{t('library:executors.capabilities.sessionTitle')}</Tag>
            )}
          </div>

          <div className={styles.description}>
            {t('library:executors.description', { label: executor.label })}
          </div>

          <div className={styles.metaDetails}>
            <div className={styles.metaItem}>
              <strong>{t('library:executors.meta.command')}</strong>
              <span className={styles.codeText}>{executor.binary}</span>
            </div>
            <div className={styles.metaItem}>
              <strong>{t('library:executors.meta.streamMode')}</strong>
              <span className={styles.codeText}>{executor.streamMode}</span>
            </div>
            {executor.commandGroup && (
              <div className={styles.metaItem}>
                <strong>{t('library:executors.meta.commandGroup')}</strong>
                <span className={styles.codeText}>{executor.commandGroup}</span>
              </div>
            )}
            <div className={styles.metaItem}>
              <strong>{t('library:executors.meta.status')}</strong>
              {getStatusNode(status, t, styles)}
            </div>
            {status && status !== 'loading' && status.path && (
              <div className={styles.metaItem}>
                <strong>{t('library:executors.meta.path')}</strong>
                <Tooltip title={status.path}>
                  <span className={styles.codeText}>{status.path}</span>
                </Tooltip>
              </div>
            )}
            {executor.extraArgs.length > 0 && (
              <div className={styles.metaItem}>
                <strong>{t('library:executors.meta.extraArgs')}</strong>
                <span className={styles.codeText}>{executor.extraArgs.join(' ')}</span>
              </div>
            )}
            {executor.installHint && (
              <div className={styles.metaItem}>
                <strong>{t('library:executors.meta.install')}</strong>
                <span className={styles.codeText}>{executor.installHint}</span>
              </div>
            )}
          </div>
        </div>

        <div className={styles.actionColumn}>
          <Button
            type="text"
            icon={<Play size={14} />}
            loading={status === 'loading'}
            onClick={() => checkExecutor(executor)}
            style={{ padding: '3px 8px', height: 26, borderRadius: 6 }}
          >
            {t('library:executors.actions.check')}
          </Button>
          {executor.installHint && status && status !== 'loading' && !status.installed && (
            <Button
              type="text"
              icon={<Download size={14} />}
              loading={!!installingMap[executor.id]}
              onClick={() => runInstall(executor)}
              style={{ padding: '3px 8px', height: 26, borderRadius: 6 }}
            >
              {t('library:executors.actions.install')}
            </Button>
          )}
          <Button
            type="text"
            icon={<Copy size={14} />}
            onClick={() => handleDuplicate(executor)}
            style={{ padding: '3px 8px', height: 26, borderRadius: 6 }}
          >
            {t('library:executors.actions.duplicate')}
          </Button>
          <Button
            type="text"
            icon={<Edit2 size={14} />}
            onClick={() => openEditor(executor)}
            style={{ padding: '3px 8px', height: 26, borderRadius: 6 }}
          >
            {t('common:actions.edit')}
          </Button>
          {executor.source === 'customized' && (
            <Button
              type="text"
              icon={<RotateCcw size={14} />}
              onClick={() => handleReset(executor)}
              style={{ padding: '3px 8px', height: 26, borderRadius: 6 }}
            >
              {t('library:executors.actions.reset')}
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className={styles.toolbar}>
        <span className={styles.toolbarText}>{t('library:executors.hint')}</span>
        <Button icon={<RefreshCw size={14} />} onClick={checkAll}>
          {t('library:executors.actions.checkAll')}
        </Button>
      </div>

      {executors.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px' }}>
          <Empty description={t('library:executors.empty')} />
        </div>
      ) : (
        <div className={styles.listContainer}>{executors.map(renderExecutor)}</div>
      )}

      <Modal
        title={t('library:executors.editor.title')}
        open={!!editingExecutor}
        onCancel={() => setEditingExecutor(null)}
        onOk={handleSave}
        okText={t('common:actions.save')}
        cancelText={t('common:actions.cancel')}
        destroyOnClose
      >
        <Form form={form} layout="vertical" className={styles.modalForm} preserve={false}>
          <Form.Item label={t('library:executors.editor.id')}>
            <Input value={editingExecutor?.id} disabled />
          </Form.Item>
          {editingExecutor?.baseAdapter && (
            <Form.Item label={t('library:executors.editor.baseAdapter')}>
              <Input value={editingExecutor.baseAdapter} disabled />
            </Form.Item>
          )}
          <Form.Item label={t('library:executors.editor.label')} name="label">
            <Input placeholder={editingExecutor?.label} />
          </Form.Item>
          <Form.Item
            label={t('library:executors.editor.binary')}
            name="binary"
            rules={[{ required: true, message: t('library:executors.editor.binaryRequired') }]}
          >
            <Input placeholder={editingExecutor?.defaultBinary || editingExecutor?.id} />
          </Form.Item>
          <Form.Item label={t('library:executors.editor.extraArgs')} name="extraArgs">
            <Select mode="tags" tokenSeparators={[' ']} placeholder={t('library:executors.editor.extraArgsPlaceholder')} />
          </Form.Item>
          <Form.Item label={t('library:executors.editor.installHint')} name="installHint">
            <Input placeholder={editingExecutor?.installHint} />
          </Form.Item>
          <Form.Item label={t('library:executors.editor.docsUrl')} name="docsUrl">
            <Input placeholder={editingExecutor?.docsUrl} />
          </Form.Item>
          <Form.Item label={t('library:executors.editor.enabled')} name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};
