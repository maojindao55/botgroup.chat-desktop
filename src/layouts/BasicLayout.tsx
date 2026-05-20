import { Outlet, useNavigate } from 'react-router-dom';

export default function BasicLayout() {
  const navigate = useNavigate();
  
  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  return (
    <div className="layout">
      <header className="header">
        <div className="logo">AI Chat</div>
        <button onClick={handleLogout}>退出登录</button>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
} 