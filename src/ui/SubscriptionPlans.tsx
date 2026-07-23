import { useState } from 'react';
import { IonButton, IonSpinner, IonText } from '@ionic/react';
import { SUBSCRIPTION_PLANS, type SubscriptionPlanId } from '../core/subscription';
import { purchaseManager } from '../services/purchaseManager';
import { useTrial } from './TrialProvider';
import './SubscriptionPlans.css';

const PLAN_ORDER: SubscriptionPlanId[] = ['monthly', 'yearly', 'lifetime'];

type SubscriptionPlansProps = {
  /** Show even when premium already unlocked (e.g. manage) */
  forceShow?: boolean;
};

export const SubscriptionPlans: React.FC<SubscriptionPlansProps> = ({ forceShow }) => {
  const { premiumUnlocked, isSubscribed, refresh } = useTrial();
  const [busyPlan, setBusyPlan] = useState<SubscriptionPlanId | 'restore' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!forceShow && isSubscribed) {
    return null;
  }

  // Hide upsell on Home during active trial; Settings uses forceShow
  if (!forceShow && premiumUnlocked && !isSubscribed) {
    return null;
  }

  const run = async (action: () => Promise<unknown>, key: SubscriptionPlanId | 'restore') => {
    setBusyPlan(key);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Purchase failed';
      // User cancel is common — keep soft
      if (!/cancel/i.test(message)) {
        setError(message);
      }
    } finally {
      setBusyPlan(null);
    }
  };

  return (
    <div className="subscription-plans">
      <IonText>
        <p className="subscription-plans-title">Unlock Premium</p>
        <p className="subscription-plans-sub">
          Monthly, yearly, or optional lifetime — HD WhatsApp Status without limits.
        </p>
      </IonText>

      <div className="subscription-plans-actions">
        {PLAN_ORDER.map((planId) => {
          const plan = SUBSCRIPTION_PLANS[planId];
          return (
            <IonButton
              key={planId}
              expand="block"
              fill={planId === 'yearly' ? 'solid' : 'outline'}
              disabled={busyPlan !== null}
              onClick={() => run(() => purchaseManager.purchasePlan(planId), planId)}
            >
              {busyPlan === planId ? <IonSpinner name="crescent" /> : plan.label}
              {plan.optional ? ' (optional)' : ''}
            </IonButton>
          );
        })}

        <IonButton
          expand="block"
          fill="clear"
          disabled={busyPlan !== null}
          onClick={() => run(() => purchaseManager.restorePurchases(), 'restore')}
        >
          {busyPlan === 'restore' ? <IonSpinner name="crescent" /> : 'Restore purchases'}
        </IonButton>
      </div>

      {error ? (
        <IonText color="danger">
          <p className="subscription-plans-error">{error}</p>
        </IonText>
      ) : null}
    </div>
  );
};
