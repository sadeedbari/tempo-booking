/**
 * Turns whatever a person typed into the international format SMS providers require
 * (E.164, e.g. "+14165551234"). `currency` hints at the business's country, so a
 * Canadian customer can type "416 555 1234" without the +1. Returns null if it can't
 * be read as a phone number.
 */

const DIAL_CODE_BY_CURRENCY: Record<string, string> = { CAD: "1", USD: "1", GBP: "44", AUD: "61", NZD: "64" };

export function normalizePhone(raw: string, currency?: string): string | null {
  let s = raw.trim();
  if (!s) return null;

  // Already international: "+44 20 7946 0958" or "0044 ..."
  const international = s.startsWith("+") || s.startsWith("00");
  if (s.startsWith("00")) s = s.slice(2);
  const digits = s.replace(/\D/g, "");
  if (international) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;

  const dial = DIAL_CODE_BY_CURRENCY[(currency ?? "").toUpperCase()];
  if (!dial) return null; // no country to assume: ask for the + form

  if (dial === "1") {
    // North America: 10 digits, optionally with a leading 1; area code can't start with 0 or 1.
    const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    return /^[2-9]\d{9}$/.test(national) ? `+1${national}` : null;
  }

  // Elsewhere: drop the national "0" prefix and add the country code.
  const national = digits.startsWith("0") ? digits.slice(1) : digits;
  const full = `${dial}${national}`;
  return full.length >= 8 && full.length <= 15 ? `+${full}` : null;
}
