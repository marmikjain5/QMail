import { create } from 'zustand';
import { api } from '@/lib/api';

interface User {
  id: string;
  email: string;
  displayName?: string;
  connectedAccounts: Array<{
    provider: 'GMAIL' | 'MICROSOFT';
    emailAddress: string;
  }>;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  fetchUser: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  fetchUser: async () => {
    try {
      const res = await api.get<User>('/auth/me');
      set({ user: res.data, isAuthenticated: true, isLoading: false });
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },
  logout: async () => {
    try {
      await api.post('/auth/logout');
      set({ user: null, isAuthenticated: false });
      window.location.href = '/login';
    } catch (err) {
      console.error('Logout failed', err);
    }
  },
}));
