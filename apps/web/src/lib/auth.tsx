import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { hasPermission, type AuthUser, type MeResponse, type Permission } from '@azhoot/contracts';
import { api, ApiError, setCsrfToken } from './api';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  can: (p: Permission) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export const ME_KEY = ['auth', 'me'] as const;

async function fetchMe(): Promise<MeResponse | null> {
  try {
    const me = await api<MeResponse>('/auth/me');
    setCsrfToken(me.csrfToken);
    return me;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      setCsrfToken(null);
      return null;
    }
    throw err;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: 5 * 60_000, retry: 1 });

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api<MeResponse>('/auth/login', { body: { email, password } });
      setCsrfToken(res.csrfToken);
      qc.setQueryData(ME_KEY, res);
      return res.user;
    },
    [qc],
  );

  const logout = useCallback(async () => {
    // Mesmo se a chamada ao servidor falhar, encerramos a sessão localmente.
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    setCsrfToken(null);
    // Zera o usuário sem disparar um refetch de /auth/me (que manteria o usuário
    // anterior em cache enquanto recarrega) e limpa os dados das demais telas.
    qc.setQueryData(ME_KEY, null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
  }, [qc]);

  const value = useMemo<AuthState>(() => {
    const user = me.data?.user ?? null;
    return {
      user,
      loading: me.isPending,
      login,
      logout,
      can: (p) => (user ? hasPermission(user.role, p) : false),
    };
  }, [me.data, me.isPending, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
