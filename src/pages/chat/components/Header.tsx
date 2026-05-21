import { Header as LobeHeader, Segmented } from '@lobehub/ui';
import '@fontsource/audiowide';
import { Monitor, Moon, Sun } from 'lucide-react';
import React from 'react';
import GitHubButton from 'react-github-btn';

import { useTheme } from '@/hooks/use-theme';

const Header: React.FC = () => {
  const { theme, resolvedTheme, setTheme } = useTheme();

  const colorScheme = resolvedTheme === 'dark' ? 'dark' : 'light';

  return (
    <div className="fixed top-0 left-0 right-0 z-50 hidden md:block">
      <LobeHeader
        logo={
          <a href="/" className="flex items-center">
            <img src="/img/logo.svg" alt="logo" className="h-6 w-6 mr-2" />
            <span
              className="text-2xl"
              style={{ color: '#ff6600', fontFamily: 'Audiowide, system-ui' }}
            >
              botgroup.chat
            </span>
          </a>
        }
        actions={
          <div className="flex items-center gap-2">
            <Segmented
              className="theme-switcher-segmented"
              value={theme}
              onChange={(v) => setTheme(v as 'system' | 'light' | 'dark')}
              options={[
                { value: 'system', icon: <Monitor size={14} /> },
                { value: 'light', icon: <Sun size={14} /> },
                { value: 'dark', icon: <Moon size={14} /> },
              ]}
              size="small"
              shape="round"
            />
            <GitHubButton
              href="https://github.com/maojindao55/botgroup.chat"
              data-color-scheme={`no-preference: ${colorScheme}; light: ${colorScheme}; dark: ${colorScheme};`}
              data-size="large"
              data-show-count="true"
              aria-label="Star maojindao55/botgroup.chat on GitHub"
            >
              Star
            </GitHubButton>
          </div>
        }
      />
    </div>
  );
};

export default Header;
