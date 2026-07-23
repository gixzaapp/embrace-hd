export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getApiBaseUrl(): string | null {
  const raw = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, '');
}

/**
 * Backend is opt-in for testing.
 * Requires VITE_BACKEND_ENABLED=true and VITE_API_BASE_URL.
 */
export function isBackendEnabled(): boolean {
  if (import.meta.env.VITE_BACKEND_ENABLED !== 'true') return false;
  return Boolean(getApiBaseUrl());
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new ApiError('VITE_API_BASE_URL is not set', 0);
  }

  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const message =
      typeof data === 'object' &&
      data &&
      'error' in data &&
      typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `API ${res.status}`;
    throw new ApiError(message, res.status, data);
  }

  return data as T;
}
