import { useEffect, useState } from 'react';

import { FALLBACK_APP_VERSION, getAppVersion } from '@/utils/appVersion';

/**
 * 读取当前应用版本号。
 * 初始返回打包时的回退版本，挂载后异步解析为运行时真实版本。
 */
export function useAppVersion(): string {
  const [version, setVersion] = useState<string>(FALLBACK_APP_VERSION);

  useEffect(() => {
    let active = true;
    getAppVersion()
      .then((v) => {
        if (active) setVersion(v);
      })
      .catch(() => {
        /* 解析失败时保留回退版本 */
      });
    return () => {
      active = false;
    };
  }, []);

  return version;
}
