export type Country = {
  /** ISO 3166-1 alpha-2 */
  code: string;
  name: string;
  /** Dial code without + */
  dial: string;
  flag: string;
};

/** PNG flag (Windows cannot render emoji flags as images). */
export function countryFlagSrc(isoCode: string): string {
  return `https://flagcdn.com/w40/${isoCode.toLowerCase()}.png`;
}

/**
 * Common countries sorted by likely usage.
 * Flag emojis use regional indicator symbols (work on Android/iOS natively).
 */
export const COUNTRIES: Country[] = [
  { code: 'NG', name: 'Nigeria', dial: '234', flag: '🇳🇬' },
  { code: 'IN', name: 'India', dial: '91', flag: '🇮🇳' },
  { code: 'GB', name: 'United Kingdom', dial: '44', flag: '🇬🇧' },
  { code: 'US', name: 'United States', dial: '1', flag: '🇺🇸' },
  { code: 'GH', name: 'Ghana', dial: '233', flag: '🇬🇭' },
  { code: 'KE', name: 'Kenya', dial: '254', flag: '🇰🇪' },
  { code: 'ZA', name: 'South Africa', dial: '27', flag: '🇿🇦' },
  { code: 'CA', name: 'Canada', dial: '1', flag: '🇨🇦' },
  { code: 'AE', name: 'United Arab Emirates', dial: '971', flag: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia', dial: '966', flag: '🇸🇦' },
  { code: 'PK', name: 'Pakistan', dial: '92', flag: '🇵🇰' },
  { code: 'BD', name: 'Bangladesh', dial: '880', flag: '🇧🇩' },
  { code: 'EG', name: 'Egypt', dial: '20', flag: '🇪🇬' },
  { code: 'TZ', name: 'Tanzania', dial: '255', flag: '🇹🇿' },
  { code: 'UG', name: 'Uganda', dial: '256', flag: '🇺🇬' },
  { code: 'CM', name: 'Cameroon', dial: '237', flag: '🇨🇲' },
  { code: 'CI', name: "Côte d'Ivoire", dial: '225', flag: '🇨🇮' },
  { code: 'SN', name: 'Senegal', dial: '221', flag: '🇸🇳' },
  { code: 'ET', name: 'Ethiopia', dial: '251', flag: '🇪🇹' },
  { code: 'RW', name: 'Rwanda', dial: '250', flag: '🇷🇼' },
  { code: 'ZM', name: 'Zambia', dial: '260', flag: '🇿🇲' },
  { code: 'ZW', name: 'Zimbabwe', dial: '263', flag: '🇿🇼' },
  { code: 'MW', name: 'Malawi', dial: '265', flag: '🇲🇼' },
  { code: 'MZ', name: 'Mozambique', dial: '258', flag: '🇲🇿' },
  { code: 'BJ', name: 'Benin', dial: '229', flag: '🇧🇯' },
  { code: 'TG', name: 'Togo', dial: '228', flag: '🇹🇬' },
  { code: 'ML', name: 'Mali', dial: '223', flag: '🇲🇱' },
  { code: 'NE', name: 'Niger', dial: '227', flag: '🇳🇪' },
  { code: 'BF', name: 'Burkina Faso', dial: '226', flag: '🇧🇫' },
  { code: 'LR', name: 'Liberia', dial: '231', flag: '🇱🇷' },
  { code: 'SL', name: 'Sierra Leone', dial: '232', flag: '🇸🇱' },
  { code: 'GM', name: 'Gambia', dial: '220', flag: '🇬🇲' },
  { code: 'AU', name: 'Australia', dial: '61', flag: '🇦🇺' },
  { code: 'DE', name: 'Germany', dial: '49', flag: '🇩🇪' },
  { code: 'FR', name: 'France', dial: '33', flag: '🇫🇷' },
  { code: 'IT', name: 'Italy', dial: '39', flag: '🇮🇹' },
  { code: 'ES', name: 'Spain', dial: '34', flag: '🇪🇸' },
  { code: 'NL', name: 'Netherlands', dial: '31', flag: '🇳🇱' },
  { code: 'BE', name: 'Belgium', dial: '32', flag: '🇧🇪' },
  { code: 'PT', name: 'Portugal', dial: '351', flag: '🇵🇹' },
  { code: 'SE', name: 'Sweden', dial: '46', flag: '🇸🇪' },
  { code: 'NO', name: 'Norway', dial: '47', flag: '🇳🇴' },
  { code: 'DK', name: 'Denmark', dial: '45', flag: '🇩🇰' },
  { code: 'FI', name: 'Finland', dial: '358', flag: '🇫🇮' },
  { code: 'IE', name: 'Ireland', dial: '353', flag: '🇮🇪' },
  { code: 'AT', name: 'Austria', dial: '43', flag: '🇦🇹' },
  { code: 'CH', name: 'Switzerland', dial: '41', flag: '🇨🇭' },
  { code: 'PL', name: 'Poland', dial: '48', flag: '🇵🇱' },
  { code: 'BR', name: 'Brazil', dial: '55', flag: '🇧🇷' },
  { code: 'MX', name: 'Mexico', dial: '52', flag: '🇲🇽' },
  { code: 'CO', name: 'Colombia', dial: '57', flag: '🇨🇴' },
  { code: 'AR', name: 'Argentina', dial: '54', flag: '🇦🇷' },
  { code: 'CL', name: 'Chile', dial: '56', flag: '🇨🇱' },
  { code: 'JP', name: 'Japan', dial: '81', flag: '🇯🇵' },
  { code: 'KR', name: 'South Korea', dial: '82', flag: '🇰🇷' },
  { code: 'CN', name: 'China', dial: '86', flag: '🇨🇳' },
  { code: 'PH', name: 'Philippines', dial: '63', flag: '🇵🇭' },
  { code: 'MY', name: 'Malaysia', dial: '60', flag: '🇲🇾' },
  { code: 'ID', name: 'Indonesia', dial: '62', flag: '🇮🇩' },
  { code: 'TH', name: 'Thailand', dial: '66', flag: '🇹🇭' },
  { code: 'SG', name: 'Singapore', dial: '65', flag: '🇸🇬' },
  { code: 'NZ', name: 'New Zealand', dial: '64', flag: '🇳🇿' },
  { code: 'TR', name: 'Turkey', dial: '90', flag: '🇹🇷' },
  { code: 'RU', name: 'Russia', dial: '7', flag: '🇷🇺' },
  { code: 'UA', name: 'Ukraine', dial: '380', flag: '🇺🇦' },
  { code: 'IL', name: 'Israel', dial: '972', flag: '🇮🇱' },
  { code: 'QA', name: 'Qatar', dial: '974', flag: '🇶🇦' },
  { code: 'KW', name: 'Kuwait', dial: '965', flag: '🇰🇼' },
  { code: 'BH', name: 'Bahrain', dial: '973', flag: '🇧🇭' },
  { code: 'OM', name: 'Oman', dial: '968', flag: '🇴🇲' },
  { code: 'JM', name: 'Jamaica', dial: '1876', flag: '🇯🇲' },
  { code: 'TT', name: 'Trinidad and Tobago', dial: '1868', flag: '🇹🇹' },
  { code: 'LK', name: 'Sri Lanka', dial: '94', flag: '🇱🇰' },
  { code: 'NP', name: 'Nepal', dial: '977', flag: '🇳🇵' },
];

/** Find country by ISO code (default Nigeria). */
export function findCountryByCode(isoCode: string): Country {
  return COUNTRIES.find((c) => c.code === isoCode) ?? COUNTRIES[0];
}

/** Find country by dial code (first match). */
export function findCountryByDial(dial: string): Country | undefined {
  const d = dial.replace(/[^\d]/g, '');
  return COUNTRIES.find((c) => c.dial === d);
}
