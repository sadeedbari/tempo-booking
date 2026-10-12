"use client";
import { useState, useTransition } from "react";
import { MapPin, Phone, Plus } from "lucide-react";
import { Avatar, Badge, Notice } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { Location, Membership } from "@/lib/types";
import { deleteLocation, saveLocation } from "../actions";

export function LocationsSection({
  slug, locations, staffMap, members,
}: {
  slug: string; locations: Location[]; staffMap: Record<string, string[]>; members: Membership[];
}) {
  const [editing, setEditing] = useState<Partial<Location> | null>(null);

  return (
    <section>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold">Locations</h2>
          <p className="mt-0.5 mb-4 text-[14px] text-label-2">
            Add each place you see customers. With two or more, customers choose a location when booking. All locations use your business time zone.
          </p>
        </div>
        <Button pill size="sm" className="mb-4 shrink-0" onClick={() => setEditing({})}><Plus className="size-4" strokeWidth={2.5} /> Add</Button>
      </div>

      {locations.length === 0 ? (
        <div className="rounded-[16px] bg-surface p-5 text-[14px] text-label-2 shadow-sm hairline">
          No locations yet. Customers will see your business address. Add one to start offering multiple locations.
        </div>
      ) : (
        <div className="divide-y divide-separator overflow-hidden rounded-[16px] bg-surface shadow-sm hairline">
          {locations.map((l) => {
            const ids = staffMap[l.id] ?? [];
            const shown = ids.length ? members.filter((m) => ids.includes(m.id)) : members;
            return (
              <button key={l.id} type="button" onClick={() => setEditing(l)} className={cn("flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-surface-2", !l.active && "opacity-60")}>
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><MapPin className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[16px] font-semibold">{l.name}{!l.active && <Badge>Hidden</Badge>}</div>
                  {l.address && <div className="truncate text-[14px] text-label-2">{l.address}</div>}
                  {l.phone && <div className="flex items-center gap-1 text-[13px] text-label-3"><Phone className="size-3" />{l.phone}</div>}
                </div>
                <div className="flex -space-x-1">
                  {shown.slice(0, 4).map((m) => <Avatar key={m.id} name={m.display_name} color={m.color} size={24} className="ring-2 ring-surface" />)}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {editing && (
        <LocationEditor
          key={editing.id ?? "new"}
          slug={slug}
          location={editing}
          staff={editing.id ? staffMap[editing.id] ?? [] : []}
          members={members}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function LocationEditor({
  slug, location, staff, members, onClose,
}: {
  slug: string; location: Partial<Location>; staff: string[]; members: Membership[]; onClose: () => void;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(staff);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const submit = (fd: FormData) => {
    fd.delete("staff");
    selected.forEach((id) => fd.append("staff", id));
    start(async () => {
      const r = await saveLocation(slug, fd);
      if (r.error) setError(r.error);
      else { toast(location.id ? "Location updated" : "Location added"); onClose(); }
    });
  };

  const remove = () =>
    start(async () => {
      if (!location.id || !confirmDelete) return setConfirmDelete(true);
      const r = await deleteLocation(slug, location.id);
      if (r.error) setError(r.error);
      else { toast("Location deleted"); onClose(); }
    });

  return (
    <Sheet open onClose={onClose} title={location.id ? "Edit location" : "New location"}>
      <form action={submit} className="space-y-5">
        <input type="hidden" name="id" value={location.id ?? ""} />
        <Field label="Name"><Input name="name" defaultValue={location.name} placeholder="Downtown studio" required autoFocus={!location.id} /></Field>
        <Field label="Address"><Input name="address" defaultValue={location.address ?? ""} placeholder="214 Queen St W, Toronto" /></Field>
        <Field label="Phone"><Input name="phone" type="tel" defaultValue={location.phone ?? ""} /></Field>

        <div className="space-y-2">
          <span className="px-1 text-[13px] font-medium text-label-2">Who works here?</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setSelected([])} className={cn("h-10 sm:h-8 rounded-full px-3.5 text-[13px] font-medium transition", selected.length === 0 ? "bg-accent text-white" : "bg-surface-2")}>
              Everyone
            </button>
            {members.map((m) => {
              const on = selected.includes(m.id);
              return (
                <button type="button" key={m.id} onClick={() => setSelected((s) => (on ? s.filter((x) => x !== m.id) : [...s, m.id]))}
                  className={cn("flex h-10 sm:h-8 items-center gap-1.5 rounded-full pl-1 pr-3 text-[13px] font-medium transition", on ? "bg-accent text-white" : "bg-surface-2")}>
                  <Avatar name={m.display_name} color={m.color} size={24} /> {m.display_name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-[12px] bg-surface-2 px-4 py-3">
          <div>
            <div className="text-[15px] font-medium">Bookable online</div>
            <div className="text-[13px] text-label-2">Show on your public booking page.</div>
          </div>
          <Switch name="active" defaultChecked={location.active ?? true} />
        </div>

        {error && <Notice>{error}</Notice>}
        <div className="flex gap-2">
          {location.id && (
            <Button type="button" variant="destructive" onClick={remove} disabled={pending}>
              {confirmDelete ? "Tap to confirm" : "Delete"}
            </Button>
          )}
          <Button type="submit" className="flex-1" pill loading={pending}>Save</Button>
        </div>
      </form>
    </Sheet>
  );
}
