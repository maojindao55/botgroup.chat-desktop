import React from 'react';
import { resolveAvatarSource } from '@/utils/lobehubAvatar';
import {
  OpenAI,
  Claude,
  DeepSeek,
  Gemini,
  Zhipu,
  Qwen,
  Moonshot,
  Kimi,
  Wenxin,
  Yi,
  Baichuan,
  Minimax,
  Spark,
  Yuanbao,
  Doubao,
  Grok,
  OpenCode,
  Cursor,
} from '@lobehub/icons';

interface User {
  id: number | string;
  name: string;
  avatar?: string;
}

interface AICharacter {
  id: string;
  name: string;
  personality: string;
  model: string;
  avatar?: string;
  custom_prompt?: string;
  tags?: string[];
}

export const getAvatarData = (name: string) => {
  const colors = ['#1abc9c', '#3498db', '#9b59b6', '#f1c40f', '#e67e22'];
  const index = (name.charCodeAt(0) + (name.charCodeAt(1) || 0)) % colors.length;
  return {
    backgroundColor: colors[index],
    text: name[0],
  };
};

// 获取单个头像的样式和内容
export const getSingleAvatarData = (user: User | AICharacter) => {
  if ('avatar' in user && user.avatar) {
    const src = resolveAvatarSource(user.avatar) ?? user.avatar;
    return {
      type: 'image',
      src,
      alt: user.name,
      className: 'w-full h-full object-cover'
    };
  }
  const avatarData = getAvatarData(user.name);
  return {
    type: 'text',
    text: avatarData.text,
    className: 'w-full h-full flex items-center justify-center text-xs text-white font-medium',
    style: { backgroundColor: avatarData.backgroundColor }
  };
};

// 获取半头像的样式和内容
export const getHalfAvatarData = (user: User, isFirst: boolean) => {
  if ('avatar' in user && user.avatar) {
    const src = resolveAvatarSource(user.avatar) ?? user.avatar;
    return {
      type: 'image',
      src,
      alt: user.name,
      className: 'w-full h-full object-cover',
      containerStyle: { 
        borderRight: isFirst ? '1px solid white' : 'none'
      }
    };
  }
  const avatarData = getAvatarData(user.name);
  return {
    type: 'text',
    text: avatarData.text,
    className: 'w-1/2 h-full flex items-center justify-center text-xs text-white font-medium',
    style: { 
      backgroundColor: avatarData.backgroundColor,
      borderRight: isFirst ? '1px solid white' : 'none'
    }
  };
};

// 获取四分之一头像的样式和内容
export const getQuarterAvatarData = (user: User, index: number) => {
  if ('avatar' in user && user.avatar) {
    const src = resolveAvatarSource(user.avatar) ?? user.avatar;
    return {
      type: 'image',
      src,
      alt: user.name,
      className: 'w-full h-full object-cover',
      containerStyle: { 
        borderRight: index % 2 === 0 ? '1px solid white' : 'none',
        borderBottom: index < 2 ? '1px solid white' : 'none'
      }
    };
  }
  const avatarData = getAvatarData(user.name);
  return {
    type: 'text',
    text: avatarData.text,
    className: 'aspect-square flex items-center justify-center text-[8px] text-white font-medium',
    style: { 
      backgroundColor: avatarData.backgroundColor,
      borderRight: index % 2 === 0 ? '1px solid white' : 'none',
      borderBottom: index < 2 ? '1px solid white' : 'none'
    }
  };
};

