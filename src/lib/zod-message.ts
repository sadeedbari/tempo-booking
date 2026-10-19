import type { ZodError } from "zod";

/**
 * Turns the first problem of a failed zod parse into a plain sentence for the person using the form. Messages written on
 * purpose in a schema (e.g. "Give the service a name") are kept; the library's default wording ("Too big: expected string
 * to have <=80 characters") is replaced using the field name, so no form has to map errors itself.
 */
const DEFAULT_WORDING = /^(Too big|Too small|Invalid|Required|Expected)/i;

/** "duration_minutes" -> "Duration minutes"; unknown path -> "This field". */
function fieldLabel(path: ReadonlyArray<PropertyKey>): string {
  const key = path.length ? String(path[path.length - 1]) : "";
  if (!key || /^\d+$/.test(key)) return "This field";
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function friendlyZodMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Please check what you entered and try again.";
  if (issue.message && !DEFAULT_WORDING.test(issue.message)) return issue.message;
  const label = fieldLabel(issue.path);
  // Zod 4 puts the limit and the kind of value on the issue; read them loosely so a library change cannot throw here.
  const i = issue as unknown as { code: string; origin?: string; maximum?: number | bigint; minimum?: number | bigint; input?: unknown };
  const isText = i.origin === "string" || i.origin === "array" || i.origin === undefined;
  if (i.code === "too_big" && i.maximum !== undefined) {
    return i.origin === "string" ? `${label} must be ${i.maximum} characters or fewer.` : `${label} must be ${i.maximum} or less.`;
  }
  if (i.code === "too_small" && i.minimum !== undefined) {
    if (i.origin === "string") return Number(i.minimum) <= 1 ? `${label} can't be empty.` : `${label} must be at least ${i.minimum} characters.`;
    return isText ? `${label} needs at least ${i.minimum}.` : `${label} must be ${i.minimum} or more.`;
  }
  if (i.code === "invalid_type" && (i.input === undefined || i.input === null || i.input === "")) return `Please fill in ${label.toLowerCase()}.`;
  return `${label} isn't valid. Please check it and try again.`;
}
