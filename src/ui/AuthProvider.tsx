import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  fetchAuthMe,
  logoutAuth,
  requestWhatsAppOtp,
  verifyWhatsAppOtp,
  type AuthMode,
  type RequestOtpResponse,
} from '../services/authApi';
import {
  clearAuthSession,
  loadAuthSession,
  saveAuthSession,
  type AuthSession,
  type AuthUser,
} from '../services/authSession';
import { getOrCreateDeviceId } from '../services/deviceId';

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  isAuthenticated: boolean;
  requestOtp: (options: {
    phone: string;
    mode: AuthMode;
    name?: string;
  }) => Promise<RequestOtpResponse>;
  verifyOtp: (options: { phone: string; code: string }) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadAuthSession();
      if (cancelled) return;
      if (!stored) {
        setSession(null);
        setLoading(false);
        return;
      }
      try {
        const me = await fetchAuthMe(stored.token);
        const next: AuthSession = { ...stored, user: me.user };
        await saveAuthSession(next);
        if (!cancelled) setSession(next);
      } catch {
        await clearAuthSession();
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const requestOtp = useCallback(
    async (options: { phone: string; mode: AuthMode; name?: string }) => {
      const deviceId = await getOrCreateDeviceId();
      return requestWhatsAppOtp({
        phone: options.phone,
        mode: options.mode,
        name: options.name,
        deviceId,
      });
    },
    []
  );

  const verifyOtp = useCallback(
    async (options: { phone: string; code: string }) => {
      const deviceId = await getOrCreateDeviceId();
      const result = await verifyWhatsAppOtp({
        phone: options.phone,
        code: options.code,
        deviceId,
      });
      const next: AuthSession = {
        token: result.token,
        expiresAt: result.expiresAt,
        user: result.user,
      };
      await saveAuthSession(next);
      setSession(next);
      return result.user;
    },
    []
  );

  const logout = useCallback(async () => {
    if (session?.token) {
      await logoutAuth(session.token);
    }
    await clearAuthSession();
    setSession(null);
  }, [session?.token]);

  const refreshMe = useCallback(async () => {
    if (!session?.token) return;
    const me = await fetchAuthMe(session.token);
    const next: AuthSession = { ...session, user: me.user };
    await saveAuthSession(next);
    setSession(next);
  }, [session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      token: session?.token ?? null,
      loading,
      isAuthenticated: Boolean(session?.token && session?.user),
      requestOtp,
      verifyOtp,
      logout,
      refreshMe,
    }),
    [session, loading, requestOtp, verifyOtp, logout, refreshMe]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
