/**
 * Phone-first sign-in for PLCC (Phase 4 — Nov 2026, #4 and #15).
 * Uganda is the default; members abroad pick their country.
 */

export type PhoneCountry = { code: string; name: string; dial: string; flag: string; example: string };

export const PHONE_COUNTRIES: PhoneCountry[] = [
  { code: 'UG', name: 'Uganda', dial: '256', flag: '🇺🇬', example: '0772 123456' },
  { code: 'KE', name: 'Kenya', dial: '254', flag: '🇰🇪', example: '0712 345678' },
  { code: 'TZ', name: 'Tanzania', dial: '255', flag: '🇹🇿', example: '0712 345678' },
  { code: 'RW', name: 'Rwanda', dial: '250', flag: '🇷🇼', example: '0781 234567' },
  { code: 'SS', name: 'South Sudan', dial: '211', flag: '🇸🇸', example: '0912 345678' },
  { code: 'CD', name: 'DR Congo', dial: '243', flag: '🇨🇩', example: '0812 345678' },
  { code: 'BI', name: 'Burundi', dial: '257', flag: '🇧🇮', example: '79 123456' },
  { code: 'ZA', name: 'South Africa', dial: '27', flag: '🇿🇦', example: '071 234 5678' },
  { code: 'GB', name: 'United Kingdom', dial: '44', flag: '🇬🇧', example: '07700 900123' },
  { code: 'US', name: 'United States / Canada', dial: '1', flag: '🇺🇸', example: '(555) 123-4567' },
  { code: 'AE', name: 'United Arab Emirates', dial: '971', flag: '🇦🇪', example: '050 123 4567' },
  { code: 'SA', name: 'Saudi Arabia', dial: '966', flag: '🇸🇦', example: '050 123 4567' },
  { code: 'QA', name: 'Qatar', dial: '974', flag: '🇶🇦', example: '3312 3456' },
  { code: 'DE', name: 'Germany', dial: '49', flag: '🇩🇪', example: '0151 23456789' },
  { code: 'SE', name: 'Sweden', dial: '46', flag: '🇸🇪', example: '070 123 45 67' },
  { code: 'AU', name: 'Australia', dial: '61', flag: '🇦🇺', example: '0412 345 678' },
];

export const DEFAULT_PHONE_COUNTRY = PHONE_COUNTRIES[0];

export function findPhoneCountry(code: string | null | undefined): PhoneCountry {
  return PHONE_COUNTRIES.find((c) => c.code === code) || DEFAULT_PHONE_COUNTRY;
}

/**
 * The number as typed + the chosen country → +E.164.
 *   "0772 123456" + Uganda → +256772123456
 *   "772123456"   + Uganda → +256772123456
 *   "+44 7700 900123" (any country) → +447700900123
 * Returns null when it can't be a mobile number.
 */
export function toE164WithCountry(raw: string, country: PhoneCountry): string | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  let digits = text.replace(/\D/g, '');
  if (text.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  // Already includes the country code (e.g. 256772123456).
  if (digits.startsWith(country.dial) && digits.length >= country.dial.length + 8) {
    return digits.length <= 15 ? `+${digits}` : null;
  }
  // A Ugandan number typed with "United States / Canada" picked (0772 557842 or
  // 772 557842): US/Canada numbers never start with 0 and have 10 digits, so it
  // can only be Ugandan. Canaan corrects this too (ugandaFromUsMisdial).
  if (country.dial === '1') {
    const ug = (digits.length === 10 && digits.startsWith('0') ? digits.slice(1) : digits.length === 9 ? digits : '');
    if (/^[237]\d{8}$/.test(ug)) return `+256${ug}`;
  }
  // Drop the local trunk 0 (Uganda, Kenya, UK, …). The US has none.
  if (country.dial !== '1') digits = digits.replace(/^0+/, '');
  const full = `${country.dial}${digits}`;
  if (digits.length < 6 || full.length > 15) return null;
  return `+${full}`;
}

const PREF_KEY = 'plcc_signin_phone_v1';

export function readRememberedPhone(): { country: string; phone: string } | null {
  try {
    const raw = window.localStorage.getItem(PREF_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v?.country !== 'string' || typeof v?.phone !== 'string') return null;
    return { country: v.country.slice(0, 4), phone: v.phone.slice(0, 24) };
  } catch {
    return null;
  }
}

export function rememberPhone(country: string, phone: string) {
  try {
    window.localStorage.setItem(PREF_KEY, JSON.stringify({ country, phone }));
  } catch {
    /* private mode */
  }
}

/**
 * Normalise phone to E.164. PLCC is in Uganda, so local numbers default to +256:
 *   0772 123456 → +256772123456,  772123456 → +256772123456.
 * Numbers with + or 00 keep their country. A 10-digit number without a leading 0
 * is treated as US/Canada (+1).
 * (Before Nov 2026 every 10-digit number became +1…, so Ugandan "07…" numbers failed.)
 */
export function normalisePhone(value: string): string {
  const trimmed = String(value || '').trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith('0')) return `+256${digits.slice(1)}`;
  if (digits.length === 9 && /^[37]/.test(digits)) return `+256${digits}`;
  if (digits.length === 12 && digits.startsWith('256')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

