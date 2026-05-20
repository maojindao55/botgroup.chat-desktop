import { create } from 'zustand'

interface UserInfo {
  id: number;
  phone: string;
  nickname: string;
  avatar_url: string | null;
  status: number;
}

interface UserStore {
  userInfo: UserInfo;
  setUserInfo: (userInfo: UserInfo) => void;
}

export const useUserStore = create<UserStore>((set) => ({
  userInfo: {
    id: 0,
    phone: '',
    nickname: '',
    avatar_url: null,
    status: 0
  },
  setUserInfo: (userInfo: UserInfo) => set({ userInfo })
})); 