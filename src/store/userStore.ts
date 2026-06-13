import { create } from 'zustand';
import { isLocalAvatar } from '@/utils/lobehubAvatar';
import { clearLocalAvatarCache, resolveUserAvatarDisplay } from '@/utils/localAvatarLoader';

interface UserInfo {
  id: number;
  phone: string;
  nickname: string;
  avatar_url: string | null;
  status: number;
}

interface UserStore {
  userInfo: UserInfo;
  avatarDisplaySrc: string | null;
  setUserInfo: (userInfo: UserInfo) => void;
  setAvatarDisplaySrc: (src: string | null) => void;
  syncAvatarDisplay: () => Promise<void>;
}

export const useUserStore = create<UserStore>((set, get) => ({
  userInfo: {
    id: 0,
    phone: '',
    nickname: '',
    avatar_url: null,
    status: 0,
  },
  avatarDisplaySrc: null,
  setUserInfo: (userInfo) => {
    const previousAvatar = get().userInfo.avatar_url;
    if (previousAvatar && previousAvatar !== userInfo.avatar_url && isLocalAvatar(previousAvatar)) {
      clearLocalAvatarCache(previousAvatar);
    }
    set({ userInfo });
    void get().syncAvatarDisplay();
  },
  setAvatarDisplaySrc: (src) => set({ avatarDisplaySrc: src }),
  syncAvatarDisplay: async () => {
    const { avatar_url } = get().userInfo;
    if (!avatar_url) {
      set({ avatarDisplaySrc: null });
      return;
    }
    try {
      const src = await resolveUserAvatarDisplay(avatar_url);
      set({ avatarDisplaySrc: src ?? null });
    } catch (error) {
      console.error('Failed to resolve user avatar:', error);
      set({ avatarDisplaySrc: null });
    }
  },
}));
