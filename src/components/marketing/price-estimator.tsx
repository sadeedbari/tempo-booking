"use client";
import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { MAX_EXTRA_LOCATIONS, MAX_STAFF_PACKS, LOCATION_CENTS, PACK_CENTS, STAFF_PER_LOCATION, STAFF_PER_PACK, money, monthlyCents, planLimits } from "@/lib/billing";

// The estimator uses the same price constants and helper functions as billing (nothing is copied), so it cannot drift.
const MAX_LOCATIONS = 1 + MAX_EXTRA_LOCATIONS;

const PRESETS = [
  { label: "2 locations, 10 staff", locations: 2, packs: 0 },
  { label: "2 locations, 15 staff", locations: 2, packs: 1 },
  { label: "3 locations, 25 staff", locations: 3, packs: 2 },
] as const;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A labelled - / number / + control. Big 48px buttons for thumbs; aria-disabled (not disabled) at the ends so keyboard focus is not lost. */
function Stepper({ id, label, hint, value, min, max, onChange, unit }: {
  id: string; label: string; hint: string; value: number; min: number; max: number; onChange: (n: number) => void; unit: string;
}) {
  const btn = "grid size-[44px] shrink-0 place-items-center rounded-full bg-surface-2 text-label hover:bg-surface-3 aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-surface-2";
  return (
    <div role="group" aria-labelledby={`${id}-label`} className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1 basis-[10rem] [overflow-wrap:anywhere]">
        <div id={`${id}-label`} className="text-base font-semibold">{label}</div>
        <div className="text-base text-label-2">{hint}</div>
      </div>
      <div className="flex max-w-full items-center gap-1">
        <button type="button" className={btn} aria-label={`Remove one ${unit}`} aria-disabled={value <= min} onClick={() => value > min && onChange(value - 1)}>
          <Minus className="size-[20px]" aria-hidden />
        </button>
        <span data-testid={`${id}-value`} className="min-w-[2ch] px-1 text-center text-2xl font-bold tabular-nums">{value}</span>
        <button type="button" className={btn} aria-label={`Add one ${unit}`} aria-disabled={value >= max} onClick={() => value < max && onChange(value + 1)}>
          <Plus className="size-[20px]" aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function PriceEstimator() {
  const [locations, setLocations] = useState(1);
  const [packs, setPacks] = useState(0);
  const plan = { extraLocations: locations - 1, staffPacks: packs };
  const staff = planLimits(plan).staff;
  const total = money(monthlyCents(plan));

  return (
    <div className="min-w-0 rounded-[22px] bg-surface p-4 shadow-sm hairline sm:p-6">
      <h3 className="text-xl font-bold tracking-tight">Work out your price</h3>
      <div className="mt-5 space-y-5">
        <Stepper id="locations" label="Locations" hint={`Each includes ${STAFF_PER_LOCATION} staff. Extra ones are +${money(LOCATION_CENTS)}/month.`} value={locations} min={1} max={MAX_LOCATIONS} onChange={setLocations} unit="location" />
        <Stepper id="packs" label="Extra staff packs" hint={`${STAFF_PER_PACK} staff each, +${money(PACK_CENTS)}/month.`} value={packs} min={0} max={MAX_STAFF_PACKS} onChange={setPacks} unit="extra staff pack" />
      </div>

      {/* Announced politely whenever the total changes. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="mt-6 rounded-[16px] bg-accent-soft p-4">
        <p className="text-base text-label-2">Your plan: <span data-testid="estimator-summary" className="font-semibold text-label">{plural(locations, "location")}, {staff} staff included</span></p>
        <p className="mt-1 text-label"><span data-testid="estimator-total" className="text-4xl font-bold tracking-tight tabular-nums">{total}</span> <span className="text-base font-semibold">CAD per month</span></p>
      </div>

      <p className="mt-5 text-base font-medium">Quick examples</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => { setLocations(p.locations); setPacks(p.packs); }}
            className="inline-flex min-h-11 items-center rounded-full bg-surface-2 px-4 text-base font-medium hover:bg-surface-3"
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="mt-5 text-base text-label-2">Everyone on your team counts as staff, with or without a login. A location that is switched off does not count.</p>
    </div>
  );
}
