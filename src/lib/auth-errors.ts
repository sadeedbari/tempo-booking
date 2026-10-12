/** Plain-language messages for the errors Supabase Auth can return, instead of its technical text. */
export function friendlyAuthError(error: { code?: string; message: string; status?: number }): string {
  switch (error.code) {
    case "invalid_credentials": return "That email and password don't match.";
    case "email_not_confirmed": return "Please confirm your email first. Check your inbox for the link we sent.";
    case "user_already_exists":
    case "email_exists": return "An account with that email already exists. Try signing in instead.";
    case "weak_password": return "That password is too easy to guess. Use at least 8 characters, with a mix of letters and numbers.";
    case "over_email_send_rate_limit": return "We've sent several emails to that address recently. Please wait a few minutes and try again.";
    case "over_request_rate_limit":
    case "over_sms_send_rate_limit": return "Too many attempts. Please wait a few minutes and try again.";
    case "signup_disabled": return "New sign-ups are turned off right now.";
    case "validation_failed":
    case "email_address_invalid": return "Please check the email address and try again.";
    default:
      if (/rate limit/i.test(error.message)) return "Too many attempts. Please wait a few minutes and try again.";
      if (error.status && error.status >= 500) return "We couldn't reach the sign-in service. Please try again in a moment.";
      return error.message || "Something went wrong. Please try again.";
  }
}
