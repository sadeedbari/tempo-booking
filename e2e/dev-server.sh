#!/usr/bin/env bash
# Starts the stand-in services and a local Tempo wired to them (no real email, texts or charges).
# Every variable is exported so BOTH the build and the server get them (a prefix on one command would not).
cd "$(dirname "$0")/.."
export TEMPO_E2E=1
export RESEND_API_KEY=re_mock RESEND_BASE_URL=http://127.0.0.1:4010
export TWILIO_ACCOUNT_SID=ACmock TWILIO_AUTH_TOKEN=mock TWILIO_FROM_NUMBER=+15005550006 TWILIO_API_BASE=http://127.0.0.1:4010
export STRIPE_SECRET_KEY=sk_test_mock STRIPE_MOCK_URL=http://127.0.0.1:4010
# Subscription billing (stand-in prices, and a signing secret the API tests also use).
export STRIPE_PRICE_BASE=price_mock_base STRIPE_PRICE_EXTRA_LOCATION=price_mock_location STRIPE_PRICE_STAFF_PACK=price_mock_pack
export STRIPE_BILLING_WEBHOOK_SECRET=whsec_e2e_billing_mock
# E2E_PORT lets the tests run beside a normal `npm run dev` on port 3000 (the specs read E2E_BASE_URL).
export E2E_PORT="${E2E_PORT:-3000}"
export NEXT_PUBLIC_APP_URL="http://localhost:$E2E_PORT"
node e2e/mock-services.mjs &
npm run build && npm run start -- -p "$E2E_PORT"
