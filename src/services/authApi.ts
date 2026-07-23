import { apiFetch, getApiBaseUrl, isBackendEnabled, ApiError } from './apiClient';
import type { AuthUser } from './authSession';

export type AuthMode = 'login' | 'register';

export type RequestOtpResponse = {
  ok: boolean;
  phoneE164: string;
  mode: AuthMode;
  channel: 'whatsapp' | 'mock';
  expiresInSec: number;
  whatsappConfigured: boolean;
  otpHint?: string;
};

export type VerifyOtpResponse = {
  ok: boolean;
  token: string;
  expiresAt: string;
  user: AuthUser;
};

function requireBackend(): void {
  if (!isBackendEnabled() || !getApiBaseUrl()) {
    throw new ApiError(
      'Backend is required for WhatsApp login — set VITE_BACKEND_ENABLED and VITE_API_BASE_URL',
      0
    );
  }
}

export async function requestWhatsAppOtp(options: {
  phone: string;
  mode: AuthMode;
  name?: string;
  deviceId?: string;
}): Promise<RequestOtpResponse> {
  requireBackend();
  return apiFetch<RequestOtpResponse>('/v1/auth/request-otp', {
    method: 'POST',
    body: JSON.stringify({
      phone: options.phone,
      mode: options.mode,
      name: options.name,
      deviceId: options.deviceId,
    }),
  });
}

export async function verifyWhatsAppOtp(options: {
  phone: string;
  code: string;
  deviceId?: string;
}): Promise<VerifyOtpResponse> {
  requireBackend();
  return apiFetch<VerifyOtpResponse>('/v1/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({
      phone: options.phone,
      code: options.code,
      deviceId: options.deviceId,
    }),
  });
}

export async function fetchAuthMe(token: string): Promise<{ user: AuthUser }> {
  requireBackend();
  return apiFetch<{ user: AuthUser }>('/v1/auth/me', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

export async function logoutAuth(token: string): Promise<void> {
  requireBackend();
  try {
    await apiFetch<{ ok: boolean }>('/v1/auth/logout', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: '{}',
    });
  } catch {
    // Local logout still proceeds
  }
}
