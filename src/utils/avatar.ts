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