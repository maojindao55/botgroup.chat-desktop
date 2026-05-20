import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from 'sonner';
import { request } from '@/utils/request';
import { useIsMobile } from '@/hooks/use-mobile';
import ClickTextCapt from "@/components/goCaptcha/ClickTextCapt.jsx";

interface PhoneLoginProps {
  onLogin?: (phone: string, code: string) => void;
  handleLoginSuccess: (token: string) => void;
}

const PhoneLogin: React.FC<PhoneLoginProps> = ({ onLogin, handleLoginSuccess }) => {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [showCaptcha, setShowCaptcha] = useState(false); // 新增弹窗状态
  const isMobile = useIsMobile();

  // 获取备案号配置
  const icpNumber = (window as any).APP_CONFIG?.ICP_NUMBER;

  // 发送验证码成功后倒计时
  const handleSendCodeSuccess = () => {
      // 开始倒计时
      setCountdown(60);
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

  // 点击发送验证码按钮
  const handleSendCode = async () => {
    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
      toast.error('请输入正确的手机号');
      return;
    }
    setShowCaptcha(true); // 弹出图形验证码弹窗
  };

  // 图形验证码通过后的回调
  // const handleCaptchaSuccess = async () => {
  //   setShowCaptcha(false);
  //   await realSendCode();
  // };

  // 提交登录
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!phone || !code) {
      toast.error('请输入手机号和验证码');
      return;
    }

    // 如果有 onLogin 回调，先调用它
    if (onLogin) {
      onLogin(phone, code);
      return;
    }

    setIsLoading(true);
    try {
      const response = await request(`/api/login`, {
        method: 'POST',
        body: JSON.stringify({ phone, code }),
      });

      const data = await response.json();

      //执行登录成功回调
      handleLoginSuccess(data.data.token);
      
    } catch (error) {
      console.error('登录失败:', error);
      toast.error(error instanceof Error ? error.message : '登录失败，请重试');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-white flex items-center justify-center">
      <div className={`w-full ${isMobile ? 'max-w-sm px-6' : 'max-w-md px-8'} ${isMobile ? 'py-6' : 'py-8'}`}>
        {/* Logo */}
        <div className="flex items-center justify-center mb-6">
          <span 
            style={{fontFamily: 'Audiowide, system-ui', color: '#ff6600'}} 
            className={`${isMobile ? 'text-2xl' : 'text-3xl'} ml-2`}
          >
            botgroup.chat
          </span>
        </div>
        <div className={`text-gray-500 ${isMobile ? 'mb-6' : 'mb-4'} text-center ${isMobile ? 'text-sm' : 'text-base'}`}>
          仅支持中国大陆手机号登录
        </div>
        <form onSubmit={handleSubmit} className={`${isMobile ? 'space-y-4' : 'space-y-6'}`}>
          <div>
            <div className={`flex items-center border rounded-lg ${isMobile ? 'p-2.5' : 'p-3'} ${isMobile ? 'h-[42px]' : 'h-[46px]'} focus-within:border-[#ff6600]`}>
              <span className={`text-gray-400 mr-2 ${isMobile ? 'text-sm' : 'text-base'}`}>+86</span>
              <Input
                type="tel"
                placeholder="请输入手机号"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={11}
                className={`border-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none p-0 ${isMobile ? 'text-base' : 'text-base'}`}
              />
            </div>
          </div>
          <div>
            <div className={`flex ${isMobile ? 'gap-2' : 'gap-3'}`}>
              <Input
                type="text"
                placeholder="请输入验证码"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
                className={`border rounded-lg ${isMobile ? 'p-2.5' : 'p-3'} ${isMobile ? 'h-[42px]' : 'h-[46px]'} focus:border-[#ff6600] focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none ${isMobile ? 'text-base' : 'text-base'}`}
              />
              <Button
                type="button"
                onClick={handleSendCode}
                disabled={countdown > 0 || isLoading}
                className={`bg-white text-[#ff6600] border border-[#ff6600] hover:bg-[#ff6600] hover:text-white rounded-lg ${isMobile ? 'px-3 h-[42px] text-xs' : 'px-6 h-[46px] text-sm'} whitespace-nowrap`}
              >
                {countdown > 0 ? `${countdown}秒后重试` : '发送验证码'}
              </Button>
            </div>
          </div>
          <Button
            type="submit"
            className={`w-full bg-[#ff6600] hover:bg-[#e65c00] text-white rounded-lg ${isMobile ? 'py-2.5 text-sm' : 'py-3 text-base'}`}
            disabled={isLoading}
          >
            {isLoading ? (
              <div className="w-4 h-4 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : '登录'}
          </Button>
        </form>
        {/* 弹窗形式的图形验证码 */}
        {showCaptcha && (
          <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
            <div className={`${isMobile ? 'mx-4' : 'mx-0'}`}>
              <ClickTextCapt onVisibleChange={setShowCaptcha} onSuccess={handleSendCodeSuccess} extraData={{phone}} />
            </div>
          </div>
        )}
        {/* 备案号显示 */}
        {icpNumber && (
          <div className={`text-center ${isMobile ? 'mt-6' : 'mt-8'} text-xs text-gray-400`}>
            <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">{icpNumber}</a>
          </div>
        )}
      </div>
    </div>
  );
};

export default PhoneLogin; 