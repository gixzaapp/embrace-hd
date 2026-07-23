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
};

export const StatusLengthPicker: React.FC<StatusLengthPickerProps> = ({
  value,
  onChange,
  disabled,
}) => (
  <div className="status-length-picker">
    <IonText>
      <p className="status-length-label">Status length</p>
    </IonText>
    <IonSegment
      value={String(value)}
      disabled={disabled}
      onIonChange={(e) => {
        const next = Number(e.detail.value);
        if (STATUS_LENGTH_OPTIONS.includes(next as StatusLengthSec)) {
          onChange(next as StatusLengthSec);
        }
      }}
    >
      {STATUS_LENGTH_OPTIONS.map((sec) => (
        <IonSegmentButton key={sec} value={String(sec)}>
          <IonLabel>{sec}s</IonLabel>
        </IonSegmentButton>
      ))}
    </IonSegment>
  </div>
);
