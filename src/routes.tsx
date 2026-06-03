import { createBrowserRouter, Navigate } from 'react-router-dom';
import Chat from './pages/chat';
import BasicLayout from './layouts/BasicLayout';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <BasicLayout />,
    children: [
      {
        path: '',
        element: <Chat />,
      },
    ],
  },
  {
    path: '/login',
    element: <Navigate to="/" replace />,
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
]); 
