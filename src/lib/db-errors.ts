/**
 * Turns a database error into something a person can read. Messages the database writes on purpose for
 * people (code P0001, e.g. "That time was just taken") are passed through; everything technical is hidden.
 */
export function friendlyDbError(error: { code?: string; message: string } | null | undefined): string | undefined {
  if (!error) return undefined;
  if (error.code === "23P01") return "That time overlaps another booking for this team member.";
  if (error.code === "23505") return "That already exists. Try a different name or link.";
  if (error.code === "42501") return "You don't have permission to do that.";
  if (error.code === "23503") return "That is still being used somewhere else, so it can't be changed or removed yet.";
  if (error.code === "23514" || error.code === "23502") return "One of the values isn't allowed. Please check what you entered and try again.";
  if (error.code === "22P02" || error.code === "22007" || error.code === "22008" || error.code === "22003") return "Please check the date, time or number you entered.";
  if (error.code === "P0001") return error.message;
  console.error("[db] unexpected error:", error.code, error.message);
  return "Something went wrong. Please try again, and let us know if it keeps happening.";
}
