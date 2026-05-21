import { App as AntdApp } from 'antd';
import { ConfigProvider, ThemeProvider } from '@lobehub/ui';
import { motion } from 'motion/react';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { router } from './routes';
import { useTheme } from './hooks/use-theme';
import { lobeCustomToken } from './lib/theme';

function App() {
  console.log("App rendering"); // 添加日志
  const { resolvedTheme } = useTheme();
  const themeMode = resolvedTheme === 'dark' ? 'dark' : 'light';

  const customThemeConfig = resolvedTheme === 'dark' ? {
    token: {
      colorBgBase: '#121214',
      colorBgLayout: '#121214',
      colorBgContainer: '#1a1a1e',
      colorBgElevated: '#222226',
      colorBorderSecondary: '#222226',
      colorFillSecondary: '#222226',
      colorFillTertiary: '#1a1a1e',
      colorFillQuaternary: '#222226',
    }
  } : undefined;

  return (
    <ConfigProvider motion={motion}>
      <ThemeProvider themeMode={themeMode} theme={customThemeConfig} customToken={lobeCustomToken}>
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
  );
}

export default App;
