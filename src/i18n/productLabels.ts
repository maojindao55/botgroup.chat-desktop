import type { TFunction } from 'i18next';

import type { GroupType } from '@/config/groups';
import { getProductGroupType } from '@/config/groupProduct';

export function getTranslatedGroupTypeShortLabel(t: TFunction, type: GroupType | string) {
  const fallback = getProductGroupType(type as GroupType).shortLabel;
  return t(`product:groupTypes.${type}.shortLabel`, { defaultValue: fallback });
}

export function getTranslatedGroupTypeLabel(t: TFunction, type: GroupType | string) {
  const fallback = getProductGroupType(type as GroupType).label;
  return t(`product:groupTypes.${type}.label`, { defaultValue: fallback });
}

export function getTranslatedGroupTypeDescription(t: TFunction, type: GroupType | string) {
  const fallback = getProductGroupType(type as GroupType).description;
  return t(`product:groupTypes.${type}.description`, { defaultValue: fallback });
}
