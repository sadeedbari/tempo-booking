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
  microsoftClientId: process.env.MICROSOFT_CLIENT_ID,
  microsoftClientSecret: process.env.MICROSOFT_CLIENT_SECRET,
  // "common" accepts both work/school and personal Microsoft accounts.
  microsoftTenant: process.env.MICROSOFT_TENANT || "common",
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY,
  // Test hooks: point texts / Stripe at local stand-ins. Only honoured when TEMPO_E2E=1, which only e2e/dev-server.sh sets.
  twilioApiBase: process.env.TEMPO_E2E === "1" ? process.env.TWILIO_API_BASE : undefined,
  stripeMockUrl: process.env.TEMPO_E2E === "1" ? process.env.STRIPE_MOCK_URL : undefined,
  vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
  vapidSubject: process.env.VAPID_SUBJECT || "mailto:info@sulosystems.com",
};

export const features = {
  payments: Boolean(env.stripeSecretKey),
  email: Boolean(env.resendApiKey),
  sms: Boolean(env.twilioSid && env.twilioToken && env.twilioFrom),
  // Push needs a VAPID key pair and the service-role client (to read everyone's devices).
  push: Boolean(env.vapidPublicKey && env.vapidPrivateKey && env.supabaseServiceKey),
  // Calendar sync stores tokens through the service-role client, so it needs that key too.
  calendar: Boolean(env.supabaseServiceKey && env.tokenEncryptionKey && ((env.googleClientId && env.googleClientSecret) || (env.microsoftClientId && env.microsoftClientSecret))),
};
