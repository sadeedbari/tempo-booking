"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Search } from "lucide-react";
import { PageHeader, EmptyState, Badge, statusTone, Avatar } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { Input } from "@/components/ui/input";
import { BookingSheet } from "@/components/app/booking-sheet";
import { dayKey, formatDate, formatMoney, formatTime, STATUS_LABEL } from "@/lib/format";
import type { Booking, Membership, Organization, Service } from "@/lib/types";

export function BookingsList({
  slug, org, tab, bookings, services, members, allMembers,
}: {
  slug: string; org: Organization; tab: string; bookings: Booking[]; services: Service[]; members: Membership[]; allMembers: Membership[];
}) {
  const router = useRouter();
  const tz = org.timezone;
  const [selected, setSelected] = useState<Booking | null>(null);
  const [q, setQ] = useState("");
  const serviceById = new Map(services.map((s) => [s.id, s]));
  const memberById = new Map(allMembers.map((m) => [m.id, m]));

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = bookings.filter(
      (b) => !term || b.customer?.name.toLowerCase().includes(term) || b.customer?.email.includes(term) || b.service_name.toLowerCase().includes(term),
    );
    const map = new Map<string, Booking[]>();
    list.forEach((b) => {
      const k = dayKey(b.starts_at, tz);
      map.set(k, [...(map.get(k) ?? []), b]);
    });
    return [...map.entries()];
  }, [bookings, q, tz]);

  return (
    <>
      <PageHeader title="Bookings" subtitle="Every appointment, in one list." />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Segmented
          value={tab}
          onChange={(v) => router.push(`/o/${slug}/bookings?tab=${v}`)}
          options={[{ value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past" }, { value: "cancelled", label: "Cancelled" }]}
        />
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-label-3" />
          <Input className="h-10 pl-9" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState icon={<CalendarCheck className="size-7" />} title={tab === "upcoming" ? "No upcoming bookings" : "Nothing here yet"} body="Share your booking page and new appointments will appear here." />
      ) : (
        <div className="space-y-7">
          {groups.map(([day, items]) => (
            <section key={day} className="animate-rise">
              <h3 className="mb-2 px-1 text-[15px] font-semibold">{formatDate(items[0].starts_at, tz)}</h3>
              <div className="overflow-hidden rounded-[16px] bg-surface shadow-sm hairline divide-y divide-separator">
                {items.map((b) => {
                  const svc = b.service_id ? serviceById.get(b.service_id) : undefined;
                  const m = memberById.get(b.member_id);
                  return (
                    <button key={b.id} onClick={() => setSelected(b)} className="flex w-full items-center gap-4 px-4 py-3 text-left transition hover:bg-surface-2">
                      <div className="w-16 shrink-0 text-right">
                        <div className="text-[15px] font-semibold">{formatTime(b.starts_at, tz)}</div>
                        <div className="text-[12px] text-label-3">{formatTime(b.ends_at, tz)}</div>
                      </div>
                      <span className="h-10 w-1 shrink-0 rounded-full" style={{ background: svc?.color ?? "#8E8E93" }} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-medium">{b.customer?.name ?? "Customer"}</div>
                        <div className="truncate text-[13px] text-label-2">{b.service_name}</div>
                      </div>
                      {m && (
                        <div className="hidden items-center gap-2 sm:flex">
                          <Avatar name={m.display_name} color={m.color} size={24} />
                          <span className="text-[13px] text-label-2">{m.display_name}</span>
                        </div>
                      )}
                      <div className="hidden w-20 text-right text-[14px] text-label-2 md:block">{formatMoney(b.price_cents, b.currency)}</div>
                      <Badge tone={statusTone(b.status)}>{STATUS_LABEL[b.status]}</Badge>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <BookingSheet
        booking={selected}
        onClose={() => setSelected(null)}
        slug={slug}
        org={org}
        members={members}
        service={selected?.service_id ? serviceById.get(selected.service_id) : undefined}
        member={selected ? memberById.get(selected.member_id) : undefined}
      />
    </>
  );
}
