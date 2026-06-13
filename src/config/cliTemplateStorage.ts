import type { CLIGroup, Group } from './groups';

export const CLI_TEMPLATE_OVERRIDES_KEY = 'cli_template_overrides';
export const DELETED_CLI_TEMPLATES_KEY = 'deleted_cli_templates';

export function loadCLITemplateOverrides(): Record<string, CLIGroup> {
  try {
    const stored = localStorage.getItem(CLI_TEMPLATE_OVERRIDES_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

export function persistCLITemplateOverride(group: CLIGroup) {
  const overrides = loadCLITemplateOverrides();
  overrides[group.id] = group;
  localStorage.setItem(CLI_TEMPLATE_OVERRIDES_KEY, JSON.stringify(overrides));
}

export function loadDeletedCLITemplateIds(): string[] {
  try {
    const stored = localStorage.getItem(DELETED_CLI_TEMPLATES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function markCLITemplateDeleted(templateId: string) {
  const ids = loadDeletedCLITemplateIds();
  if (ids.includes(templateId)) return;
  localStorage.setItem(DELETED_CLI_TEMPLATES_KEY, JSON.stringify([...ids, templateId]));
}

export function removeCLITemplateLocalData(templateId: string) {
  const overrides = loadCLITemplateOverrides();
  delete overrides[templateId];
  localStorage.setItem(CLI_TEMPLATE_OVERRIDES_KEY, JSON.stringify(overrides));
  localStorage.removeItem(`workspace:${templateId}`);
  localStorage.removeItem(`cliStrategy:${templateId}`);
  localStorage.removeItem(`cliExecutionPlan:${templateId}`);
}

export function applyCLITemplateOverrides(groups: Group[]): Group[] {
  const overrides = loadCLITemplateOverrides();
  return groups.map((group) => {
    if (group.type !== 'cli') return group;
    const override = overrides[group.id];
    return override ? { ...group, ...override, type: 'cli' } : group;
  }) as Group[];
}

export function filterDeletedCLITemplates(groups: Group[]): Group[] {
  const deleted = new Set(loadDeletedCLITemplateIds());
  return groups.filter(group => group.type !== 'cli' || !deleted.has(group.id));
}

export function prepareCLIGroups(groups: Group[]): Group[] {
  return filterDeletedCLITemplates(applyCLITemplateOverrides(groups));
}

export function removeCLITemplateFromCustomGroups(templateId: string) {
  try {
    const stored = localStorage.getItem('custom_groups');
    if (!stored) return;
    const customGroups = JSON.parse(stored) as Group[];
    localStorage.setItem(
      'custom_groups',
      JSON.stringify(customGroups.filter(group => group.id !== templateId)),
    );
  } catch (e) {
    console.error('Failed to remove CLI template from custom_groups:', e);
  }
}
