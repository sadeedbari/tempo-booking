/**
 * The text-message wording for booking confirmations and reminders.
 *
 * Kept to plain characters on purpose: a single em dash or curly quote pushes a message out of the
 * standard SMS alphabet, which shrinks a segment from 160 to 70 characters and multiplies the cost.
 * Every message ends with the opt-out line carriers and Twilio's verification expect.
 */
export const OPT_OUT = "Reply STOP to opt out.";

// Look-alike characters, written as numeric codes so this file stays plain ASCII.
const chars = (...codes: number[]) => new RegExp(`[${String.fromCharCode(...codes)}]`, "g");
const SPACES = chars(0x00a0, 0x2009, 0x202f); // no-break, thin and narrow no-break spaces
const DASHES = chars(0x2013, 0x2014); // en and em dashes
const SINGLE_QUOTES = chars(0x2018, 0x2019);
const DOUBLE_QUOTES = chars(0x201c, 0x201d);

/** Swaps look-alike characters for plain ones. */
function plain(s: string) {
  return s.replace(SPACES, " ").replace(DASHES, "-").replace(SINGLE_QUOTES, "'").replace(DOUBLE_QUOTES, '"');
}

export function buildSms(opts: {
  kind: "confirmation" | "reminder";
  orgName: string;
  serviceName: string;
  when: string;
  manageUrl: string;
}) {
  const lead = opts.kind === "reminder" ? "Reminder" : "Confirmed";
  return plain(`${opts.orgName}: ${lead} - ${opts.serviceName}, ${opts.when}. Manage: ${opts.manageUrl} ${OPT_OUT}`);
}
