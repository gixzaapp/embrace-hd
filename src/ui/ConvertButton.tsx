import './ConvertButton.css';

type ConvertButtonProps = {
  label: string;
  sublabel?: string;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
};

export const ConvertButton: React.FC<ConvertButtonProps> = ({
  label,
  sublabel = 'HD 720p / 1080p · 30s / 60s · on-device',
  disabled,
  busy,
  onClick,
}) => (
  <div className="convert-wrap">
    <button
      type="button"
      className="convert-btn glow-primary"
      onClick={onClick}
      disabled={disabled || busy}
    >
      <span className="convert-btn-sheen" aria-hidden />
      <span
        className={`material-symbols-outlined convert-btn-icon${busy ? ' convert-btn-icon--spin' : ''}`}
        aria-hidden
      >
        {busy ? 'progress_activity' : 'auto_awesome'}
      </span>
      <span className="convert-btn-label">{busy ? 'Processing…' : label}</span>
    </button>
    {sublabel ? <p className="convert-sub font-label-sm">{sublabel}</p> : null}
  </div>
);
