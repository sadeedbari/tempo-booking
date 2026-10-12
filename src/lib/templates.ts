/**
 * Message templates for workflows. Pure (no I/O) so the editor preview, the test email and the real
 * sends all render exactly the same way, and so it can be tested.
 *
 * A template is plain text with {{variables}}. There is no logic and nothing is executed: a variable is
 * swapped for its value, and a line whose variables are all empty (for example "Where: {{location}}"
 * for a phone call) is dropped, so messages never show blank labels.
 */

export type Vars = Record<string, string>;

export const VARIABLES = [
  { key: "customer_first_name", label: "Customer first name", sample: "Ada" },
  { key: "customer_name", label: "Customer full name", sample: "Ada Lovelace" },
  { key: "business_name", label: "Business name", sample: "Lumen Studio" },
  { key: "business_phone", label: "Business phone", sample: "416-555-0199" },
  { key: "service_name", label: "Service", sample: "Haircut & style" },
  { key: "duration", label: "Duration", sample: "1 hr" },
  { key: "date", label: "Date", sample: "Monday, October 12" },
  { key: "time", label: "Time", sample: "9:00 AM" },
  { key: "date_time", label: "Date and time", sample: "Monday, October 12 at 9:00 AM" },
  { key: "staff_name", label: "Team member", sample: "Maya Chen" },
  { key: "location", label: "Where", sample: "214 Queen St W, Toronto" },
  { key: "price", label: "Price", sample: "$85" },
  { key: "deposit", label: "Deposit paid", sample: "$50 paid" },
  { key: "manage_link", label: "Manage link", sample: "https://tempo.sulosystems.com/booking/example" },
  { key: "booking_link", label: "Book again link", sample: "https://tempo.sulosystems.com/lumen" },
  { key: "manage_button", label: "Manage button (email)", sample: "https://tempo.sulosystems.com/booking/example", emailOnly: true },
  { key: "booking_button", label: "Book again button (email)", sample: "https://tempo.sulosystems.com/lumen", emailOnly: true },
] as const;

export const VARIABLE_KEYS = new Set<string>(VARIABLES.map((v) => v.key));
const EMAIL_ONLY = new Set<string>(VARIABLES.filter((v) => "emailOnly" in v).map((v) => v.key));

export const sampleVars = (): Vars => Object.fromEntries(VARIABLES.map((v) => [v.key, v.sample]));

const VAR_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Names used in a template that aren't real variables (typos), so we can reject them when saving. */
export function unknownVariables(text: string): string[] {
  const bad = new Set<string>();
  for (const m of text.matchAll(VAR_RE)) if (!VARIABLE_KEYS.has(m[1])) bad.add(m[1]);
  return [...bad];
}

/** Variables that only make sense in email (buttons), used in a text message. */
export function emailOnlyVariables(text: string): string[] {
  const bad = new Set<string>();
  for (const m of text.matchAll(VAR_RE)) if (EMAIL_ONLY.has(m[1])) bad.add(m[1]);
  return [...bad];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const linkify = (escaped: string) =>
  escaped.replace(/https?:\/\/[^\s<]+/g, (u) => {
    // Keep trailing punctuation out of the link.
    const m = u.match(/^(.*?)([.,;:!?)]*)$/)!;
    return `<a href="${m[1]}" style="color:inherit">${m[1]}</a>${m[2]}`;
  });

type Piece = { kind: "text"; value: string } | { kind: "var"; key: string; value: string };

/** Swaps variables into one line, or returns null when the line should be dropped. */
function pieces(line: string, vars: Vars): Piece[] | null {
  const out: Piece[] = [];
  let last = 0;
  let any = false;
  let allEmpty = true;
  for (const m of line.matchAll(VAR_RE)) {
    out.push({ kind: "text", value: line.slice(last, m.index) });
    const value = (vars[m[1]] ?? "").trim();
    out.push({ kind: "var", key: m[1], value });
    any = true;
    if (value) allEmpty = false;
    last = m.index! + m[0].length;
  }
  out.push({ kind: "text", value: line.slice(last) });
  return any && allEmpty ? null : out;
}

function lines(template: string, vars: Vars): Piece[][] {
  const result: Piece[][] = [];
  for (const raw of template.replace(/\r\n?/g, "\n").split("\n")) {
    if (!raw.trim()) { result.push([]); continue; }
    const p = pieces(raw, vars);
    if (p) result.push(p);
  }
  // Collapse runs of blank lines and trim blank lines at both ends.
  const cleaned: Piece[][] = [];
  for (const l of result) {
    if (l.length === 0 && (cleaned.length === 0 || cleaned[cleaned.length - 1].length === 0)) continue;
    cleaned.push(l);
  }
  while (cleaned.length && cleaned[cleaned.length - 1].length === 0) cleaned.pop();
  return cleaned;
}

/** Plain-text version (subject lines, text messages, and the text part of an email). */
export function renderText(template: string, vars: Vars): string {
  return lines(template, vars)
    .map((l) => l.map((p) => p.value).join("").trimEnd())
    .join("\n");
}

/** A subject line must be a single line. */
export const renderSubject = (template: string, vars: Vars) => renderText(template, vars).replace(/\s*\n+\s*/g, " ").trim();

/** HTML for the body of an email: escaped text, paragraphs, links, and the two button variables. */
export function renderEmailBody(template: string, vars: Vars, accent = "#007AFF"): string {
  const button = (url: string, label: string) =>
    `<a href="${esc(url)}" style="display:inline-block;margin-top:8px;background:${esc(accent)};color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:999px">${esc(label)}</a>`;
  const paragraphs: string[][] = [[]];
  for (const l of lines(template, vars)) {
    if (l.length === 0) { paragraphs.push([]); continue; }
    const html = l
      .map((p) => {
        if (p.kind === "text") return linkify(esc(p.value));
        if (p.key === "manage_button") return button(p.value, "Manage booking");
        if (p.key === "booking_button") return button(p.value, "Book again");
        return linkify(esc(p.value));
      })
      .join("");
    paragraphs[paragraphs.length - 1].push(html);
  }
  return paragraphs
    .filter((p) => p.length)
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.55">${p.join("<br>")}</p>`)
    .join("");
}

/** The branded email around the body. */
export function emailShell(o: { businessName: string; accent: string; phone?: string | null; bodyHtml: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif;color:#1d1d1f">
  <div style="max-width:520px;margin:0 auto;padding:40px 20px">
    <div style="font-size:15px;font-weight:600;color:#6e6e73;margin-bottom:12px">${esc(o.businessName)}</div>
    <div style="background:#fff;border-radius:20px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.06)">${o.bodyHtml}</div>
    <p style="text-align:center;color:#86868b;font-size:12px;margin-top:20px">${o.phone ? `Questions? Call ${esc(o.phone)}. ` : ""}Sent by Tempo.</p>
  </div></body></html>`;
}

/** Everything needed to send (or preview) one email. */
export function renderEmail(o: { subject: string; body: string; vars: Vars; accent: string; phone?: string | null }) {
  const bodyHtml = renderEmailBody(o.body, o.vars, o.accent);
  return {
    subject: renderSubject(o.subject, o.vars),
    html: emailShell({ businessName: o.vars.business_name ?? "", accent: o.accent, phone: o.phone, bodyHtml }),
    text: renderText(o.body, o.vars),
  };
}
