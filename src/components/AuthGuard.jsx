import { Navigate, useLocation } from 'react-router-dom';

export default function AuthGuard({ children }) {
  //判断环境变量中的AUTH_ACCESS是否为1开启权限校验
  //const authAccess = import.meta.env.AUTH_ACCESS;
  const authAccess = window.APP_CONFIG?.AUTH_ACCESS || 
  import.meta.env.AUTH_ACCESS || 
  '0';
  console.log(authAccess, 'authAccess');
  if (authAccess === '1') {
    const location = useLocation();
    const token = localStorage.getItem('token');
    
    if (!token && location.pathname !== '/login') {
      return <Navigate to="/login" state={{ from: location }} replace />;
    }
  
    if (token && location.pathname === '/login') {
      return <Navigate to="/" replace />;
    }
  }


  return children;
} 