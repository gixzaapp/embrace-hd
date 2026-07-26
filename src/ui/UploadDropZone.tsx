import './UploadDropZone.css';

type UploadDropZoneProps = {
  selectedName?: string | null;
  disabled?: boolean;
  onClick: () => void;
};

export const UploadDropZone: React.FC<UploadDropZoneProps> = ({
  selectedName,
  disabled,
  onClick,
}) => (
  <button
    type="button"
    className={`upload-zone glass-card${disabled ? ' upload-zone--disabled' : ''}`}
    onClick={onClick}
    disabled={disabled}
  >
    <div className="upload-zone-icon-wrap">
      <span className="material-symbols-outlined upload-zone-icon" aria-hidden>
        cloud_upload
      </span>
    </div>
    <div className="upload-zone-copy">
      <h2 className="upload-zone-title">
        {selectedName ? 'Media selected' : 'Upload Media'}
      </h2>
      <p className="upload-zone-sub">
        {selectedName
          ? selectedName
          : 'Tap to browse video for WhatsApp Status'}
      </p>
    </div>
    <div className="upload-zone-chips">
      <span className="upload-zone-chip font-label-sm">Auto HD</span>
      <span className="upload-zone-chip font-label-sm">9:16</span>
    </div>
  </button>
);
