import { useState, useMemo, useEffect } from 'react';
import { Modal, Steps, Button, Input, Empty } from 'antd';
import { createStyles } from 'antd-style';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Group, AIGroup } from '@/config/groups';
import {
  aiSpeechModes,
  applyAISpeechMode,
  type AISpeechMode,
} from '@/config/groupProduct';
import {
  groupTypeToSettingsSection,
  type AppSettingsSection,
} from '@/config/appSettings';
import { brandPrimaryButtonProps } from '@/lib/theme';
import { MemberPicker } from './MemberPicker';
import { useAIMemberStore } from '@/store/aiMemberStore';
import { getPickableMembers } from '@/utils/aiMemberDisplay';

interface CreateGroupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateGroup: (group: Group) => void;
  /** 成员为空时打开设置 */
  onOpenSettings?: (section?: AppSettingsSection) => void;
}

type WizardStep = 'basic' | 'members' | 'config';

const STEP_FLOW: WizardStep[] = ['basic', 'members', 'config'];

const useStyles = createStyles(({ token, css }) => ({
  strategyBtn: css`
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border-radius: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: all 0.15s;
    margin-bottom: 8px;
    &:hover { background: ${token.colorFillTertiary}; }
  `,
  strategyBtnActive: css`
    border-color: #ff6600;
    background: rgba(255,102,0,0.06);
  `,
}));

export const CreateGroupWizard = ({
  open,
  onOpenChange,
  onCreateGroup,
  onOpenSettings,
}: CreateGroupWizardProps) => {
  const { styles, cx } = useStyles();
  const { t } = useTranslation(['wizard', 'product', 'common']);
  const members = useAIMemberStore((state) => state.members);
  const { load: loadMembers } = useAIMemberStore();

  const [step, setStep] = useState<WizardStep>('basic');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedAIMembers, setSelectedAIMembers] = useState<string[]>([]);
  const [aiSpeechMode, setAISpeechMode] = useState<AISpeechMode>('smart');

  useEffect(() => {
    if (open) {
      loadMembers();
    }
  }, [open, loadMembers]);

  const reset = () => {
    setStep('basic');
    setName('');
    setDescription('');
    setSelectedAIMembers([]);
    setAISpeechMode('smart');
  };

  const handleCreate = () => {
    const aiMode = applyAISpeechMode(aiSpeechMode);
    const group: AIGroup = {
      id: `group-${Date.now()}`,
      type: 'ai',
      name,
      description,
      memberIds: selectedAIMembers,
      members: selectedAIMembers,
      isGroupDiscussionMode: aiMode.isGroupDiscussionMode,
      schedulerStrategy: aiMode.schedulerStrategy,
    };
    onCreateGroup(group);
    reset();
    onOpenChange(false);
  };

  const canProceed = (): boolean => {
    switch (step) {
      case 'basic': return name.trim().length > 0;
      case 'members': return selectedAIMembers.length > 0;
      default: return true;
    }
  };

  const nextStep = () => {
    const idx = STEP_FLOW.indexOf(step);
    if (idx < STEP_FLOW.length - 1) setStep(STEP_FLOW[idx + 1]);
  };

  const prevStep = () => {
    const idx = STEP_FLOW.indexOf(step);
    if (idx > 0) setStep(STEP_FLOW[idx - 1]);
  };

  const pickableMemberCount = useMemo(
    () => getPickableMembers(members, 'llm').length,
    [members],
  );

  const handleOpenSettings = () => {
    onOpenChange(false);
    reset();
    onOpenSettings?.(groupTypeToSettingsSection('ai'));
  };

  const renderBasicStep = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 6 }}>{t('wizard:basicStep.nameLabel')}</label>
        <Input placeholder={t('wizard:basicStep.namePlaceholder')} value={name} maxLength={30}
          onChange={e => setName(e.target.value)} />
      </div>
      <div>
        <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 6 }}>{t('wizard:basicStep.descriptionLabel')}</label>
        <Input.TextArea placeholder={t('wizard:basicStep.descriptionPlaceholder')} value={description} maxLength={100}
          onChange={e => setDescription(e.target.value)} />
      </div>
    </div>
  );

  const renderMembersStep = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)' }}>{t('wizard:membersStep.pickCharacters')}</p>
      {pickableMemberCount === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
          <Empty description={t('wizard:membersStep.emptyDescription', {
            resource: t('product:memberKinds.character'),
          })}>
            {onOpenSettings ? (
              <Button onClick={handleOpenSettings} {...brandPrimaryButtonProps}>
                {t('wizard:membersStep.goLibrary')}
              </Button>
            ) : (
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                {t('wizard:membersStep.openLibraryHint')}
              </span>
            )}
          </Empty>
        </div>
      ) : (
        <MemberPicker
          kind="llm"
          value={selectedAIMembers}
          onChange={setSelectedAIMembers}
          placeholder={t('wizard:membersStep.characterPlaceholder')}
        />
      )}
    </div>
  );

  const renderConfigStep = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 8 }}>{t('wizard:configStep.speechMode')}</label>
        {aiSpeechModes.map(item => (
          <button key={item.value}
            onClick={() => setAISpeechMode(item.value)}
            className={cx(styles.strategyBtn, aiSpeechMode === item.value && styles.strategyBtnActive)}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                {t(`product:aiSpeechModes.${item.value}.label`, { defaultValue: item.label })}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                {t(`product:aiSpeechModes.${item.value}.description`, { defaultValue: item.description })}
              </div>
            </div>
            {aiSpeechMode === item.value && <Check size={16} style={{ color: '#ff6600' }} />}
          </button>
        ))}
      </div>
    </div>
  );

  const stepTitles: Record<WizardStep, string> = {
    basic: t('wizard:steps.basic'),
    members: t('wizard:steps.members'),
    config: t('wizard:steps.config'),
  };

  const stepItems = [
    { title: t('wizard:steps.shortBasic') },
    { title: t('wizard:steps.shortMembers') },
    { title: t('wizard:steps.shortConfig') },
  ];

  return (
    <Modal
      open={open}
      onCancel={() => { reset(); onOpenChange(false); }}
      title={stepTitles[step]}
      width={520}
      destroyOnClose
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            {step !== STEP_FLOW[0] && (
              <Button type="text" onClick={prevStep}>{t('wizard:actions.previous')}</Button>
            )}
          </div>
          <div>
            {step === 'config' ? (
              <Button disabled={!canProceed()} onClick={handleCreate} {...brandPrimaryButtonProps}>
                {t('wizard:actions.createGroup')}
              </Button>
            ) : (
              <Button disabled={!canProceed()} onClick={nextStep} {...brandPrimaryButtonProps}>
                {t('wizard:actions.next')}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <Steps current={STEP_FLOW.indexOf(step)} size="small" style={{ marginBottom: 20 }} items={stepItems} />
      <div>
        {step === 'basic' && renderBasicStep()}
        {step === 'members' && renderMembersStep()}
        {step === 'config' && renderConfigStep()}
      </div>
    </Modal>
  );
};

export default CreateGroupWizard;
