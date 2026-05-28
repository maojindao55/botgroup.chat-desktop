import i18n from './index';

export function getTranslatedTagCategory(category: string): string {
  return i18n.t(`tags:categories.${category}`, { defaultValue: category });
}

export function getTranslatedTag(tag: string): string {
  return i18n.t(`tags:items.${tag}`, { defaultValue: tag });
}
