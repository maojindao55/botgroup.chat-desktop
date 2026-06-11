/** 应用设置弹框中的导航分区 */
export type AppSettingsSection = 'general' | 'providers' | 'llm' | 'cli';

export const APP_SETTINGS_SECTIONS: AppSettingsSection[] = [
  'general',
  'providers',
  'llm',
  'cli',
];

/** 侧栏分组（扁平设置结构，避免深层导航） */
export const APP_SETTINGS_NAV_GROUPS: {
  labelKey: 'navGroup.preferences' | 'navGroup.resources';
  sections: readonly AppSettingsSection[];
}[] = [
  { labelKey: 'navGroup.preferences', sections: ['general'] },
  { labelKey: 'navGroup.resources', sections: ['providers', 'llm', 'cli'] },
];

export function memberKindToSettingsSection(
  kind: 'llm' | 'agent' | 'cli',
): AppSettingsSection {
  return kind === 'agent' ? 'cli' : kind;
}

export function groupTypeToSettingsSection(
  type: 'ai' | 'agent' | 'cli',
): AppSettingsSection {
  switch (type) {
    case 'ai':
      return 'llm';
    case 'agent':
    case 'cli':
      return 'cli';
  }
}
