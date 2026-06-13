import { App as AntdApp, ConfigProvider as AntdConfigProvider } from 'antd';
import { ConfigProvider, ThemeProvider } from '@lobehub/ui';
import { motion } from 'motion/react';
import { I18nextProvider } from 'react-i18next';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { router } from './routes';
import { useLocale } from './hooks/use-locale';
import { useTheme } from './hooks/use-theme';
import { getAntdLocale } from './i18n/antdLocale';
import { i18n } from './i18n';
import { brandThemeTokens, darkThemeTokens, lightThemeTokens, lobeCustomToken } from './lib/theme';

function App() {
  console.log("App rendering"); // 添加日志
  const { resolvedLocale } = useLocale();
  const { resolvedTheme } = useTheme();
  const themeMode = resolvedTheme === 'dark' ? 'dark' : 'light';

  const customThemeConfig = {
    token: {
      ...brandThemeTokens,
      ...(resolvedTheme === 'dark' ? darkThemeTokens : lightThemeTokens),
    },
  };

  return (
    <I18nextProvider i18n={i18n}>
      <AntdConfigProvider locale={getAntdLocale(resolvedLocale)}>
        <ConfigProvider motion={motion}>
          <ThemeProvider
            themeMode={themeMode}
            theme={customThemeConfig}
            customTheme={{ primaryColor: 'orange' }}
            customToken={lobeCustomToken}
          >
            <AntdApp>
              <RouterProvider router={router} />
              <Toaster
                position="top-center"
                richColors
                toastOptions={{
                  style: {
                    fontSize: '14px',
                    fontWeight: '500',
                  },
                }}
                theme={resolvedTheme}
              />
            </AntdApp>
          </ThemeProvider>
        </ConfigProvider>
      </AntdConfigProvider>
    </I18nextProvider>
  );
}

export default App;
