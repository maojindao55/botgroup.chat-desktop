import { Navigate } from 'react-router-dom';
import { isParentAreaUnlocked } from '@/config/parentGate';
import Chat from '../chat';

/** 临时家长区：复用原来的成人界面（模型服务、角色、设置），需先在儿童端通过算术题验证 */
export default function ParentArea() {
  if (!isParentAreaUnlocked()) return <Navigate to="/" replace />;
  return <Chat />;
}
