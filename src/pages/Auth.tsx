import { useEffect, useMemo, useState } from 'react';
import {
  IonButton,
  IonContent,
  IonInput,
  IonPage,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonSpinner,
  useIonRouter,
} from '@ionic/react';
import { ApiError } from '../services/apiClient';
import { useAuth } from '../ui/AuthProvider';
import type { AuthMode } from '../services/authApi';
import './Auth.css';

type Step = 'form' | 'otp';

function buildPhone(countryCode: string, national: string): string {
  const cc = countryCode.replace(/[^\d]/g, '');
  const num = national.replace(/[^\d]/g, '');
  return `+${cc}${num}`;
}

const Auth: React.FC = () => {
  const { requestOtp, verifyOtp, isAuthenticated, loading: authLoading } = useAuth();
  const router = useIonRouter();

  const [mode, setMode] = useState<AuthMode>('login');
  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState('');
  const [countryCode, setCountryCode] = useState('234');
  const [national, setNational] = useState('');
  const [code, setCode] = useState('');
  const [phoneE164, setPhoneE164] = useState('');
  const [otpHint, setOtpHint] = useState<string | null>(null);
  const [channel, setChannel] = useState<'whatsapp' | 'mock' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.push('/home', 'root', 'replace');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  const title = useMemo(
    () =>
      step === 'otp'
        ? 'Enter WhatsApp code'
        : mode === 'register'
          ? 'Create account'
          : 'Sign in',
    [step, mode]
  );

  const onRequestOtp = async () => {
    setError(null);
    const phone = buildPhone(countryCode, national);
    if (national.replace(/\D/g, '').length < 7) {
      setError('Enter a valid phone number');
      return;
    }
    if (mode === 'register' && !name.trim()) {
      setError('Enter your name to register');
      return;
    }

    setBusy(true);
    try {
      const res = await requestOtp({
        phone,
        mode,
        name: mode === 'register' ? name.trim() : undefined,
      });
      setPhoneE164(res.phoneE164);
      setChannel(res.channel);
      setOtpHint(res.otpHint ?? null);
      setCode(res.otpHint ?? '');
      setStep('otp');
      setResendIn(30);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send OTP');
    } finally {
      setBusy(false);
    }
  };

  const onVerify = async () => {
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code');
      return;
    }
    setBusy(true);
    try {
      await verifyOtp({
        phone: phoneE164 || buildPhone(countryCode, national),
        code: code.trim(),
      });
      router.push('/home', 'root', 'replace');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  };

  if (authLoading) {
    return (
      <IonPage>
        <IonContent className="auth-content" fullscreen>
          <div className="auth-loading">
            <IonSpinner name="crescent" />
          </div>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonContent className="auth-content" fullscreen>
        <div className="auth-body">
          <p className="auth-eyebrow">Embrace HD</p>
          <h1 className="auth-title">{title}</h1>
          <p className="auth-sub">
            {step === 'otp'
              ? `Enter the code WhatsApp sent to ${phoneE164}.`
              : mode === 'register'
                ? 'Create your account with your WhatsApp number.'
                : 'Sign in with a one-time code sent on WhatsApp.'}
          </p>

          {step === 'form' ? (
            <>
              <IonSegment
                value={mode}
                onIonChange={(e) => {
                  setMode((e.detail.value as AuthMode) || 'login');
                  setStep('form');
                  setError(null);
                }}
                className="auth-segment"
              >
                <IonSegmentButton value="login">
                  <IonLabel>Login</IonLabel>
                </IonSegmentButton>
                <IonSegmentButton value="register">
                  <IonLabel>Register</IonLabel>
                </IonSegmentButton>
              </IonSegment>

              {mode === 'register' ? (
                <IonInput
                  className="auth-input"
                  label="Name"
                  labelPlacement="stacked"
                  fill="outline"
                  value={name}
                  onIonInput={(e) => setName(e.detail.value ?? '')}
                  placeholder="Your name"
                />
              ) : null}

              <div className="auth-phone-row">
                <IonInput
                  className="auth-input auth-input--cc"
                  label="Code"
                  labelPlacement="stacked"
                  fill="outline"
                  value={countryCode}
                  onIonInput={(e) => setCountryCode(e.detail.value ?? '')}
                  inputMode="numeric"
                  placeholder="234"
                />
                <IonInput
                  className="auth-input auth-input--phone"
                  label="WhatsApp number"
                  labelPlacement="stacked"
                  fill="outline"
                  value={national}
                  onIonInput={(e) => setNational(e.detail.value ?? '')}
                  inputMode="tel"
                  placeholder="8012345678"
                />
              </div>

              <IonButton
                expand="block"
                className="auth-primary"
                disabled={busy}
                onClick={() => void onRequestOtp()}
              >
                {busy ? <IonSpinner name="crescent" /> : 'Send OTP on WhatsApp'}
              </IonButton>
            </>
          ) : (
            <>
              <IonInput
                className="auth-input"
                label="6-digit code"
                labelPlacement="stacked"
                fill="outline"
                value={code}
                onIonInput={(e) => setCode(e.detail.value ?? '')}
                inputMode="numeric"
                maxlength={6}
                placeholder="••••••"
              />

              {otpHint && channel === 'mock' ? (
                <p className="auth-hint" role="status">
                  Dev mock OTP: <strong>{otpHint}</strong>
                </p>
              ) : null}

              <IonButton
                expand="block"
                className="auth-primary"
                disabled={busy}
                onClick={() => void onVerify()}
              >
                {busy ? <IonSpinner name="crescent" /> : 'Verify & continue'}
              </IonButton>

              <div className="auth-otp-actions">
                <IonButton
                  fill="clear"
                  size="small"
                  disabled={busy || resendIn > 0}
                  onClick={() => void onRequestOtp()}
                >
                  {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                </IonButton>
                <IonButton
                  fill="clear"
                  size="small"
                  disabled={busy}
                  onClick={() => {
                    setStep('form');
                    setCode('');
                    setOtpHint(null);
                    setError(null);
                  }}
                >
                  Change number
                </IonButton>
              </div>
            </>
          )}

          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Auth;
