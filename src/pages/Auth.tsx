import { useEffect, useMemo, useState } from 'react';
import {
  IonButton,
  IonContent,
  IonInput,
  IonPage,
  IonSpinner,
  useIonRouter,
} from '@ionic/react';
import { ApiError } from '../services/apiClient';
import { useAuth } from '../ui/AuthProvider';
import { CountryCodePicker } from '../ui/CountryCodePicker';
import { findCountryByCode, type Country } from '../core/countryCodes';
import type { AuthMode } from '../services/authApi';
import './Auth.css';

type Step = 'form' | 'otp';

function buildPhone(dial: string, national: string): string {
  const cc = dial.replace(/[^\d]/g, '');
  const num = national.replace(/[^\d]/g, '');
  return `+${cc}${num}`;
}

const Auth: React.FC = () => {
  const {
    lookupPhone,
    requestOtp,
    verifyOtp,
    isAuthenticated,
    loading: authLoading,
  } = useAuth();
  const router = useIonRouter();

  const [step, setStep] = useState<Step>('form');
  /** After lookup: null = not checked yet; true = need name to register */
  const [needsName, setNeedsName] = useState(false);
  const [mode, setMode] = useState<AuthMode>('login');
  const [name, setName] = useState('');
  const [country, setCountry] = useState<Country>(() => findCountryByCode('NG'));
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

  const title = useMemo(() => {
    if (step === 'otp') return 'Enter WhatsApp code';
    if (needsName) return 'Almost there';
    return "Let's Start";
  }, [step, needsName]);

  const sendCode = async (authMode: AuthMode, phone: string) => {
    const res = await requestOtp({
      phone,
      mode: authMode,
      name: authMode === 'register' ? name.trim() : undefined,
    });
    setMode(authMode);
    setPhoneE164(res.phoneE164);
    setChannel(res.channel);
    setOtpHint(res.otpHint ?? null);
    setCode(res.otpHint ?? '');
    setStep('otp');
    setResendIn(30);
  };

  const onContinue = async () => {
    setError(null);
    const phone = buildPhone(country.dial, national);
    if (national.replace(/\D/g, '').length < 7) {
      setError('Enter a valid phone number');
      return;
    }

    setBusy(true);
    try {
      // New user path: name already shown — register + send code
      if (needsName) {
        if (!name.trim()) {
          setError('Enter your name to continue');
          return;
        }
        await sendCode('register', phone);
        return;
      }

      // First Continue: look up account
      const lookup = await lookupPhone(phone);
      setPhoneE164(lookup.phoneE164);

      if (lookup.exists) {
        // Existing user — send code, do not ask for name
        await sendCode('login', lookup.phoneE164);
        return;
      }

      // New number — ask for name next
      setNeedsName(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not continue — try again'
      );
    } finally {
      setBusy(false);
    }
  };

  const onResend = async () => {
    setError(null);
    const phone = phoneE164 || buildPhone(country.dial, national);
    setBusy(true);
    try {
      await sendCode(mode, phone);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the code');
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
        phone: phoneE164 || buildPhone(country.dial, national),
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

  const primaryLabel = needsName ? 'Send code on WhatsApp' : 'Continue';

  return (
    <IonPage>
      <IonContent className="auth-content" fullscreen>
        <div className="auth-body">
          <p className="auth-eyebrow">Embrace HD</p>
          <h1 className="auth-title">{title}</h1>
          <p className="auth-sub">
            {step === 'otp'
              ? `Enter the code WhatsApp sent to ${phoneE164}.`
              : needsName
                ? 'Enter your name to create your account. We’ll send a code on WhatsApp.'
                : 'No password needed. You’ll receive a login code on WhatsApp.'}
          </p>

          {step === 'form' ? (
            <>
              {needsName ? (
                <div className="auth-field">
                  <label className="auth-field-label" htmlFor="auth-name">
                    Name
                  </label>
                  <IonInput
                    id="auth-name"
                    className="auth-input"
                    fill="outline"
                    value={name}
                    onIonInput={(e) => setName(e.detail.value ?? '')}
                    placeholder="Your name"
                    disabled={busy}
                  />
                </div>
              ) : null}

              <div className="auth-phone-row">
                <CountryCodePicker
                  value={country}
                  onChange={(next) => {
                    setCountry(next);
                    // Changing country/number resets lookup
                    setNeedsName(false);
                    setName('');
                  }}
                  disabled={busy || needsName}
                />
                <div className="auth-field auth-field--phone">
                  <label className="auth-field-label" htmlFor="auth-phone">
                    WhatsApp number
                  </label>
                  <IonInput
                    id="auth-phone"
                    className="auth-input"
                    fill="outline"
                    value={national}
                    onIonInput={(e) => {
                      setNational(e.detail.value ?? '');
                      setNeedsName(false);
                      setName('');
                    }}
                    inputMode="tel"
                    placeholder="8012345678"
                    disabled={busy || needsName}
                  />
                </div>
              </div>

              {needsName ? (
                <IonButton
                  fill="clear"
                  size="small"
                  className="auth-change-number"
                  disabled={busy}
                  onClick={() => {
                    setNeedsName(false);
                    setName('');
                    setError(null);
                  }}
                >
                  Change number
                </IonButton>
              ) : null}

              <IonButton
                expand="block"
                className="auth-primary"
                disabled={busy}
                onClick={() => void onContinue()}
              >
                {busy ? <IonSpinner name="crescent" /> : primaryLabel}
              </IonButton>
            </>
          ) : (
            <>
              <div className="auth-field">
                <label className="auth-field-label" htmlFor="auth-code">
                  6-digit code
                </label>
                <IonInput
                  id="auth-code"
                  className="auth-input"
                  fill="outline"
                  value={code}
                  onIonInput={(e) => setCode(e.detail.value ?? '')}
                  inputMode="numeric"
                  maxlength={6}
                  placeholder="••••••"
                />
              </div>

              {otpHint && channel === 'mock' ? (
                <p className="auth-hint" role="status">
                  Dev mock code: <strong>{otpHint}</strong>
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
                  onClick={() => void onResend()}
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
                    setNeedsName(false);
                    setName('');
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
