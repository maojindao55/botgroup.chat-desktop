import React from 'react';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="flex flex-col min-h-screen">
      <div className="flex flex-1">
        <main className="flex-1 pt-14">
          {children}
        </main>
      </div>
    </div>
  );
};

export default Layout; 