import { Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from '@/pages/LoginPage';
import { InboxPage } from '@/pages/InboxPage';
import { ComposePage } from '@/pages/ComposePage';
import { ReadEmailPage } from '@/pages/ReadEmailPage';
import { MonitorPage } from '@/pages/MonitorPage';
import { MainLayout } from '@/components/layout/MainLayout';
import { useAuthStore } from '@/store/auth';
import { useEffect } from 'react';
import { Toaster } from '@/components/ui/toaster';

function App() {
  const { fetchUser, isLoading } = useAuthStore();

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Loading QuMail...</div>;
  }

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        
        <Route element={<MainLayout />}>
          <Route path="/" element={<Navigate to="/inbox" replace />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/compose" element={<ComposePage />} />
          <Route path="/read/:id" element={<ReadEmailPage />} />
          <Route path="/monitor" element={<MonitorPage />} />
        </Route>
      </Routes>
      <Toaster />
    </>
  );
}

export default App;
