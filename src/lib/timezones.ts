export function allTimeZones(): string[] {
  try {
    const list: string[] = Intl.supportedValuesOf("timeZone");
    if (list?.length) return list;
  } catch {}
  return ["America/Toronto", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Vancouver", "Europe/London", "Europe/Paris", "Asia/Dubai", "Asia/Karachi", "Asia/Tokyo", "Australia/Sydney", "UTC"];
}

export const CURRENCIES = ["CAD", "USD", "EUR", "GBP", "AUD", "AED", "PKR", "INR"];
