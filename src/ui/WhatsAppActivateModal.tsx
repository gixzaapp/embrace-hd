import { IonButton, IonModal } from '@ionic/react';
import './WhatsAppActivateModal.css';

export type WhatsAppActivateModalProps = {
  open: boolean;
  busy?: boolean;
  onActivate: () => void;
  onDismiss: () => void;
};

/**
 * Shown when the WhatsApp 24h window is closed — explain first, then open WhatsApp on Activate.
 */
export const WhatsAppActivateModal: React.FC<WhatsAppActivateModalProps> = ({
  open,
  busy,
  onActivate,
  onDismiss,
}) => {
  return (
    <IonModal
      isOpen={open}
      onDidDismiss={onDismiss}
      className="wa-activate-modal"
      backdropDismiss={!busy}
    >
      <div
        className="wa-activate-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wa-activate-title"
      >
        <p className="wa-activate-eyebrow">One quick step</p>
        <h2 id="wa-activate-title" className="wa-activate-title">
          WhatsApp activation needed
        </h2>
        <p className="wa-activate-body">
          Tap Activate to open your WhatsApp and enable HD convert.
        </p>
        <IonButton
          expand="block"
          className="wa-activate-cta"
          disabled={busy}
          onClick={onActivate}
        >
          Activate
        </IonButton>
      </div>
    </IonModal>
  );
};
