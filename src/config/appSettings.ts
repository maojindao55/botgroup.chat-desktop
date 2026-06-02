/** 应用设置弹框中的导航分区 */
export type AppSettingsSection = 'general' | 'providers' | 'llm' | 'agent' | 'cli';

export const APP_SETTINGS_SECTIONS: AppSettingsSection[] = [
  'general',
  'providers',
  'llm',
  'agent',
  'cli',
];

export function memberKindToSettingsSection(
  kind: 'llm' | 'agent' | 'cli',
): AppSettingsSection {
  return kind;
}

export function groupTypeToSettingsSection(
  type: 'ai' | 'agent' | 'cli',
): AppSettingsSection {
  switch (type) {
    case 'ai':
      return 'llm';
    case 'agent':
      return 'agent';
    case 'cli':
      return 'cli';
  }
}
