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
export function plain(s: string) {
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

/** Final text for a custom SMS template: plain characters, and always ends with the opt-out line. */
export function finalizeSms(body: string) {
  const t = plain(body).trim().replace(/\n{3,}/g, "\n\n");
  return t.includes(OPT_OUT) ? t : `${t} ${OPT_OUT}`;
}

/**
 * How many text-message segments a message will use. Plain ASCII uses the cheap alphabet (160 characters,
 * or 153 per part when it needs several); anything else switches to the 70-character alphabet. Characters
 * like { } [ ] ~ ^ | count twice. This is an estimate to warn people, not a billing guarantee.
 */
export function smsInfo(text: string) {
  const unicode = /[^\x20-\x7e\n]/.test(text) || text.includes("`");
  const length = unicode ? text.length : [...text].reduce((n, c) => n + ("^{}\[]~|".includes(c) ? 2 : 1), 0);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const segments = length === 0 ? 0 : length <= single ? 1 : Math.ceil(length / multi);
  return { length, segments, unicode };
}
