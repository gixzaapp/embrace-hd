import { IonButton, IonModal } from '@ionic/react';
import './WhatsAppDeliveredModal.css';

export type WhatsAppDeliveredModalProps = {
  open: boolean;
  onDismiss: () => void;
};

/**
 * Shown after backend convert + WhatsApp delivery (no local share sheet).
 */
export const WhatsAppDeliveredModal: React.FC<WhatsAppDeliveredModalProps> = ({
  open,
  onDismiss,
}) => {
  return (
    <IonModal
      isOpen={open}
      onDidDismiss={onDismiss}
      className="wa-delivered-modal"
      backdropDismiss={true}
    >
      <div
        className="wa-delivered-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wa-delivered-title"
      >
        <p className="wa-delivered-eyebrow">Ready</p>
        <h2 id="wa-delivered-title" className="wa-delivered-title">
          Check your WhatsApp
        </h2>
        <p className="wa-delivered-body">
          Your HD video was sent to the WhatsApp number you signed in with. Open
          WhatsApp to view it, save it, or post it to Status.
        </p>
        <IonButton expand="block" className="wa-delivered-cta" onClick={onDismiss}>
          Done
        </IonButton>
      </div>
    </IonModal>
  );
};
