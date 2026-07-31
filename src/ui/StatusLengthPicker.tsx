import { IonLabel, IonSegment, IonSegmentButton, IonText } from '@ionic/react';
import {
  STATUS_LENGTH_OPTIONS,
  type StatusLengthSec,
} from '../core';
import './StatusLengthPicker.css';

type StatusLengthPickerProps = {
  value: StatusLengthSec;
  onChange: (length: StatusLengthSec) => void;
  disabled?: boolean;
  /** Lengths that stay visible but cannot be selected (e.g. 60 after trial). */
  restrictedLengths?: StatusLengthSec[];
  onRestrictedSelect?: (length: StatusLengthSec) => void;
};

export const StatusLengthPicker: React.FC<StatusLengthPickerProps> = ({
  value,
  onChange,
  disabled,
  restrictedLengths = [],
  onRestrictedSelect,
}) => (
  <div className="status-length-picker">
    <IonText>
      <p className="status-length-label">Status length</p>
    </IonText>
    <IonSegment
      key={`status-len-${value}`}
      value={String(value)}
      disabled={disabled}
      onIonChange={(e) => {
        const next = Number(e.detail.value);
        if (!STATUS_LENGTH_OPTIONS.includes(next as StatusLengthSec)) return;
        const length = next as StatusLengthSec;
        if (restrictedLengths.includes(length)) {
          onRestrictedSelect?.(length);
          return;
        }
        onChange(length);
      }}
    >
      {STATUS_LENGTH_OPTIONS.map((sec) => (
        <IonSegmentButton
          key={sec}
          value={String(sec)}
          className={
            restrictedLengths.includes(sec) ? 'status-length-restricted' : undefined
          }
        >
          <IonLabel>{sec}s</IonLabel>
        </IonSegmentButton>
      ))}
    </IonSegment>
  </div>
);
