import "server-only";
import Stripe from "stripe";
import { env } from "@/lib/env";

let client: Stripe | null = null;

export function getStripe() {
  if (!env.stripeSecretKey) return null;
  client ??= new Stripe(env.stripeSecretKey);
  return client;
}
