import { createStyles } from 'antd-style';

const useStyles = createStyles(({ token, css }) => ({
  root: css`
    flex-shrink: 0;
    padding: 20px 24px 16px;
    background: ${token.colorBgContainer};
    border-bottom: 1px solid ${token.colorBorderSecondary};
  `,
  title: css`
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: ${token.colorText};
    line-height: 1.3;
  `,
  description: css`
    margin: 6px 0 0;
    font-size: 13px;
    color: ${token.colorTextSecondary};
    line-height: 1.5;
    max-width: 52ch;
  `,
}));

export interface SettingsSectionHeaderProps {
  title: string;
  description?: string;
}

/** 设置详情区标题（对齐 macOS Settings / Form 分区头） */
export function SettingsSectionHeader({ title, description }: SettingsSectionHeaderProps) {
  const { styles } = useStyles();

  return (
    <header className={styles.root}>
      <h2 className={styles.title}>{title}</h2>
      {description ? <p className={styles.description}>{description}</p> : null}
    </header>
  );
}
