import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { Shield, Inbox, Edit, Activity, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function MainLayout() {
  const { user, logout } = useAuthStore();
  const location = useLocation();

  if (!user) return null; // Wait for AuthGuard/useEffect to redirect

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex">
      {/* Sidebar */}
      <div className="w-64 bg-slate-900 text-white flex flex-col border-r border-slate-800">
        <div className="p-4 flex items-center gap-3 border-b border-slate-800">
          <Shield className="h-8 w-8 text-cyan-400" />
          <span className="text-xl font-bold tracking-tight">QuMail</span>
        </div>

        <div className="p-4 flex-1">
          <nav className="space-y-1">
            <Link to="/compose">
              <Button
                variant="default"
                className="w-full justify-start gap-2 mb-6 bg-cyan-600 hover:bg-cyan-700"
              >
                <Edit className="h-4 w-4" />
                Compose
              </Button>
            </Link>

            <Link to="/inbox">
              <Button
                variant={location.pathname === '/inbox' ? 'secondary' : 'ghost'}
                className="w-full justify-start gap-2"
              >
                <Inbox className="h-4 w-4" />
                Inbox
              </Button>
            </Link>

            <Link to="/monitor">
              <Button
                variant={location.pathname === '/monitor' ? 'secondary' : 'ghost'}
                className="w-full justify-start gap-2"
              >
                <Activity className="h-4 w-4" />
                QKD Monitor
              </Button>
            </Link>
          </nav>
        </div>

        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-sm font-medium">
              {user.displayName?.charAt(0) || user.email.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{user.displayName}</div>
              <div className="text-xs text-slate-400 truncate">{user.email}</div>
            </div>
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 text-slate-400 hover:text-white"
            onClick={() => logout()}
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
