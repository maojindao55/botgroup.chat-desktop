import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import type { ResolvedLocale } from './index';

export function getAntdLocale(locale: ResolvedLocale) {
  return locale === 'zh-CN' ? zhCN : enUS;
}
