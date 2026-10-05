export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  appUrl: (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, ""),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  platformFeePercent: Number(process.env.PLATFORM_FEE_PERCENT || 0),
  resendApiKey: process.env.RESEND_API_KEY,
  emailFrom: process.env.EMAIL_FROM || "Tempo <bookings@example.com>",
  twilioSid: process.env.TWILIO_ACCOUNT_SID,
  twilioToken: process.env.TWILIO_AUTH_TOKEN,
  twilioFrom: process.env.TWILIO_FROM_NUMBER,
  cronSecret: process.env.CRON_SECRET,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY,
};

export const features = {
  payments: Boolean(env.stripeSecretKey),
  email: Boolean(env.resendApiKey),
  sms: Boolean(env.twilioSid && env.twilioToken && env.twilioFrom),
  calendar: Boolean(env.googleClientId && env.googleClientSecret && env.tokenEncryptionKey),
};
