// Creates Tempo's three subscription Products and monthly CAD Prices in YOUR Stripe account.
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/setup-stripe-billing.mjs          (test mode, the default)
//   STRIPE_SECRET_KEY=sk_live_... node scripts/setup-stripe-billing.mjs --live   (only when you mean it)
//
// The key is read from the environment and never written anywhere. Safe to run again: prices are found by their
// lookup key and reused. It prints the three price ids (not secrets) to put in your environment variables.
// Prices are $15.00 / $15.00 / $5.00 CAD per month, matching src/lib/billing.ts.
const key = process.env.STRIPE_SECRET_KEY;
if (!key) { console.error("Set STRIPE_SECRET_KEY in the environment first."); process.exit(2); }
const live = key.startsWith("sk_live_") || key.startsWith("rk_live_");
if (live && !process.argv.includes("--live")) { console.error("That is a LIVE key. Re-run with --live if you really want to create live products."); process.exit(2); }

const api = async (method, path, params) => {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(params ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: params ? new URLSearchParams(params) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${json.error?.message ?? res.status}`);
  return json;
};

const PLANS = [
  { env: "STRIPE_PRICE_BASE", lookup: "tempo_base_monthly", name: "Tempo base plan", description: "1 location and 5 staff", cents: 1500 },
  { env: "STRIPE_PRICE_EXTRA_LOCATION", lookup: "tempo_extra_location_monthly", name: "Tempo extra location", description: "Each extra location, includes 5 more staff", cents: 1500 },
  { env: "STRIPE_PRICE_STAFF_PACK", lookup: "tempo_staff_pack_monthly", name: "Tempo staff pack", description: "5 more staff, shared across the business", cents: 500 },
];

console.log(`Stripe ${live ? "LIVE" : "test"} mode`);
const out = [];
for (const p of PLANS) {
  const found = await api("GET", `/prices?lookup_keys[]=${p.lookup}&active=true&limit=1`);
  let price = found.data[0];
  if (price && (price.unit_amount !== p.cents || price.currency !== "cad")) throw new Error(`${p.lookup} exists with a different amount or currency; archive it in Stripe first.`);
  if (!price) {
    const product = await api("POST", "/products", { name: p.name, description: p.description });
    price = await api("POST", "/prices", {
      product: product.id, currency: "cad", unit_amount: String(p.cents), "recurring[interval]": "month", lookup_key: p.lookup,
    });
    console.log(`created ${p.name}`);
  } else console.log(`found   ${p.name}`);
  out.push(`${p.env}=${price.id}`);
}
console.log("\nPut these in your environment (Vercel project settings and .env.local):\n");
console.log(out.join("\n"));
console.log("\nNext: add a webhook endpoint <your app URL>/api/stripe/billing-webhook in Stripe and set STRIPE_BILLING_WEBHOOK_SECRET. See docs/billing-setup.md.");
