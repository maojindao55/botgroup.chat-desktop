import React, { useState, useEffect, useRef } from 'react';
import { cn } from "@/lib/utils";
import { Edit2Icon, CheckIcon, XIcon, KeyRound } from 'lucide-react';
import { request } from '@/utils/request';
import { useUserStore } from '@/store/userStore';
import { getAvatarData } from '@/utils/avatar';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

interface UserSectionProps {
  isOpen: boolean;
}

export const UserSection: React.FC<UserSectionProps> = ({ isOpen }) => {
  const [isHovering, setIsHovering] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [newNickname, setNewNickname] = useState('');
  
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const userStore = useUserStore();

  // API Key modal states
  const [showApiModal, setShowApiModal] = useState(false);
  const [keys, setKeys] = useState({
    DASHSCOPE_API_KEY: '',
    ARK_API_KEY: '',
    HUNYUAN_API_KEY: '',
    GLM_API_KEY: '',
    DEEPSEEK_API_KEY: '',
    KIMI_API_KEY: '',
    BAIDU_API_KEY: '',
    OLLAMA_URL: 'http://localhost:11434/v1',
  });

  // Load keys from localStorage when modal is opened
  useEffect(() => {
    if (showApiModal) {
      setKeys({
        DASHSCOPE_API_KEY: localStorage.getItem('API_KEY_DASHSCOPE_API_KEY') || '',
        ARK_API_KEY: localStorage.getItem('API_KEY_ARK_API_KEY') || '',
        HUNYUAN_API_KEY: localStorage.getItem('API_KEY_HUNYUAN_API_KEY') || '',
        GLM_API_KEY: localStorage.getItem('API_KEY_GLM_API_KEY') || '',
        DEEPSEEK_API_KEY: localStorage.getItem('API_KEY_DEEPSEEK_API_KEY') || '',
        KIMI_API_KEY: localStorage.getItem('API_KEY_KIMI_API_KEY') || '',
        BAIDU_API_KEY: localStorage.getItem('API_KEY_BAIDU_API_KEY') || '',
        OLLAMA_URL: localStorage.getItem('API_KEY_OLLAMA_URL') || 'http://localhost:11434/v1',
      });
    }
  }, [showApiModal]);

  const handleSaveKeys = () => {
    localStorage.setItem('API_KEY_DASHSCOPE_API_KEY', keys.DASHSCOPE_API_KEY);
    localStorage.setItem('API_KEY_ARK_API_KEY', keys.ARK_API_KEY);
    localStorage.setItem('API_KEY_HUNYUAN_API_KEY', keys.HUNYUAN_API_KEY);
    localStorage.setItem('API_KEY_GLM_API_KEY', keys.GLM_API_KEY);
    localStorage.setItem('API_KEY_DEEPSEEK_API_KEY', keys.DEEPSEEK_API_KEY);
    localStorage.setItem('API_KEY_KIMI_API_KEY', keys.KIMI_API_KEY);
    localStorage.setItem('API_KEY_BAIDU_API_KEY', keys.BAIDU_API_KEY);
    localStorage.setItem('API_KEY_OLLAMA_URL', keys.OLLAMA_URL);
    
    // Ensure placeholder token is set
    localStorage.setItem('token', 'local_desktop_token_placeholder');

    toast.success('API 密钥及地址已保存！');
    setShowApiModal(false);
  };

  const updateNickname = async () => {
    if (!newNickname.trim()) return;
    
    try {
      setIsLoading(true);
      const response = await request('/api/user/update', {
        method: 'POST',
        body: JSON.stringify({ nickname: newNickname.trim() })
      });
      const { data } = await response.json();
      userStore.setUserInfo(data);
      toast.success('更新昵称成功');
      setIsEditing(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新昵称失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setUploadingAvatar(true);
      toast.info('本地版暂不支持云端头像上传，头像将以昵称首字渲染');
    } catch (error) {
      console.error('上传头像失败:', error);
    } finally {
      setUploadingAvatar(false);
    }
  };

  if (!isOpen || !userStore.userInfo || !userStore.userInfo.status) return null;
  
  return (
    <>
      {/* API Key Configuration Modal */}
      <Dialog open={showApiModal} onOpenChange={setShowApiModal}>
        <DialogContent className="sm:max-w-[480px] max-h-[85vh] flex flex-col p-6">
          <DialogHeader>
            <DialogTitle>本地 API 密钥设置</DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-3 -mr-3 my-2 max-h-[55vh]">
            <div className="space-y-4 pt-2">
              <p className="text-xs text-muted-foreground leading-relaxed">
                这些密钥会安全地储存在您的本地浏览器缓存中，不会经过任何中转服务器。
              </p>
              
              <div>
                <label className="text-xs font-semibold text-foreground mb-1 block">Ollama 接口地址 (本地大模型)</label>
                <Input
                  placeholder="e.g. http://localhost:11434/v1"
                  value={keys.OLLAMA_URL}
                  onChange={(e) => setKeys(prev => ({ ...prev, OLLAMA_URL: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground mb-1 block">阿里通义千问 (DASHSCOPE_API_KEY)</label>
                <Input
                  type="password"
                  placeholder="sk-..."
                  value={keys.DASHSCOPE_API_KEY}
                  onChange={(e) => setKeys(prev => ({ ...prev, DASHSCOPE_API_KEY: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground mb-1 block">火山引擎豆包 (ARK_API_KEY)</label>
                <Input
                  type="password"
                  placeholder="sk-..."
                  value={keys.ARK_API_KEY}
                  onChange={(e) => setKeys(prev => ({ ...prev, ARK_API_KEY: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground mb-1 block">腾讯混元大模型 (HUNYUAN_API_KEY)</label>
                <Input
                  type="password"
                  placeholder="sk-..."
                  value={keys.HUNYUAN_API_KEY}
                  onChange={(e) => setKeys(prev => ({ ...prev, HUNYUAN_API_KEY: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground mb-1 block">智谱 GLM (GLM_API_KEY)</label>
                <Input
                  type="password"
                  placeholder="sk-..."
                  value={keys.GLM_API_KEY}
                  onChange={(e) => setKeys(prev => ({ ...prev, GLM_API_KEY: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground mb-1 block">DeepSeek 官方 (DEEPSEEK_API_KEY)</label>
                <Input
                  type="password"
                  placeholder="sk-..."
                  value={keys.DEEPSEEK_API_KEY}
                  onChange={(e) => setKeys(prev => ({ ...prev, DEEPSEEK_API_KEY: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground mb-1 block">月之暗面 Kimi (KIMI_API_KEY)</label>
                <Input
                  type="password"
                  placeholder="sk-..."
                  value={keys.KIMI_API_KEY}
                  onChange={(e) => setKeys(prev => ({ ...prev, KIMI_API_KEY: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground mb-1 block">百度千帆大模型 (BAIDU_API_KEY)</label>
                <Input
                  type="password"
                  placeholder="sk-..."
                  value={keys.BAIDU_API_KEY}
                  onChange={(e) => setKeys(prev => ({ ...prev, BAIDU_API_KEY: e.target.value }))}
                />
              </div>
            </div>
          </ScrollArea>
          <div className="pt-4 border-t flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowApiModal(false)}>取消</Button>
            <Button onClick={handleSaveKeys} className="bg-[#ff6600] hover:bg-[#e65c00] text-white">保存配置</Button>
          </div>
        </DialogContent>
      </Dialog>

      <div 
        className={cn(
          "px-3 py-3 border-t border-b border-border/40 h-20",
          "flex items-center gap-3 hover:bg-accent/50 transition-colors"
        )}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {/* 头像区域 */}
        <div className="relative group cursor-pointer">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*"
            onChange={handleAvatarUpload}
          />
          <div 
            className="w-10 h-10 rounded-full flex items-center justify-center shadow-sm overflow-hidden"
            style={{ backgroundColor: getAvatarData(userStore.userInfo?.nickname || '我').backgroundColor }}
            onClick={() => !uploadingAvatar && fileInputRef.current?.click()}
          >
            {uploadingAvatar ? (
              <div className="flex items-center justify-center w-full h-full bg-black/20">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </div>
            ) : userStore.userInfo?.avatar_url ? (
              <img 
                src={`${userStore.userInfo.avatar_url}`}
                alt="avatar"
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-base font-medium text-white">
                {getAvatarData(userStore.userInfo?.nickname || '我').text}
              </span>
            )}
          </div>
          {/* 头像hover效果 */}
          <div 
            className={cn(
              "absolute inset-0 rounded-full bg-black/40 flex items-center justify-center transition-opacity",
              uploadingAvatar ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'
            )}
            onClick={() => !uploadingAvatar && fileInputRef.current?.click()}
          >
            <Edit2Icon className="w-4 h-4 text-white" />
          </div>
        </div>

        {/* 用户信息区域 */}
        <div className="flex flex-col relative flex-1">
          <div className="flex items-center group cursor-pointer">
            {isEditing ? (
              <div className="flex flex-col">
                <input
                  type="text"
                  value={newNickname}
                  onChange={(e) => setNewNickname(e.target.value)}
                  className="text-sm px-2 border rounded-md w-full"
                  placeholder={userStore.userInfo?.nickname || '输入新昵称'}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') updateNickname();
                    if (e.key === 'Escape') setIsEditing(false);
                  }}
                  autoFocus
                />
                <div className="flex items-center gap-1 mt-1">
                  <button
                    onClick={updateNickname}
                    className="p-1 hover:bg-emerald-50 rounded-md transition-colors"
                    title="保存"
                  >
                    <CheckIcon className="w-4 h-4 text-emerald-600 hover:text-emerald-500" />
                  </button>
                  <button
                    onClick={() => setIsEditing(false)}
                    className="p-1 hover:bg-rose-50 rounded-md transition-colors"
                    title="取消"
                  >
                    <XIcon className="w-4 h-4 text-rose-600 hover:text-rose-500" />
                  </button>
                </div>
              </div>
            ) : (
              <>
                <span className="text-sm font-semibold group-hover:text-primary transition-colors truncate max-w-[100px]">
                  {isLoading ? '加载中...' : userStore.userInfo?.nickname || '本地用户'}
                </span>
                <Edit2Icon 
                  className={cn(
                    "w-3 h-3 ml-1 text-muted-foreground/50",
                    "opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  )}
                  onClick={() => {
                    setIsEditing(true);
                    setNewNickname(userStore.userInfo?.nickname || '');
                  }}
                />
              </>
            )}
          </div>
          
          {/* API 配置按钮 */}
          {!isEditing && (
            <div 
              className={cn(
                "flex items-center gap-0.5 mt-1 text-xs text-muted-foreground/70",
                "hover:text-amber-500 transition-all duration-200 group",
                "rounded-md cursor-pointer"
              )}
              onClick={() => setShowApiModal(true)}
            >
              <KeyRound 
                className={cn(
                  "w-3 h-3",
                  "group-hover:rotate-12 transition-transform"
                )} 
              />
              <span className="group-hover:tracking-wide transition-all duration-200">
                API 密钥配置
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
};