export const resolveAvatarByName = (
  name: string,
  currentAvatar?: string,
  size: number = 40
): React.ReactNode | string | undefined => {
  const trimmedAvatar = currentAvatar?.trim();
  const isLegacyBundledCliAvatar = /^\/img\/(codex|claude|opencode)\.webp(?:\?|$)/.test(trimmedAvatar || '');

  // 用户显式设置的头像（LobeHub 图标 / URL / 本地路径）优先于名称推断。
  // 旧版内置 CLI webp 在桌面端可能加载失败，改走下方本地 Lobe icon 组件。
  if (trimmedAvatar && !isLegacyBundledCliAvatar) {
    return resolveAvatarSource(currentAvatar) ?? currentAvatar;
  }

  const normalized = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');

  const wrapIconCircle = (IconComponent: any, bgColor: string, iconSizeRatio = 0.6, iconProps: any = {}) => {
    return React.createElement(
      'div',
      {
        style: {
          width: size,
          height: size,
          borderRadius: '50%',
          background: bgColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          flexShrink: 0,
        },
      },
      React.createElement(IconComponent, { size: size * iconSizeRatio, ...iconProps })
    );
  };

  // Handle mapping to official Lobe brand avatars, wrapped in circles
  if (normalized === 'claudecode') return wrapIconCircle(Claude, '#D97757', 0.75, { color: '#FFF' });
  if (normalized === 'claude') return wrapIconCircle(Claude, '#D97757', 0.75, { color: '#FFF' });
  if (normalized === 'codex') return wrapIconCircle(OpenAI, '#000', 0.75, { color: '#FFF' });
  if (normalized === 'opencode') return wrapIconCircle(OpenCode, '#0F0F0F', 0.6, { color: '#FFF' });
  if (normalized === 'cursor') return wrapIconCircle(Cursor, '#000', 0.75, { color: '#FFF' });
  if (normalized === 'yuanbao' || normalized === '元宝') return wrapIconCircle(Yuanbao.Color, '#FFF', 0.6);
  if (normalized === 'doubao' || normalized === '豆包') return wrapIconCircle(Doubao.Color, '#FFF', 0.6);
  if (normalized === 'qianwen' || normalized === '千问' || normalized === 'qwen') return wrapIconCircle(Qwen, 'linear-gradient(to right, #6336E7, #6F69F7)', 0.75, { color: '#FFF' });
  if (normalized === 'deepseek') return wrapIconCircle(DeepSeek, '#4D6BFE', 0.75, { color: '#FFF' });
  if (normalized === 'zhipu' || normalized === '智谱' || normalized === 'glm' || normalized === 'chatglm') return wrapIconCircle(Zhipu, '#3859FF', 0.75, { color: '#FFF' });
  if (normalized === 'kimi') return wrapIconCircle(Kimi, '#000', 0.6, { color: '#FFF' });
  if (normalized === 'moonshot') return wrapIconCircle(Moonshot, '#16191E', 0.75, { color: '#FFF' });
  if (normalized === 'wenxiaoyan' || normalized === '文小言' || normalized === 'wenxin' || normalized === 'baidu') return wrapIconCircle(Wenxin, 'linear-gradient(to right, #0A51C3, #23A4FB)', 0.75, { color: '#FFF' });
  if (normalized === 'gemini' || normalized === 'google') return wrapIconCircle(Gemini.Color, '#FFF', 0.8);
  if (normalized === 'openai' || normalized === 'gpt' || normalized === 'chatgpt') return wrapIconCircle(OpenAI, '#000', 0.75, { color: '#FFF' });
  if (normalized === 'grok' || normalized === 'xai') return wrapIconCircle(Grok, '#000', 0.75, { color: '#FFF' });
  if (normalized === 'spark' || normalized === '星火') return wrapIconCircle(Spark, '#0070f0', 0.75, { color: '#FFF' });
  if (normalized === 'minimax') return wrapIconCircle(Minimax, 'linear-gradient(to right, #E2167E, #FE603C)', 0.75, { color: '#FFF' });
  if (normalized === 'yi' || normalized === '零一万物') return wrapIconCircle(Yi, '#003425', 0.6, { color: '#FFF' });
  if (normalized === 'baichuan' || normalized === '百川') return wrapIconCircle(Baichuan, '#FF6933', 0.6, { color: '#FFF' });

  // Custom local icons for non-brand names:
  if (normalized === 'dousha' || normalized === '豆沙') return '/img/dousha.jpeg';
  if (normalized === 'dounai' || normalized === '豆奶') return '/img/dounai.jpeg';
  if (normalized === 'doujie' || normalized === '豆姐') return '/img/doujie.jpeg';
  if (normalized === 'douhai' || normalized === '豆孩') return '/img/douhai.jpeg';
  if (normalized === 'douba' || normalized === '豆爸') return '/img/douba.jpeg';
  if (normalized === 'douma' || normalized === '豆妈') return '/img/douma.jpeg';
  if (normalized === 'douye' || normalized === '豆爷') return '/img/douye.jpeg';
  if (normalized === 'doumei' || normalized === '豆妹') return '/img/doumei.jpeg';
  if (normalized === 'spymaster' || normalized === '游戏主持人') return '/img/spymaster.jpg';

  return undefined;
};
