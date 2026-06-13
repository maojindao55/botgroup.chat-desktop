import i18n from './index';

export function translateCliStageLabel(label: string): string {
  const reviewMatch = label.match(/^(?:复审|Review) #(\d+)$/i);
  if (reviewMatch) {
    return i18n.t('engine:cliStageLabels.reviewRound', {
      round: reviewMatch[1],
      defaultValue: label,
    });
  }
  const fixMatch = label.match(/^(?:修正|Fix) #(\d+)$/i);
  if (fixMatch) {
    return i18n.t('engine:cliStageLabels.fixRound', {
      round: fixMatch[1],
      defaultValue: label,
    });
  }
  const selfReviewMatch = label.match(/^(?:自评阶段|Self-review stage) (\d+)$/i);
  if (selfReviewMatch) {
    return i18n.t('engine:cliStageLabels.selfReviewStage', {
      index: selfReviewMatch[1],
      defaultValue: label,
    });
  }
  const selfCheckMatch = label.match(/^(?:自检阶段|Self-check stage) (\d+)$/i);
  if (selfCheckMatch) {
    return i18n.t('engine:cliStageLabels.selfCheckStage', {
      index: selfCheckMatch[1],
      defaultValue: label,
    });
  }
  const reviewStageMatch = label.match(/^(?:评审阶段|Review stage) (\d+)$/i);
  if (reviewStageMatch) {
    return i18n.t('engine:cliStageLabels.reviewStage', {
      index: reviewStageMatch[1],
      defaultValue: label,
    });
  }
  const stageMatch = label.match(/^(?:阶段|Stage) (\d+)$/i);
  if (stageMatch) {
    return i18n.t('engine:cliStageLabels.genericStage', {
      index: stageMatch[1],
      defaultValue: label,
    });
  }
  return i18n.t(`engine:cliStageLabels.${label}`, { defaultValue: label });
}

export function translateEngineRole(role: string): string {
  return i18n.t(`engine:roles.${role}`, { defaultValue: role });
}
