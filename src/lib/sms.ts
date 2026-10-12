/**
 * The text-message wording for booking confirmations and reminders.
 *
 * Kept to plain characters on purpose: a single "—" or curly quote pushes a message out of the
 * standard SMS alphabet, which shrinks a segment from 160 to 70 characters and multiplies the cost.
 * Every message ends with the opt-out line carriers and Twilio's verification expect.
 */
export const OPT_OUT = "Reply STOP to opt out.";

/** Swaps look-alike characters (non-breaking spaces, en/em dashes, curly quotes) for plain ones. */
function plain(s: string) {
  return s
    .replace(/[   ]/g, " ") // no-break, thin and narrow no-break spaces
    .replace(/[–—]/g, "-") // en and em dashes
    .replace(/[‘’]/g, "'") // curly single quotes
    .replace(/[“”]/g, '"'); // curly double quotes
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
