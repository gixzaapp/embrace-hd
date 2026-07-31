import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { IonToast } from '@ionic/react';
import { ApiError } from '../services/apiClient';
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

function isInvalidSessionError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ open: boolean; message: string }>({
    open: false,
    message: '',
  });

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

      // Keep the local session while we verify — never blank the UI on offline.
      setSession(stored);

      try {
        const me = await fetchAuthMe(stored.token);
        const next: AuthSession = { ...stored, user: me.user };
        await saveAuthSession(next);
        if (!cancelled) setSession(next);
      } catch (err) {
        if (isInvalidSessionError(err)) {
          await clearAuthSession();
          if (!cancelled) {
            setSession(null);
            setToast({
              open: true,
              message: 'Session expired — please sign in again',
            });
          }
        } else if (!cancelled) {
          // Offline / server error — stay signed in with cached user
          setToast({
            open: true,
            message:
              err instanceof ApiError && err.status === 0
                ? 'No network — using offline session'
                : 'Could not reach server — using offline session',
          });
        }
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
    try {
      const me = await fetchAuthMe(session.token);
      const next: AuthSession = { ...session, user: me.user };
      await saveAuthSession(next);
      setSession(next);
    } catch (err) {
      if (isInvalidSessionError(err)) {
        await clearAuthSession();
        setSession(null);
        setToast({
          open: true,
          message: 'Session expired — please sign in again',
        });
        return;
      }
      setToast({
        open: true,
        message:
          err instanceof ApiError && err.status === 0
            ? 'No network — using offline session'
            : 'Could not reach server — using offline session',
      });
    }
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

  return (
    <AuthContext.Provider value={value}>
      {children}
      <IonToast
        className="eh-toast"
        isOpen={toast.open}
        message={toast.message}
        duration={3200}
        position="bottom"
        onDidDismiss={() => setToast((t) => ({ ...t, open: false }))}
      />
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
