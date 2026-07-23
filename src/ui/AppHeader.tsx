import './AppHeader.css';

type AppHeaderProps = {
  title?: string;
};

export const AppHeader: React.FC<AppHeaderProps> = ({ title = 'EmbraceHD' }) => (
  <header className="app-header">
    <div className="app-header-brand">
      <span className="material-symbols-outlined app-header-hd" aria-hidden>
        hd
      </span>
      <h1 className="app-header-title glow-text">{title}</h1>
    </div>
  </header>
);
