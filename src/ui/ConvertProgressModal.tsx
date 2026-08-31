import { IonButton, IonModal, IonProgressBar, IonSpinner } from '@ionic/react';
import type { ConvertPhase } from '../services/backendExport';
import './ConvertProgressModal.css';

export type ConvertPhaseProgress = Record<ConvertPhase, number>;

export type ConvertProgressModalProps = {
  open: boolean;
  phases: ConvertPhaseProgress;
  activePhase: ConvertPhase;
  /** Abort upload while the file is still uploading. */
  onCancel: () => void;
  /** Dismiss after upload finished — server-side convert continues. */
  onClose: () => void;
  /** Fires after the modal finishes closing (success or cancel). */
  onDidDismiss?: () => void;
};

const PHASE_META: {
  key: ConvertPhase;
  label: string;
  doneLabel: string;
}[] = [
  { key: 'upload', label: 'Uploading video…', doneLabel: 'Uploaded' },
  { key: 'convert', label: 'Converting to HD…', doneLabel: 'Converted' },
  { key: 'send', label: 'Sending to WhatsApp…', doneLabel: 'Sent' },
];

const PHASE_ORDER: ConvertPhase[] = ['upload', 'convert', 'send'];

function phaseState(
  key: ConvertPhase,
  activePhase: ConvertPhase,
  value: number
): 'pending' | 'active' | 'done' {
  if (value >= 1) return 'done';
  if (key === activePhase) return 'active';
  const keyIdx = PHASE_ORDER.indexOf(key);
  const activeIdx = PHASE_ORDER.indexOf(activePhase);
  if (keyIdx < activeIdx) return 'done';
  return 'pending';
}

/**
 * Convert modal: three phase bars (upload / convert / send).
 * Completed bars stay at 100% so progress is clear.
 */
export const ConvertProgressModal: React.FC<ConvertProgressModalProps> = ({
  open,
  phases,
  activePhase,
  onCancel,
  onClose,
  onDidDismiss,
}) => {
  const uploadComplete = (phases.upload ?? 0) >= 1;

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
        aria-label="Convert progress"
      >
        <div className="convert-progress-head">
          <IonSpinner name="crescent" className="convert-progress-spinner" />
          <p className="convert-progress-title">Preparing your HD video</p>
        </div>

        <div className="convert-progress-phases">
          {PHASE_META.map(({ key, label, doneLabel }) => {
            const raw = phases[key] ?? 0;
            const state = phaseState(key, activePhase, raw);
            const value = state === 'done' ? 1 : state === 'pending' ? 0 : raw;
            const clamped = Math.min(1, Math.max(0, value));
            const percent = Math.round(clamped * 100);
            const rowLabel =
              state === 'done' ? doneLabel : state === 'active' ? label : label.replace('…', '');

            return (
              <div
                key={key}
                className={`convert-phase convert-phase--${state}`}
              >
                <div className="convert-phase-row">
                  <span className="convert-phase-label">{rowLabel}</span>
                  <span className="convert-phase-pct">
                    {state === 'pending' ? '—' : `${percent}%`}
                  </span>
                </div>
                <IonProgressBar
                  value={clamped}
                  className={`convert-progress-bar convert-progress-bar--${state}`}
                />
              </div>
            );
          })}
        </div>

        {uploadComplete ? (
          <p className="convert-progress-dismiss-hint">
            HD conversion can take a while. You can wait here or close this dialog — we
            will keep converting on our servers and send the finished video to your registered
            WhatsApp number.
          </p>
        ) : null}

        <IonButton
          expand="block"
          fill="outline"
          size="small"
          className="convert-progress-cancel"
          onClick={uploadComplete ? onClose : onCancel}
        >
          {uploadComplete ? 'Close' : 'Cancel'}
        </IonButton>
      </div>
    </IonModal>
  );
};
