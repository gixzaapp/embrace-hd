import { IonButton, IonModal, IonRadio, IonRadioGroup } from '@ionic/react';
import {
  DEFAULT_ENCODE_QUALITY,
  ENCODE_QUALITY_OPTIONS,
  estimateConversionTimeSec,
  formatConversionTime,
  type EncodeQualityChoice,
} from '../services/encodeQuality';
import './QualityDecisionModal.css';

export type QualityDecisionModalProps = {
  open: boolean;
  videoDurationSec: number;
  statusLengthSec: number;
  value: EncodeQualityChoice;
  onChange: (value: EncodeQualityChoice) => void;
  onProceed: (quality: EncodeQualityChoice) => void;
  onCancel: () => void;
};

/**
 * Pre-upload step: pick encode speed/quality, then Proceed to upload + convert.
 */
export const QualityDecisionModal: React.FC<QualityDecisionModalProps> = ({
  open,
  videoDurationSec,
  statusLengthSec,
  value,
  onChange,
  onProceed,
  onCancel,
}) => {
  const selected = value || DEFAULT_ENCODE_QUALITY;

  return (
    <IonModal
      isOpen={open}
      backdropDismiss={false}
      className="quality-decision-modal"
    >
      <div
        className="quality-decision-card"
        role="dialog"
        aria-modal="true"
        aria-label="Choose conversion quality"
      >
        <p className="quality-decision-title">Choose quality</p>
        <p className="quality-decision-hint">
          Higher quality takes longer to convert.
        </p>

        <IonRadioGroup
          value={selected}
          onIonChange={(e) =>
            onChange(e.detail.value as EncodeQualityChoice)
          }
          className="quality-decision-group"
        >
          {ENCODE_QUALITY_OPTIONS.map((opt) => {
            const est = estimateConversionTimeSec({
              videoDurationSec,
              statusLengthSec,
              quality: opt.id,
            });
            const active = selected === opt.id;
            return (
              <label
                key={opt.id}
                className={`quality-option${active ? ' quality-option--active' : ''}`}
              >
                <div className="quality-option-main">
                  <IonRadio value={opt.id} mode="md" />
                  <div className="quality-option-copy">
                    <span className="quality-option-title">
                      {opt.title} — {opt.subtitle}
                    </span>
                    <span className="quality-option-time">
                      Conversion time: {formatConversionTime(est)}
                    </span>
                  </div>
                </div>
              </label>
            );
          })}
        </IonRadioGroup>

        <IonButton
          expand="block"
          className="quality-decision-proceed"
          onClick={() => onProceed(selected)}
        >
          Proceed
        </IonButton>
        <IonButton
          expand="block"
          fill="outline"
          size="small"
          className="quality-decision-cancel"
          onClick={onCancel}
        >
          Cancel
        </IonButton>
      </div>
    </IonModal>
  );
};
