import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { Popover } from 'antd';
import { useTranslation } from 'react-i18next';

interface AdSectionProps {
  isOpen: boolean;
  closeAd?: () => void;
}

interface AdBannerProps {
  show: boolean;
  closeAd: () => void;
}

function WechatQrCode() {
  const { t } = useTranslation('ad');
  return (
    <div className="flex flex-col items-center">
      <img
        src="https://assets.monica.cn/home-web/_next/static/media/wechatQrcode.29848e06.png"
        alt={t('wechatQrAlt')}
        className="w-40 h-40"
      />
    </div>
  );
}

function AdBadge({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation('ad');
  if (compact) {
    return (
      <div className="absolute top-0 left-0 bg-gray-300/40 text-gray-400 text-[8px] px-1 py-1.5 rounded">
        {t('badgeShort')}
      </div>
    );
  }
  return (
    <div className="absolute top-0 left-0 bg-gray-300/40 text-gray-400 text-[10px] px-1.5 py-0.5 rounded">
      {t('badge')}
    </div>
  );
}

const AdSection: React.FC<AdSectionProps> = ({ isOpen }) => {
  const { t } = useTranslation('ad');
  const [isMobile, setIsMobile] = useState(false);

  React.useEffect(() => {
    const checkDevice = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkDevice();
    window.addEventListener('resize', checkDevice);
    return () => window.removeEventListener('resize', checkDevice);
  }, []);

  return (
    <div className="p-3" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
      <div
        className={cn(
          'rounded-lg p-2 text-center relative overflow-hidden min-h-[120px] flex flex-col justify-center',
          'transition-all duration-200 bg-cover bg-center bg-no-repeat',
          isOpen ? 'block' : 'hidden'
        )}
        style={{
          backgroundImage: "url('https://files.monica.cn/assets/botgroup/background.png')",
        }}
      >
        <AdBadge />
        <div className="relative z-10">
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center justify-center px-6">
              <img src="https://files.monica.cn/assets/botgroup/monica.png" alt="" />
            </div>
            <div className="text-sm font-medium text-center text-gray-400">{t('tagline')}</div>
            <div className="text-[10px] font-medium text-center text-gray-400 flex items-center justify-center gap-1">
              {t('poweredByPrefix')}
              <img src="https://files.monica.cn/assets/botgroup/deepseek.png" className="inline-block w-16" alt="DeepSeek" />
              {t('poweredBySuffix')}
            </div>
            <div className="flex flex-col items-center justify-center gap-2 mt-3">
              {isMobile ? (
                <button
                  onClick={() => {
                    window.open('https://mp.weixin.qq.com/s/9l9zz_8wXOmxkKIVd0j9Nw', '_blank');
                  }}
                  className="p-1 bg-white rounded-full text-xs font-medium text-blue-500 font-bold hover:bg-gray-50 transition-colors shadow-sm flex items-center gap-1 group"
                >
                  <img src="https://files.monica.cn/assets/botgroup/wechat.png" className="w-4 h-4" alt="WeChat" />
                  {t('useInWechat')}
                  <img src="https://files.monica.cn/assets/botgroup/arrow-up.png" className="w-4 h-4" alt="" />
                </button>
              ) : (
                <Popover trigger="click" placement="top" content={<WechatQrCode />}>
                  <button className="p-2 bg-white rounded-full text-xs font-medium text-blue-500 font-bold hover:bg-gray-50 transition-colors shadow-sm flex items-center gap-1 group">
                    <img src="https://files.monica.cn/assets/botgroup/wechat.png" className="w-4 h-4" alt="WeChat" />
                    {t('useInWechat')}
                    <img src="https://files.monica.cn/assets/botgroup/arrow-up.png" className="w-4 h-4" alt="" />
                  </button>
                </Popover>
              )}

              {isMobile ? (
                <button
                  onClick={() => {
                    window.open(
                      'https://app.adjust.com/1mh0qgab?fallback=https%3A%2F%2Fmonica.cn%2Fapp-download&redirect_macos=https%3A%2F%2Fmonica.cn%2Fapp-download',
                      '_blank'
                    );
                  }}
                  className="p-2 bg-white rounded-full text-xs font-medium text-blue-500 font-bold hover:bg-gray-50 transition-colors shadow-sm flex items-center gap-1"
                >
                  <img src="https://files.monica.cn/assets/botgroup/mobile-banner-mobile.png" className="w-4 h-4" alt="Mobile" />
                  {t('downloadApp')}
                  <img src="https://files.monica.cn/assets/botgroup/arrow-up.png" className="w-4 h-4" alt="" />
                </button>
              ) : (
                <button
                  onClick={() => {
                    window.open('https://monica.cn/home/chat/Monica/monica', '_blank');
                  }}
                  className="p-2 bg-white rounded-full text-xs font-medium text-blue-500 font-bold hover:bg-gray-50 transition-colors shadow-sm flex items-center gap-1"
                >
                  <img src="https://files.monica.cn/assets/botgroup/computer.png" className="w-4 h-4" alt="Computer" />
                  {t('chatOnWeb')}
                  <img src="https://files.monica.cn/assets/botgroup/arrow-up.png" className="w-4 h-4" alt="" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const AdBanner: React.FC<AdBannerProps> = ({ show, closeAd }) => {
  const { t } = useTranslation('ad');
  if (!show) return null;
  return (
    <div
      className="rounded-lg text-center relative overflow-hidden py-2 pl-1 h-8 mr-2 flex flex-col justify-center transition-all duration-200 bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: "url('https://files.monica.cn/assets/botgroup/banner-background.png')" }}
    >
      <AdBadge compact />
      <div className="relative z-10">
        <div className="flex items-center gap-0 justify-center">
          <div className="flex items-center justify-center w-20 pl-2">
            <img src="https://files.monica.cn/assets/botgroup/monica.png" alt="" />
          </div>
          <div className="flex items-center justify-between gap-3 px-2 flex-1">
            <div className="flex items-center gap-3">
              <Popover trigger="click" placement="top" content={<WechatQrCode />}>
                <button className="p-1 bg-white rounded-full text-xs font-medium text-blue-500 font-bold hover:bg-gray-50 transition-colors shadow-sm flex items-center gap-1 group">
                  <img src="https://files.monica.cn/assets/botgroup/wechat.png" className="w-4 h-4" alt="WeChat" />
                  {t('useInWechat')}
                  <img src="https://files.monica.cn/assets/botgroup/arrow-up.png" className="w-4 h-4" alt="" />
                </button>
              </Popover>
              <button
                onClick={() => {
                  window.open('https://monica.cn/home/chat/Monica/monica', '_blank');
                }}
                className="p-1 bg-white rounded-full text-xs font-medium text-blue-500 font-bold hover:bg-gray-50 transition-colors shadow-sm flex items-center gap-1"
              >
                <img src="https://files.monica.cn/assets/botgroup/computer.png" className="w-4 h-4" alt="Computer" />
                {t('chatOnWeb')}
                <img src="https://files.monica.cn/assets/botgroup/arrow-up.png" className="w-4 h-4" alt="" />
              </button>
            </div>
            <button onClick={closeAd} className="flex items-center">
              <img src="https://files.monica.cn/assets/botgroup/banner-delete.png" className="w-4 h-4" alt="Delete" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const AdBannerMobile: React.FC<AdBannerProps> = ({ show, closeAd }) => {
  const { t } = useTranslation('ad');
  if (!show) return null;
  return (
    <div
      className="w-full relative overflow-hidden py-2 pl-2 h-8 flex flex-col justify-center transition-all duration-200 bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: "url('https://files.monica.cn/assets/botgroup/mobile-banner-background.png')" }}
    >
      <AdBadge compact />
      <div className="relative z-10">
        <div className="flex items-center gap-1 justify-center">
          <div className="flex items-center justify-center w-20 pl-2">
            <img src="https://files.monica.cn/assets/botgroup/monica.png" alt="" />
          </div>
          <div className="flex items-center justify-between gap-3 px-2 flex-1">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  window.open('https://mp.weixin.qq.com/s/9l9zz_8wXOmxkKIVd0j9Nw', '_blank');
                }}
                className="p-1 bg-white rounded-full text-xs font-medium text-blue-500 font-bold hover:bg-gray-50 transition-colors shadow-sm flex items-center gap-1 group"
              >
                <img src="https://files.monica.cn/assets/botgroup/wechat.png" className="w-4 h-4" alt="WeChat" />
                {t('useInWechat')}
                <img src="https://files.monica.cn/assets/botgroup/arrow-up.png" className="w-4 h-4" alt="" />
              </button>
              <button
                onClick={() => {
                  window.open(
                    'https://app.adjust.com/1mh0qgab?fallback=https%3A%2F%2Fmonica.cn%2Fapp-download&redirect_macos=https%3A%2F%2Fmonica.cn%2Fapp-download',
                    '_blank'
                  );
                }}
                className="p-1 bg-white rounded-full text-xs font-medium text-blue-500 font-bold hover:bg-gray-50 transition-colors shadow-sm flex items-center gap-1"
              >
                <img src="https://files.monica.cn/assets/botgroup/mobile-banner-mobile.png" className="w-4 h-4" alt="Mobile" />
                {t('downloadApp')}
                <img src="https://files.monica.cn/assets/botgroup/arrow-up.png" className="w-4 h-4" alt="" />
              </button>
            </div>
            <button onClick={closeAd} className="flex items-center">
              <img src="https://files.monica.cn/assets/botgroup/banner-delete.png" className="w-4 h-4" alt="Delete" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export { AdSection, AdBanner, AdBannerMobile };
