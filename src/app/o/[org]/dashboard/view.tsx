import Link from "next/link";
import { AlertCircle, CalendarClock, Check, ChevronRight, Circle, Clock, Lightbulb } from "lucide-react";
import { formatDate, formatTime, STATUS_LABEL } from "@/lib/format";
import { change, type Dashboard } from "@/lib/dashboard";
import { Avatar, Badge, statusTone } from "@/components/ui/misc";
import type { Membership, Organization } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BarChart, BarRow, Card, Delta, Empty, Heatmap, Kpi, money, pct, StackedBar } from "./widgets";

export const RANGES = [7, 30, 90] as const;

export interface DashboardViewProps {
  slug: string;
  org: Organization;
  me: Pick<Membership, "display_name">;
  members: Membership[];
  isAdmin: boolean;
  d: Dashboard;
  rangeDays: number;
  now: Date;
  today: string;
  /** What the getting-started checklist needs to know. */
  facts: { services: number; hasHours: boolean; hasOnlineBooking: boolean };
  /** Base path for the range links (the preview page uses its own). */
  basePath?: string;
}

export function DashboardView({ slug, org, me, members, isAdmin, d, rangeDays, now, today, facts, basePath }: DashboardViewProps) {
  const tz = org.timezone;
  const cur = org.currency;
  const memberById = new Map(members.map((m) => [m.id, m]));
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now)) % 24;
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const dayLabel = (day: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  const weekdayShort = (day: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

  // ----- plain-language insights
  const insights: string[] = [];
  const k = d.kpis;
  const revChange = change(k.revenue.value, k.revenue.prev);
  if (isAdmin && revChange !== null && revChange <= -0.2 && k.revenue.prev > 0) insights.push(`Revenue is down ${Math.abs(Math.round(revChange * 100))}% compared with the previous ${rangeDays} days.`);
  if (isAdmin && revChange !== null && revChange >= 0.2) insights.push(`Revenue is up ${Math.round(revChange * 100)}% compared with the previous ${rangeDays} days. Nice work.`);
  if (k.noShowRate.value !== null && k.noShowRate.value >= 0.15) insights.push(`${pct(k.noShowRate.value)} of appointments were no-shows. A small deposit on services can cut this down.`);
  if (k.utilization !== null && k.utilization < 0.3 && d.range.days >= 7) insights.push(`Only ${pct(k.utilization)} of your available time is booked. Share your booking link or the website pop-up to fill more of it.`);
  if (k.utilization !== null && k.utilization >= 0.85) insights.push(`You're ${pct(k.utilization)} booked. Consider adding hours or another team member.`);
  if (isAdmin && k.returningShare !== null && k.uniqueCustomers >= 5 && k.returningShare < 0.25) insights.push(`Only ${pct(k.returningShare)} of customers are returning ones. A follow-up reminder to rebook could help.`);

  // ----- getting-started checklist (owners and admins)
  const hasHours = facts.hasHours;
  const setup = [
    { done: facts.services > 0, label: "Add your first service", href: `/o/${slug}/services` },
    { done: hasHours, label: "Set working hours", href: `/o/${slug}/availability` },
    { done: members.length > 1, label: "Invite your team", href: `/o/${slug}/team` },
    { done: org.stripe_charges_enabled, label: "Connect Stripe to take deposits", href: `/o/${slug}/settings` },
    { done: facts.hasOnlineBooking, label: "Get your first online booking", href: `/${org.slug}` },
  ];
  const showSetup = isAdmin && setup.some((s) => !s.done);

  const daily = d.daily;
  const peak = Math.max(1, ...d.upcoming.map((u) => u.count));
  const servicesMax = Math.max(1, ...d.services.map((s) => s.count));

  return (
    <div className="space-y-6 pb-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold leading-tight sm:text-[34px]">{greeting}, {me.display_name.split(" ")[0]}</h1>
          <p className="mt-1 text-[15px] text-label-2">
            {formatDate(now, tz)} · {d.todayList.filter((b) => b.status !== "no_show").length} appointment{d.todayList.length === 1 ? "" : "s"} today
          </p>
        </div>
        <div className="inline-flex rounded-[10px] bg-surface-2 p-[2px]" role="tablist" aria-label="Date range">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`${basePath ?? `/o/${slug}/dashboard`}?range=${r}`}
              className={cn("grid h-8 place-items-center rounded-[8px] px-3.5 text-[13px] font-medium transition", r === rangeDays ? "bg-surface shadow-sm" : "text-label-2 hover:text-label")}
            >
              Last {r} days
            </Link>
          ))}
        </div>
      </div>

      {showSetup && (
        <Card title="Get set up" subtitle={`${setup.filter((s) => s.done).length} of ${setup.length} done`}>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {setup.map((s) => (
              <li key={s.label}>
                <Link href={s.href} className="flex items-center gap-3 rounded-[12px] bg-surface-2 px-3.5 py-2.5 text-[14px] transition hover:bg-surface-3">
                  {s.done ? <span className="grid size-5 place-items-center rounded-full bg-green text-white"><Check className="size-3.5" strokeWidth={3} /></span> : <Circle className="size-5 text-label-4" />}
                  <span className={cn("flex-1", s.done && "text-label-3 line-through")}>{s.label}</span>
                  {!s.done && <ChevronRight className="size-4 text-label-3" />}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Appointments" value={k.appointments.value} spark={daily.map((x) => x.appointments)} sub={<Delta value={k.appointments.value} prev={k.appointments.prev} />} href={`/o/${slug}/bookings?tab=past`} />
        {isAdmin ? (
          <Kpi
            label="Revenue"
            value={money(k.revenue.value, cur)}
            spark={daily.map((x) => x.revenue)}
            sub={<Delta value={k.revenue.value} prev={k.revenue.prev} />}
          />
        ) : (
          <Kpi label="No-shows" value={d.status.noShow} sub={<span className="text-[12px] text-label-3">{pct(k.noShowRate.value)} of appointments</span>} />
        )}
        {isAdmin ? (
          <Kpi label="New customers" value={k.newCustomers.value} sub={<Delta value={k.newCustomers.value} prev={k.newCustomers.prev} />} href={`/o/${slug}/customers`} />
        ) : (
          <Kpi label="Completed" value={d.status.completed} sub={<span className="text-[12px] text-label-3">in this period</span>} />
        )}
        <Kpi
          label="Time booked"
          value={pct(k.utilization)}
          sub={<span className="text-[12px] text-label-3">{k.utilization === null ? "Set working hours to see this" : "of your available hours"}</span>}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="No-show rate" value={pct(k.noShowRate.value)} sub={<Delta value={k.noShowRate.value} prev={k.noShowRate.prev} lowerIsBetter ratio />} />
        <Kpi label="Cancellation rate" value={pct(k.cancelRate.value)} sub={<Delta value={k.cancelRate.value} prev={k.cancelRate.prev} lowerIsBetter ratio />} />
        {isAdmin && (
          <Kpi
            label="Average booking"
            value={k.avgValue.value === null ? "–" : money(Math.round(k.avgValue.value), cur)}
            sub={<Delta value={k.avgValue.value} prev={k.avgValue.prev} />}
          />
        )}
        {isAdmin && (
          <Kpi
            label="Returning customers"
            value={pct(k.returningShare)}
            sub={<span className="text-[12px] text-label-3">{money(k.deposits, cur)} in deposits</span>}
          />
        )}
      </div>

      {/* Today + attention */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="Today"
          subtitle={d.nextUp ? `Next: ${formatTime(d.nextUp.starts_at, tz)}, ${d.nextUp.service_name}` : "Nothing else coming up today"}
          action={<Link href={`/o/${slug}/calendar`} className="text-[13px] font-medium text-accent">Open calendar</Link>}
        >
          {d.todayList.length === 0 ? (
            <Empty>No appointments today.</Empty>
          ) : (
            <ul className="divide-y divide-separator">
              {d.todayList.map((b) => {
                const m = memberById.get(b.member_id);
                const live = new Date(b.starts_at) <= now && new Date(b.ends_at) > now;
                const isNext = d.nextUp?.id === b.id;
                return (
                  <li key={b.id} className={cn("flex items-center gap-3 py-3", isNext && "-mx-2 rounded-[12px] bg-accent-soft px-2")}>
                    <div className="w-[88px] shrink-0 text-[13px] leading-tight">
                      <div className="font-semibold">{formatTime(b.starts_at, tz)}</div>
                      <div className="text-label-3">{formatTime(b.ends_at, tz)}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-medium">{b.service_name}</div>
                      <div className="truncate text-[13px] text-label-2">{b.customer_name ?? "Customer"}</div>
                    </div>
                    {isAdmin && m && <Avatar name={m.display_name} color={m.color} size={26} />}
                    {live ? <Badge tone="green">Now</Badge> : <Badge tone={statusTone(b.status)}>{STATUS_LABEL[b.status]}</Badge>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Needs your attention">
            {d.pendingApprovals + d.awaitingPayment === 0 && insights.length === 0 ? (
              <p className="flex items-center gap-2 text-[14px] text-label-2"><Check className="size-4 text-green" strokeWidth={3} /> You&apos;re all caught up.</p>
            ) : (
              <ul className="space-y-2.5">
                {d.pendingApprovals > 0 && (
                  <li>
                    <Link href={`/o/${slug}/bookings`} className="flex items-center gap-2.5 rounded-[12px] bg-orange-soft px-3 py-2.5 text-[14px] font-medium text-orange">
                      <AlertCircle className="size-4 shrink-0" />
                      <span className="flex-1">{d.pendingApprovals} booking request{d.pendingApprovals === 1 ? "" : "s"} to approve</span>
                      <ChevronRight className="size-4" />
                    </Link>
                  </li>
                )}
                {d.awaitingPayment > 0 && (
                  <li className="flex items-center gap-2.5 rounded-[12px] bg-surface-2 px-3 py-2.5 text-[14px]">
                    <Clock className="size-4 shrink-0 text-label-3" />
                    {d.awaitingPayment} awaiting deposit payment
                  </li>
                )}
                {insights.slice(0, 3).map((t) => (
                  <li key={t} className="flex items-start gap-2.5 text-[14px] leading-snug text-label-2">
                    <Lightbulb className="mt-0.5 size-4 shrink-0 text-accent" />
                    {t}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Next 7 days" subtitle={`${d.upcoming.reduce((n, u) => n + u.count, 0)} appointments`}>
            <div className="flex h-24 items-end gap-2">
              {d.upcoming.map((u) => (
                <div key={u.day} className="flex flex-1 flex-col items-center gap-1" title={`${dayLabel(u.day)}: ${u.count}`}>
                  <span className="text-[11px] font-medium text-label-2">{u.count || ""}</span>
                  <div
                    className={cn("w-full rounded-[6px]", u.day === today ? "bg-accent" : "bg-accent/50")}
                    style={{ height: `${Math.max(u.count ? 6 : 2, (u.count / peak) * 56)}px`, opacity: u.count ? 1 : 0.25 }}
                  />
                  <span className="text-[11px] text-label-3">{weekdayShort(u.day).slice(0, 2)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Trends */}
      <div className={cn("grid gap-4", isAdmin && "lg:grid-cols-2")}>
        <Card title="Appointments per day" subtitle={`${dayLabel(d.range.start)} – ${dayLabel(d.range.end)}`}>
          <BarChart values={daily.map((x) => x.appointments)} labels={daily.map((x) => dayLabel(x.day))} format={(v) => `${v} appointment${v === 1 ? "" : "s"}`} />
        </Card>
        {isAdmin && (
          <Card title="Revenue per day" subtitle="Services delivered">
            <BarChart values={daily.map((x) => x.revenue)} labels={daily.map((x) => dayLabel(x.day))} format={(v) => money(v, cur)} />
          </Card>
        )}
      </div>

      {/* Services + busiest times */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Top services" subtitle="By number of bookings">
          {d.services.length === 0 ? (
            <Empty>No bookings in this period yet.</Empty>
          ) : (
            <div className="space-y-3.5">
              {d.services.map((s) => (
                <BarRow
                  key={s.name}
                  label={s.name}
                  value={s.count}
                  max={servicesMax}
                  right={<>{s.count} booking{s.count === 1 ? "" : "s"}{isAdmin && s.revenue > 0 ? ` · ${money(s.revenue, cur)}` : ""}</>}
                />
              ))}
            </div>
          )}
        </Card>
        <Card title="Busiest times" subtitle="When appointments start. Darker means busier.">
          {d.heatmap.max === 0 ? <Empty>No bookings in this period yet.</Empty> : <Heatmap {...d.heatmap} />}
        </Card>
      </div>

      {/* Team + mix */}
      <div className="grid gap-4 lg:grid-cols-3">
        {isAdmin && (
          <Card className="lg:col-span-2" title="Team" subtitle="This period">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-[14px]">
                <thead className="text-[12px] text-label-3">
                  <tr>
                    <th className="pb-2 font-medium">Person</th>
                    <th className="pb-2 text-right font-medium">Appts</th>
                    <th className="pb-2 text-right font-medium">Revenue</th>
                    <th className="pb-2 text-right font-medium">Time booked</th>
                    <th className="pb-2 text-right font-medium">No-shows</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-separator">
                  {d.staff.map((s) => {
                    const m = memberById.get(s.memberId);
                    return (
                      <tr key={s.memberId}>
                        <td className="py-2.5">
                          <span className="flex items-center gap-2.5">
                            <Avatar name={m?.display_name ?? "?"} color={m?.color} size={26} />
                            <span className="truncate font-medium">{m?.display_name}</span>
                          </span>
                        </td>
                        <td className="py-2.5 text-right">{s.appointments}</td>
                        <td className="py-2.5 text-right">{money(s.revenue, cur)}</td>
                        <td className="py-2.5 text-right">{pct(s.utilization)}</td>
                        <td className="py-2.5 text-right">{s.noShows}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <div className={cn("space-y-4", !isAdmin && "lg:col-span-3")}>
          <Card title="Booking outcomes">
            <StackedBar
              parts={[
                { label: "Completed", value: d.status.completed, className: "bg-green" },
                { label: "Upcoming", value: d.status.upcoming, className: "bg-accent" },
                { label: "No-show", value: d.status.noShow, className: "bg-orange" },
                { label: "Cancelled", value: d.status.cancelled, className: "bg-red" },
              ]}
            />
          </Card>
          <Card title="How people book">
            <StackedBar
              parts={[
                { label: "Online", value: d.source.online, className: "bg-accent" },
                { label: "Added by team", value: d.source.manual, className: "bg-label-3" },
              ]}
            />
          </Card>
        </div>
      </div>

      {isAdmin && (
        <Card title="Best customers" subtitle="By spend this period" action={<Link href={`/o/${slug}/customers`} className="text-[13px] font-medium text-accent">All customers</Link>}>
          {d.topCustomers.length === 0 ? (
            <Empty>Completed visits will show up here.</Empty>
          ) : (
            <ul className="divide-y divide-separator">
              {d.topCustomers.map((c, i) => (
                <li key={c.id} className="flex items-center gap-3 py-2.5">
                  <span className="w-5 text-center text-[13px] font-semibold text-label-3">{i + 1}</span>
                  <Avatar name={c.name} color="#8E8E93" size={30} />
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{c.name}</span>
                  <span className="text-[13px] text-label-3">{c.visits} visit{c.visits === 1 ? "" : "s"}</span>
                  <span className="w-20 text-right text-[15px] font-semibold">{money(c.spend, cur)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <p className="flex items-center gap-1.5 px-1 text-[12px] text-label-3">
        <CalendarClock className="size-3.5" /> {isAdmin ? "Revenue counts services already delivered (completed, or confirmed and finished). Cancelled bookings are excluded. " : ""}Times are in {tz.replace(/_/g, " ")}.
      </p>
    </div>
  );
}
