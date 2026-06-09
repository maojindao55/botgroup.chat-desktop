import type { ReactNode } from 'react';
import { createStyles } from 'antd-style';

import { WindowTitleBar } from '@/components/WindowTitleBar';
import { needsCustomWindowChrome } from '@/utils/isTauri';

const useStyles = createStyles(({ token, css }) => ({
  page: css`
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: ${token.colorBgContainer};
    display: flex;
    flex-direction: ${needsCustomWindowChrome() ? 'column' : 'row'};
  `,
  container: css`
    flex: 1;
    min-height: 0;
    display: flex;
    width: 100%;
    position: relative;
    overflow: hidden;
  `,
}));

export function AppPageShell({ children }: { children: ReactNode }) {
  const { styles } = useStyles();

  return (
    <div className={styles.page}>
      <WindowTitleBar />
      <div className={styles.container}>
        {children}
      </div>
    </div>
  );
}
