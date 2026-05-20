declare module '@/components/goCaptcha/ClickTextCapt.jsx' {
  import React from 'react';

  interface ClickTextCaptProps {
    onVisibleChange: (visible: boolean) => void;
    extraData?: any;
    onSuccess: () => void;
  }

  const ClickTextCapt: React.FC<ClickTextCaptProps>;
  export default ClickTextCapt;
}
