import type { ButtonProps } from 'antd';
import type { ThemeProviderProps } from '@lobehub/ui';

/** 产品主色（与侧栏、发送按钮等保持一致） */
export const BRAND_PRIMARY = '#ff6600';
export const BRAND_PRIMARY_HOVER = '#e65c00';
export const BRAND_PRIMARY_ACTIVE = '#cc5200';
export const BRAND_ON_PRIMARY = '#ffffff';

/** 橙色实心按钮（避免 antd primary 变量把文字渲染成黑色） */
export const brandPrimaryButtonStyle = {
  backgroundColor: BRAND_PRIMARY,
  borderColor: BRAND_PRIMARY,
  color: BRAND_ON_PRIMARY,
} as const;

export const brandPrimaryButtonHoverStyle = {
  backgroundColor: BRAND_PRIMARY_HOVER,
  borderColor: BRAND_PRIMARY_HOVER,
  color: BRAND_ON_PRIMARY,
} as const;

/** 橙色主按钮：白字 + 白图标（勿用 type="primary"） */
export const brandPrimaryButtonProps: Pick<ButtonProps, 'style' | 'styles'> = {
  style: brandPrimaryButtonStyle,
  styles: {
    content: { color: BRAND_ON_PRIMARY },
    icon: { color: BRAND_ON_PRIMARY },
  },
};

/** 注入 antd / Lobe UI 的 token，避免 primary 按钮显示为默认黑/蓝 */
export const brandThemeTokens = {
  colorPrimary: BRAND_PRIMARY,
  colorPrimaryHover: BRAND_PRIMARY_HOVER,
  colorPrimaryActive: BRAND_PRIMARY_ACTIVE,
  colorLink: BRAND_PRIMARY,
  colorLinkHover: BRAND_PRIMARY_HOVER,
  colorLinkActive: BRAND_PRIMARY_ACTIVE,
  /** 与品牌橙协调的功能色（与界面中硬编码的标签/状态色保持一致） */
  colorSuccess: '#10b981',
  colorInfo: '#3b82f6',
  colorWarning: '#f59e0b',
  colorError: '#ef4444',
};

export const lobeCustomToken: ThemeProviderProps['customToken'] = () => ({
  colorBrandPrimary: BRAND_PRIMARY,
  colorBrandSecondary: '#f59e0b',
  colorBrandHover: BRAND_PRIMARY_HOVER,
});

/**
 * 浅色主题中性色：从冷调蓝灰（hue 240）改为暖中性灰（hue ~30，参考 stone 色阶），
 * 与橙色主色更协调。主色本身保持不变。
 */
export const lightThemeTokens = {
  colorText: '#1c1917',
  colorTextSecondary: '#57534e',
  colorTextTertiary: '#78716c',
  colorTextQuaternary: '#a8a29e',
  colorBorder: '#e7e5e4',
  colorBorderSecondary: '#f0efed',
  colorFill: '#e7e5e4',
  colorFillSecondary: '#f0efed',
  colorFillTertiary: '#f5f5f4',
  colorFillQuaternary: '#faf9f8',
  colorBgLayout: '#f7f6f4',
  colorBgContainer: '#ffffff',
  colorBgElevated: '#ffffff',
};

/**
 * 深色主题中性色：在原有近黑灰阶基础上加入极轻微暖调（R≥G≥B），
 * 让深色界面同样与橙色主色协调，并补充文字层级 token。
 */
export const darkThemeTokens = {
  colorText: '#f5f3f0',
  colorTextSecondary: '#b8b3ad',
  colorTextTertiary: '#8a847d',
  colorTextQuaternary: '#5f5a54',
  colorBgBase: '#121110',
  colorBgLayout: '#121110',
  colorBgContainer: '#1a1917',
  colorBgElevated: '#221f1d',
  colorBorder: '#322f2c',
  colorBorderSecondary: '#221f1d',
  colorFill: '#322f2c',
  colorFillSecondary: '#221f1d',
  colorFillTertiary: '#1a1917',
  colorFillQuaternary: '#221f1d',
};
