import React, { useState, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { toast } from 'sonner';
import { request } from '@/utils/request';
import { useIsMobile } from '@/hooks/use-mobile';

interface WechatLoginProps {
  handleLoginSuccess: (token: string) => void;
}

const WechatLogin: React.FC<WechatLoginProps> = ({ handleLoginSuccess }) => {
  const [qrCode, setQrCode] = useState('');
  const [loginStatus, setLoginStatus] = useState<'loading' | 'ready' | 'scanned' | 'expired'>('loading');
  const [isLoading, setIsLoading] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const isMobile = useIsMobile();

  // 获取备案号配置
  const icpNumber = (window as any).APP_CONFIG?.ICP_NUMBER;

  // 生成微信登录二维码
  const generateQrCode = async () => {
    setIsLoading(true);
    setLoginStatus('loading');
    
    try {
      const response = await request('/api/auth/wechat/qr-code', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const data = await response.json();
      
      if (data.success) {
        setQrCode(data.data.qr_url);
        setLoginStatus('ready');
        startPolling(data.data.session_id);
      } else {
        toast.error(data.message || '获取二维码失败');
        setLoginStatus('expired');
      }
    } catch (error) {
      console.error('获取微信二维码失败:', error);
      toast.error('获取二维码失败，请重试');
      setLoginStatus('expired');
    } finally {
      setIsLoading(false);
    }
  };

  // 轮询检查登录状态
  const startPolling = (sessionId: string) => {
    pollingRef.current = setInterval(async () => {
      try {
        const response = await request(`/api/auth/wechat/status/${sessionId}`, {
          method: 'GET',
        });

        const data = await response.json();
        
        if (data.success) {
          switch (data.status) {
            case 'scanned':
              setLoginStatus('scanned');
              break;
            case 'success':
              // 登录成功
              handleLoginSuccess(data.data.token);
              if (pollingRef.current) {
                clearInterval(pollingRef.current);
              }
              break;
            case 'expired':
              setLoginStatus('expired');
              if (pollingRef.current) {
                clearInterval(pollingRef.current);
              }
              break;
          }
        }
      } catch (error) {
        console.error('检查登录状态失败:', error);
      }
    }, 2000); // 每2秒检查一次
  };

  // 刷新二维码
  const refreshQrCode = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }
    generateQrCode();
  };

  // 组件挂载时生成二维码
  useEffect(() => {
    generateQrCode();
    
    // 组件卸载时清理定时器
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  // 获取状态提示文本
  const getStatusText = () => {
    switch (loginStatus) {
      case 'loading':
        return '正在加载二维码...';
      case 'ready':
        return '请使用微信扫码登录';
      case 'scanned':
        return '扫码成功，请在手机上确认登录';
      case 'expired':
        return '二维码已过期，请点击刷新';
      default:
        return '';
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
          微信扫码登录
        </div>

        {/* 二维码区域 */}
        <div className="flex flex-col items-center space-y-4">
          <div className={`${isMobile ? 'w-48 h-48' : 'w-56 h-56'} border-2 border-gray-200 rounded-lg flex items-center justify-center bg-gray-50`}>
            {loginStatus === 'loading' ? (
              <div className="flex flex-col items-center space-y-2">
                <div className="w-8 h-8 animate-spin rounded-full border-2 border-[#ff6600] border-t-transparent" />
                <span className="text-sm text-gray-500">加载中...</span>
              </div>
            ) : loginStatus === 'expired' ? (
              <div className="flex flex-col items-center space-y-2">
                <div className="text-gray-400 text-center">
                  <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm">二维码已过期</span>
                </div>
              </div>
            ) : qrCode ? (
              <div className="relative">
                <img 
                  src={qrCode} 
                  alt="微信登录二维码" 
                  className={`${isMobile ? 'w-44 h-44' : 'w-52 h-52'} object-contain`}
                />
                {loginStatus === 'scanned' && (
                  <div className="absolute inset-0 bg-green-500 bg-opacity-80 flex items-center justify-center rounded">
                    <div className="text-white text-center">
                      <svg className="w-8 h-8 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-sm">扫码成功</span>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* 状态提示 */}
          <div className={`text-center ${isMobile ? 'text-sm' : 'text-base'} ${
            loginStatus === 'expired' ? 'text-red-500' : 
            loginStatus === 'scanned' ? 'text-green-600' : 'text-gray-600'
          }`}>
            {getStatusText()}
          </div>

          {/* 刷新按钮 */}
          {loginStatus === 'expired' && (
            <Button
              onClick={refreshQrCode}
              disabled={isLoading}
              className={`bg-[#ff6600] hover:bg-[#e65c00] text-white rounded-lg ${isMobile ? 'px-4 py-2 text-sm' : 'px-6 py-2.5 text-base'}`}
            >
              {isLoading ? (
                <div className="w-4 h-4 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : null}
              刷新二维码
            </Button>
          )}
        </div>

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

export default WechatLogin;
