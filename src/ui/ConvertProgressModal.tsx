import { IonButton, IonModal, IonProgressBar, IonSpinner } from '@ionic/react';
import './ConvertProgressModal.css';

export type ConvertProgressModalProps = {
  open: boolean;
  progress: number; // 0–1
  statusLabel?: string;
  onCancel: () => void;
  /** Fires after the modal finishes closing (success or cancel). */
  onDidDismiss?: () => void;
};

/**
 * Convert modal: progress + cancel. Interstitial ads are owned by Home so
 * the share sheet can wait for them before presenting.
 */
export const ConvertProgressModal: React.FC<ConvertProgressModalProps> = ({
  open,
  progress,
  statusLabel = 'Uploading & converting…',
  onCancel,
  onDidDismiss,
}) => {
  const clamped = Math.min(1, Math.max(0, progress));
  const percent = Math.round(clamped * 100);

  return (
    <IonModal
      isOpen={open}
      backdropDismiss={false}
      className="convert-progress-modal"
      onDidDismiss={onDidDismiss}
    >
      <div
        className="convert-progress-card"
        role="dialog"
        aria-modal="true"
        aria-label="Upload progress"
      >
        <div className="convert-progress-head">
          <IonSpinner name="crescent" className="convert-progress-spinner" />
          <div className="convert-progress-info">
            <p className="convert-progress-status">{statusLabel}</p>
            <span className="convert-progress-pct">{percent}%</span>
          </div>
        </div>

        <IonProgressBar value={clamped} className="convert-progress-bar" />

        <IonButton
          expand="block"
          fill="outline"
          size="small"
          className="convert-progress-cancel"
          onClick={onCancel}
        >
          Cancel
        </IonButton>
      </div>
    </IonModal>
  );
};
