"use client";
import { useEffect, useId, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// A browser key, restricted to this site's address and to the Places API in Google Cloud.
const KEY = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
const REGION_BY_CURRENCY: Record<string, string> = { CAD: "ca", USD: "us", GBP: "gb", AUD: "au", NZD: "nz" };

type Suggestion = { placeId: string; main: string; secondary: string; full: string };
type Picked = { placeId: string; lat: number | null; lng: number | null };

/**
 * Street-address field with Google Places suggestions as you type. Picking a suggestion
 * fills in the full address and remembers the exact place (id + coordinates).
 *  - `strict`: the form can't be submitted until a suggestion is chosen.
 *  - If no key is configured or the lookup fails, it quietly becomes a plain text box so
 *    bookings are never blocked. The same goes when Google has no match for what was typed
 *    (new builds, rural addresses): the address is accepted as typed.
 * Submits `{name}`, `{name}_place_id`, `{name}_lat`, `{name}_lng` with the form.
 */
export function AddressInput({
  name = "address", currency, required, strict, placeholder, defaultValue,
}: {
  name?: string; currency?: string; required?: boolean; strict?: boolean; placeholder?: string; defaultValue?: string;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const token = useRef<string | null>(null);
  const [value, setValue] = useState(defaultValue ?? "");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [failed, setFailed] = useState(false);
  // The text we last asked Google about, so we know when "no suggestions" is a real answer.
  const [lookedUp, setLookedUp] = useState<string | null>(null);
  const enabled = Boolean(KEY) && !failed;
  // Only show suggestions while the person is still typing an unconfirmed address.
  const shown = enabled && !picked && value.trim().length >= 3 ? items : [];
  const region = REGION_BY_CURRENCY[(currency ?? "").toUpperCase()];

  // One session token per typing session keeps Google's billing to a single lookup.
  const sessionToken = () => (token.current ??= crypto.randomUUID());

  useEffect(() => {
    if (!enabled || picked || value.trim().length < 3) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
          method: "POST",
          signal: ctrl.signal,
          headers: { "Content-Type": "application/json", "X-Goog-Api-Key": KEY! },
          body: JSON.stringify({
            input: value,
            sessionToken: sessionToken(),
            includedPrimaryTypes: ["street_address", "subpremise", "premise"],
            ...(region ? { includedRegionCodes: [region] } : {}),
          }),
        });
        if (!res.ok) throw new Error(`places ${res.status}`);
        const data = (await res.json()) as { suggestions?: { placePrediction?: { placeId: string; text?: { text: string }; structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } } } }[] };
        const next = (data.suggestions ?? []).flatMap((s) => {
          const p = s.placePrediction;
          return p ? [{ placeId: p.placeId, main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "", secondary: p.structuredFormat?.secondaryText?.text ?? "", full: p.text?.text ?? "" }] : [];
        });
        setItems(next);
        setLookedUp(value);
        setActive(-1);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setFailed(true); // fall back to a plain text box
      }
    }, 220);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [value, enabled, picked, region]);

  // In strict mode, block submitting until a suggestion has been picked, unless Google found nothing to pick.
  const noMatches = lookedUp === value && items.length === 0;
  useEffect(() => {
    inputRef.current?.setCustomValidity(strict && enabled && !picked && !noMatches ? "Choose your address from the list of suggestions." : "");
  }, [strict, enabled, picked, noMatches]);

  async function choose(s: Suggestion) {
    setValue(s.full);
    setPicked({ placeId: s.placeId, lat: null, lng: null });
    setOpen(false);
    const session = sessionToken();
    token.current = null; // the lookup session ends with this selection
    try {
      const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(s.placeId)}?sessionToken=${encodeURIComponent(session)}`, {
        headers: { "X-Goog-Api-Key": KEY!, "X-Goog-FieldMask": "formattedAddress,location" },
      });
      if (!res.ok) return;
      const d = (await res.json()) as { formattedAddress?: string; location?: { latitude: number; longitude: number } };
      if (d.formattedAddress) setValue(d.formattedAddress);
      setPicked({ placeId: s.placeId, lat: d.location?.latitude ?? null, lng: d.location?.longitude ?? null });
    } catch {
      /* the address text is already filled in; coordinates are a bonus */
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || shown.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % shown.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i <= 0 ? shown.length - 1 : i - 1)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); void choose(shown[active]); }
    else if (e.key === "Escape") setOpen(false);
  }

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        name={name}
        value={value}
        required={required}
        autoComplete="off"
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open && shown.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => {
          setValue(e.target.value);
          setPicked(null); // editing the text means the earlier pick no longer applies
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      <input type="hidden" name={`${name}_place_id`} value={picked?.placeId ?? ""} />
      <input type="hidden" name={`${name}_lat`} value={picked?.lat ?? ""} />
      <input type="hidden" name={`${name}_lng`} value={picked?.lng ?? ""} />

      {open && shown.length > 0 && (
        <div className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-[14px] bg-surface shadow-lg hairline animate-pop">
          <ul id={listId} role="listbox">
            {shown.map((s, i) => (
              <li key={s.placeId} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  // mousedown (not click) so the input's blur doesn't close the list first
                  onMouseDown={(e) => { e.preventDefault(); void choose(s); }}
                  onMouseEnter={() => setActive(i)}
                  className={cn("flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition", i === active ? "bg-accent-soft" : "hover:bg-surface-2")}
                >
                  <MapPin className="size-4 shrink-0 text-label-3" />
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-medium">{s.main}</span>
                    {s.secondary && <span className="block truncate text-[12px] text-label-2">{s.secondary}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-separator px-3.5 py-1.5 text-right text-[11px] text-label-3">Powered by Google</div>
        </div>
      )}
      {enabled && picked && (
        <p className="mt-1.5 px-1 text-[12px] text-green">Address confirmed.</p>
      )}
      {enabled && !picked && noMatches && value.trim().length >= 3 && (
        <p className="mt-1.5 px-1 text-[12px] text-label-3">We couldn&apos;t match that address, so we&apos;ll use it exactly as typed.</p>
      )}
    </div>
  );
}
