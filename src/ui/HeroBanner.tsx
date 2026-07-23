import { APP } from '../core';
import './HeroBanner.css';

type HeroBannerProps = {
  subtitle?: string;
};

export const HeroBanner: React.FC<HeroBannerProps> = ({
  subtitle = APP.tagline,
}) => (
  <section className="hero-banner" aria-label={APP.name}>
    <p className="hero-eyebrow">WhatsApp Ready</p>
    <h1 className="hero-title">{APP.name}</h1>
    <p className="hero-subtitle">{subtitle}</p>
  </section>
);
