import { useCallback, useMemo, useRef, useState } from 'react';
import { IonModal, IonSearchbar, IonContent } from '@ionic/react';
import { COUNTRIES, countryFlagSrc, type Country } from '../core/countryCodes';
import './CountryCodePicker.css';

type CountryCodePickerProps = {
  value: Country;
  onChange: (country: Country) => void;
  disabled?: boolean;
  label?: string;
};

function FlagImg({
  code,
  name,
  className,
}: {
  code: string;
  name: string;
  className?: string;
}) {
  return (
    <img
      className={className}
      src={countryFlagSrc(code)}
      alt=""
      width={22}
      height={16}
      loading="lazy"
      decoding="async"
      title={name}
    />
  );
}

export const CountryCodePicker: React.FC<CountryCodePickerProps> = ({
  value,
  onChange,
  disabled,
  label = 'Country code',
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLIonSearchbarElement>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return COUNTRIES;
    const q = search.trim().toLowerCase();
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dial.includes(q) ||
        c.code.toLowerCase().includes(q)
    );
  }, [search]);

  const onSelect = useCallback(
    (country: Country) => {
      onChange(country);
      setOpen(false);
      setSearch('');
    },
    [onChange]
  );

  return (
    <>
      <div className="cc-picker">
        <span className="cc-picker-label">{label}</span>
        <button
          type="button"
          className="cc-picker-trigger"
          disabled={disabled}
          onClick={() => setOpen(true)}
          aria-label={`${label}: ${value.name} +${value.dial}`}
        >
          <FlagImg code={value.code} name={value.name} className="cc-picker-flag-img" />
          <span className="cc-picker-dial">+{value.dial}</span>
          <span className="cc-picker-caret material-symbols-outlined" aria-hidden>
            expand_more
          </span>
        </button>
      </div>

      <IonModal
        isOpen={open}
        onDidDismiss={() => {
          setOpen(false);
          setSearch('');
        }}
        className="cc-picker-modal"
        onDidPresent={() => {
          void searchRef.current?.setFocus();
        }}
      >
        <div className="cc-picker-sheet">
          <div className="cc-picker-header">
            <p className="cc-picker-title">Select country</p>
            <button
              type="button"
              className="cc-picker-close"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          <IonSearchbar
            ref={searchRef}
            className="cc-picker-search"
            placeholder="Search country or code"
            value={search}
            onIonInput={(e) => setSearch(e.detail.value ?? '')}
            debounce={100}
          />

          <IonContent className="cc-picker-list-content">
            <div className="cc-picker-list" role="listbox">
              {filtered.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  role="option"
                  aria-selected={c.code === value.code}
                  className={`cc-picker-item${c.code === value.code ? ' cc-picker-item--selected' : ''}`}
                  onClick={() => onSelect(c)}
                >
                  <FlagImg code={c.code} name={c.name} className="cc-picker-item-flag-img" />
                  <span className="cc-picker-item-name">{c.name}</span>
                  <span className="cc-picker-item-dial">+{c.dial}</span>
                </button>
              ))}
              {filtered.length === 0 ? (
                <p className="cc-picker-empty">No countries found</p>
              ) : null}
            </div>
          </IonContent>
        </div>
      </IonModal>
    </>
  );
};
