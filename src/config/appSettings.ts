/** 应用设置弹框中的导航分区 */
export type AppSettingsSection = 'general' | 'providers' | 'llm';

export const APP_SETTINGS_SECTIONS: AppSettingsSection[] = [
  'general',
  'providers',
  'llm',
];

/** 侧栏分组（扁平设置结构，避免深层导航） */
export const APP_SETTINGS_NAV_GROUPS: {
  labelKey: 'navGroup.preferences' | 'navGroup.resources';
  sections: readonly AppSettingsSection[];
}[] = [
  { labelKey: 'navGroup.preferences', sections: ['general'] },
  { labelKey: 'navGroup.resources', sections: ['providers', 'llm'] },
];

export function memberKindToSettingsSection(_kind: 'llm'): AppSettingsSection {
  return 'llm';
}

export function groupTypeToSettingsSection(_type: 'ai'): AppSettingsSection {
  return 'llm';
}
