const DEVICE_ID_KEY = 'embrace_hd_device_id';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Stable device / app-user id for RevenueCat + backend trial claims.
 * Stored in Secure Storage when available; falls back to localStorage.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  try {
    const { SecureStoragePlugin } = await import('capacitor-secure-storage-plugin');
    try {
      const { value } = await SecureStoragePlugin.get({ key: DEVICE_ID_KEY });
      if (value?.trim()) return value.trim();
    } catch {
      // missing key
    }
    const id = randomId();
    await SecureStoragePlugin.set({ key: DEVICE_ID_KEY, value: id });
    return id;
  } catch {
    try {
      const existing = localStorage.getItem(DEVICE_ID_KEY);
      if (existing?.trim()) return existing.trim();
      const id = randomId();
      localStorage.setItem(DEVICE_ID_KEY, id);
      return id;
    } catch {
      return randomId();
    }
  }
}
