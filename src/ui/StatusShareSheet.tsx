import { IonButton, IonModal } from '@ionic/react';
import './StatusShareSheet.css';

export type StatusShareSheetProps = {
  open: boolean;
  fileUri: string | null;
  onDismiss: () => void;
  onPostToStatus: () => void;
  onBestQuality: () => void;
  /** Save / share to Files, Drive, or a network folder for PC → WhatsApp Web */
  onShareToFolder?: () => void;
  busy?: boolean;
};

/**
 * Best quality: save file → open on PC → send via WhatsApp Web (no phone Status re-encode).
 */
export const StatusShareSheet: React.FC<StatusShareSheetProps> = ({
  open,
  fileUri,
  onDismiss,
  onPostToStatus,
  onBestQuality,
  onShareToFolder,
  busy = false,
}) => {
  const ready = Boolean(fileUri) && !busy;

  return (
    <IonModal
      isOpen={open}
      onDidDismiss={onDismiss}
      className="status-share-sheet"
      breakpoints={[0, 0.78, 0.92]}
      initialBreakpoint={0.92}
      handle={true}
    >
      <div className="status-share-sheet-body">
        <p className="status-share-eyebrow">Best quality path</p>
        <h2 className="status-share-title">Send via WhatsApp Web</h2>
        <p className="status-share-sub">
          Phone Status upload re-compresses. WhatsApp Web keeps the converted
          file quality — save to a folder, open on your PC, then send.
        </p>

        <div className="status-share-actions">
          {onShareToFolder ? (
            <>
              <IonButton
                expand="block"
                className="status-share-primary"
                disabled={!ready}
                onClick={onShareToFolder}
              >
                Save for WhatsApp Web (PC)
              </IonButton>
              <ol className="status-share-steps">
                <li>Save to Files, Drive, or a network shared folder.</li>
                <li>Open the file on your computer.</li>
                <li>
                  Send with <strong>web.whatsapp.com</strong> (or Desktop).
                </li>
                <li>Optional: Forward that chat → My Status.</li>
              </ol>
            </>
          ) : null}

          <IonButton
            expand="block"
            fill="outline"
            className="status-share-secondary"
            disabled={!ready}
            onClick={onBestQuality}
          >
            Phone · HD chat → Status
          </IonButton>
          <p className="status-share-hint">
            On phone: send with HD, then Forward → My Status.
          </p>

          <IonButton
            expand="block"
            fill="outline"
            className="status-share-secondary"
            disabled={!ready}
            onClick={onPostToStatus}
          >
            Post to Status on phone
          </IonButton>
          <p className="status-share-hint">
            Fastest — WhatsApp will re-encode and quality drops.
          </p>
        </div>

        <IonButton
          expand="block"
          fill="clear"
          className="status-share-dismiss"
          onClick={onDismiss}
        >
          Not now — saved in Crop
        </IonButton>
      </div>
    </IonModal>
  );
};
