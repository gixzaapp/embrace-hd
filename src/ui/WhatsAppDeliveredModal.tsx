import { useEffect, useState } from 'react';
import { IonButton, IonModal, IonSpinner } from '@ionic/react';
import { galleryDisplaySrc } from '../services/galleryLibrary';
import './WhatsAppDeliveredModal.css';

export type WhatsAppDeliveredModalProps = {
  open: boolean;
  /** Local preview copies. Empty means WhatsApp-only (preview flag off). */
  previewUris?: string[];
  onSave?: (uri: string) => Promise<void>;
  onDismiss: () => void;
};

/**
 * Shown after backend convert. With preview files, plays the copy in the app
 * and offers Save. WhatsApp delivery is unchanged either way.
 */
export const WhatsAppDeliveredModal: React.FC<WhatsAppDeliveredModalProps> = ({
  open,
  previewUris = [],
  onSave,
  onDismiss,
}) => {
  const [part, setPart] = useState(0);
  const [saving, setSaving] = useState(false);
  const hasPreview = previewUris.length > 0;
  const uri = previewUris[part] ?? '';

  useEffect(() => {
    if (open) setPart(0);
  }, [open, previewUris]);

  const onSaveClick = async () => {
    if (!uri || !onSave) return;
    setSaving(true);
    try {
      await onSave(uri);
    } finally {
      setSaving(false);
    }
  };

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
        <p className="wa-delivered-eyebrow">{hasPreview ? 'Preview' : 'Ready'}</p>
        <h2 id="wa-delivered-title" className="wa-delivered-title">
          {hasPreview ? 'Your HD video is ready' : 'Check your WhatsApp'}
        </h2>
        {hasPreview ? (
          <>
            <video
              key={uri}
              className="wa-delivered-video"
              src={galleryDisplaySrc(uri)}
              controls
              playsInline
            />
            {previewUris.length > 1 ? (
              <div className="wa-delivered-parts">
                <IonButton
                  fill="clear"
                  size="small"
                  disabled={part === 0}
                  onClick={() => setPart((n) => Math.max(0, n - 1))}
                >
                  Previous
                </IonButton>
                <span>
                  Part {part + 1} of {previewUris.length}
                </span>
                <IonButton
                  fill="clear"
                  size="small"
                  disabled={part >= previewUris.length - 1}
                  onClick={() => setPart((n) => Math.min(previewUris.length - 1, n + 1))}
                >
                  Next
                </IonButton>
              </div>
            ) : null}
            <p className="wa-delivered-body">
              We sent the finished video to your WhatsApp. Open that chat to post
              it as your Status. This is only a preview in the app. Save keeps a
              copy on this device.
            </p>
            <IonButton
              expand="block"
              className="wa-delivered-cta"
              disabled={saving || !onSave}
              onClick={() => void onSaveClick()}
            >
              {saving ? <IonSpinner name="crescent" /> : 'Save'}
            </IonButton>
          </>
        ) : (
          <p className="wa-delivered-body">
            Your HD video was sent to the WhatsApp number you signed in with. Open
            WhatsApp to view it, save it, or post it to Status.
          </p>
        )}
        <IonButton
          expand="block"
          fill={hasPreview ? 'clear' : undefined}
          className={hasPreview ? 'wa-delivered-dismiss' : 'wa-delivered-cta'}
          onClick={onDismiss}
        >
          Done
        </IonButton>
      </div>
    </IonModal>
  );
};
