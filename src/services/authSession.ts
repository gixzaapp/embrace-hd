export type AuthUser = {
  id: string;
  phoneE164: string;
  name: string | null;
  createdAt: string;
};

export type AuthSession = {
  token: string;
  expiresAt: string;
  user: AuthUser;
};

const SESSION_KEY = 'embrace_hd_session';

async function secureGet(key: string): Promise<string | null> {
  try {
    const { SecureStoragePlugin } = await import('capacitor-secure-storage-plugin');
    const { value } = await SecureStoragePlugin.get({ key });
    return value?.trim() || null;
  } catch {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
}

async function secureSet(key: string, value: string): Promise<void> {
  try {
    const { SecureStoragePlugin } = await import('capacitor-secure-storage-plugin');
    await SecureStoragePlugin.set({ key, value });
    return;
  } catch {
    localStorage.setItem(key, value);
  }
}

async function secureRemove(key: string): Promise<void> {
  try {
    const { SecureStoragePlugin } = await import('capacitor-secure-storage-plugin');
    await SecureStoragePlugin.remove({ key });
  } catch {
    // ignore
  }
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export async function loadAuthSession(): Promise<AuthSession | null> {
  const raw = await secureGet(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed?.token || !parsed?.user?.id) return null;
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() < Date.now()) {
      await clearAuthSession();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function saveAuthSession(session: AuthSession): Promise<void> {
  await secureSet(SESSION_KEY, JSON.stringify(session));
}

export async function clearAuthSession(): Promise<void> {
  await secureRemove(SESSION_KEY);
}
