#!/usr/bin/env bash
# Starts the stand-in services and a local Tempo wired to them (no real email, texts or charges).
# Every variable is exported so BOTH the build and the server get them (a prefix on one command would not).
cd "$(dirname "$0")/.."
export TEMPO_E2E=1
export RESEND_API_KEY=re_mock RESEND_BASE_URL=http://127.0.0.1:4010
export TWILIO_ACCOUNT_SID=ACmock TWILIO_AUTH_TOKEN=mock TWILIO_FROM_NUMBER=+15005550006 TWILIO_API_BASE=http://127.0.0.1:4010
export STRIPE_SECRET_KEY=sk_test_mock STRIPE_MOCK_URL=http://127.0.0.1:4010
export NEXT_PUBLIC_APP_URL=http://localhost:3000
node e2e/mock-services.mjs &
npm run build && npm run start
