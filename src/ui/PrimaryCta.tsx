import type { ReactNode } from 'react';
import { IonButton, IonText } from '@ionic/react';
import './PrimaryCta.css';

type PrimaryCtaProps = {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  expand?: 'block' | 'full';
  children?: ReactNode;
};

export const PrimaryCta: React.FC<PrimaryCtaProps> = ({
  label,
  onClick,
  disabled,
  expand = 'block',
}) => (
  <IonButton className="primary-cta" expand={expand} onClick={onClick} disabled={disabled}>
    {label}
  </IonButton>
);

type HintListProps = {
  items: string[];
};

export const HintList: React.FC<HintListProps> = ({ items }) => (
  <ul className="hint-list">
    {items.map((item) => (
      <li key={item}>
        <IonText color="medium">{item}</IonText>
      </li>
    ))}
  </ul>
);
