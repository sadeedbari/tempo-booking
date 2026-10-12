import "server-only";
import Stripe from "stripe";
import { env } from "@/lib/env";

let client: Stripe | null = null;

export function getStripe() {
  if (!env.stripeSecretKey) return null;
  if (!client) {
    if (env.stripeMockUrl) {
      // Local testing only (never set in production): talk to a stand-in server instead of Stripe.
      const u = new URL(env.stripeMockUrl);
      client = new Stripe(env.stripeSecretKey, { host: u.hostname, port: u.port, protocol: u.protocol.replace(":", "") as "http" | "https" });
    } else {
      client = new Stripe(env.stripeSecretKey);
    }
  }
  return client;
}
