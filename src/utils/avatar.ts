import React from 'react';

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
    return {
      type: 'image',
      src: user.avatar,
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
    return {
      type: 'image',
      src: user.avatar,
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
    return {
      type: 'image',
      src: user.avatar,
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

export const resolveAvatarByName = (name: string, currentAvatar?: string): string | undefined => {
  const normalized = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
  if (normalized === 'claudecode' || normalized === 'claude') {
    return '/img/claude.webp?v=1779334925';
  }
  if (normalized === 'codex') {
    return '/img/codex.webp?v=1779334925';
  }
  if (normalized === 'opencode') {
    return '/img/opencode.webp?v=1779334925';
  }
  
  if (currentAvatar) {
    return currentAvatar;
  }

  // Also support mapping standard AI characters if name matches
  if (normalized === 'yuanbao' || normalized === '元宝') return '/img/yuanbao.png';
  if (normalized === 'doubao' || normalized === '豆包') return '/img/doubao_new.png';
  if (normalized === 'qianwen' || normalized === '千问') return '/img/qwen.jpg';
  if (normalized === 'deepseek') return '/img/ds.svg';
  if (normalized === 'zhipu' || normalized === '智谱') return '/img/glm.gif';
  if (normalized === 'kimi') return '/img/kimi.jpg';
  if (normalized === 'wenxiaoyan' || normalized === '文小言') return '/img/baidu.svg';
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