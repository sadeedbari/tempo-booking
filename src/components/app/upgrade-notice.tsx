"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { buttonClass } from "@/components/ui/button-class";
import { Notice } from "@/components/ui/misc";
import { money, type UpgradeOffer } from "@/lib/billing";
import { addOnForLimit } from "@/app/o/[org]/settings/billing/actions";

/**
 * Shown instead of a plain error when something would go beyond the plan. The owner can add what's needed in one
 * click (the change is prorated and charged by Stripe, and `onUpgraded` then retries what they were doing). Anyone
 * else is told to ask the owner. A business still on its trial goes to the Billing page to pick a plan.
 */
export function UpgradeNotice({ slug, message, offer, onUpgraded }: { slug: string; message: string; offer?: UpgradeOffer; onUpgraded: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!offer) return <Notice>{message}</Notice>;
  const billing = `/o/${slug}/settings/billing?locations=${offer.plan.extraLocations}&packs=${offer.plan.staffPacks}`;
  return (
    <div role="alert" className="space-y-3 rounded-[12px] bg-accent-soft px-3.5 py-3 text-[14px] font-medium text-accent">
      <p>{message}</p>
      {offer.canBuy && !offer.needsCheckout && (
        <Button
          type="button"
          size="sm"
          pill
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await addOnForLimit(slug, offer.kind);
              if (r.error) setError(r.error);
              else { setError(null); onUpgraded(); }
            })
          }
        >
          Add and continue (+{money(offer.addedCents)}/month)
        </Button>
      )}
      {offer.canBuy && offer.needsCheckout && <Link href={billing} className={buttonClass("filled", "sm", true)}>Choose a plan</Link>}
      {error && <p className="text-red">{error}</p>}
    </div>
  );
}
