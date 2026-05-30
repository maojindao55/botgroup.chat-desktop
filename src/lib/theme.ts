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
};

export const lobeCustomToken: ThemeProviderProps['customToken'] = () => ({
  colorBrandPrimary: BRAND_PRIMARY,
  colorBrandSecondary: '#f59e0b',
  colorBrandHover: BRAND_PRIMARY_HOVER,
});

export const darkThemeTokens = {
  colorBgBase: '#121214',
  colorBgLayout: '#121214',
  colorBgContainer: '#1a1a1e',
  colorBgElevated: '#222226',
  colorBorderSecondary: '#222226',
  colorFillSecondary: '#222226',
  colorFillTertiary: '#1a1a1e',
  colorFillQuaternary: '#222226',
};
