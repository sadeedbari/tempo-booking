"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  House, CalendarDays, CalendarRange, ListChecks, Users2, Sparkles, Clock3, Settings, ExternalLink, ChevronsUpDown, Check, Plus, LogOut, Contact, Ellipsis, Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoMark } from "./logo";
import { Avatar } from "@/components/ui/misc";

type OrgLite = { id: string; name: string; slug: string; accent_color: string; role: string };

const NAV = [
  { href: "dashboard", label: "Home", icon: House },
  { href: "calendar", label: "Calendar", icon: CalendarDays },
  { href: "bookings", label: "Bookings", icon: ListChecks },
  { href: "schedule", label: "Schedule", icon: CalendarRange },
  { href: "customers", label: "Customers", icon: Contact },
  { href: "services", label: "Services", icon: Sparkles },
  { href: "workflows", label: "Workflows", icon: Workflow },
  { href: "team", label: "Team", icon: Users2 },
  { href: "availability", label: "Availability", icon: Clock3 },
  { href: "settings", label: "Settings", icon: Settings },
];

const TABS = NAV.filter((n) => ["dashboard", "calendar", "bookings", "schedule"].includes(n.href));
const MORE = NAV.filter((n) => !["dashboard", "calendar", "bookings", "schedule"].includes(n.href));

export function Sidebar({
  org,
  orgs,
  me,
  pendingApprovals = 0,
}: {
  org: OrgLite;
  orgs: OrgLite[];
  me: { name: string; email: string; color: string };
  /** Online booking requests waiting for approval. */
  pendingApprovals?: number;
}) {
  const pathname = usePathname();
  const base = `/o/${org.slug}`;
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE.some((n) => pathname.startsWith(`${base}/${n.href}`));

  useEffect(() => {
    document.cookie = `tempo_org=${org.slug}; path=/; max-age=31536000; samesite=lax`;
  }, [org.slug]);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[260px] flex-col glass border-r border-separator lg:flex">
        <div className="p-3 pt-4">
          <OrgSwitcher org={org} orgs={orgs} />
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {NAV.map((item) => {
            const href = `${base}/${item.href}`;
            const active = pathname.startsWith(href);
            return (
              <Link
                key={item.href}
                href={href}
                className={cn(
                  "flex h-10 items-center gap-3 rounded-[9px] px-3 text-[14px] font-medium transition-colors duration-150",
                  active ? "bg-accent text-white shadow-sm" : "text-label hover:bg-label-4/40",
                )}
              >
                <item.icon className={cn("size-[18px]", active ? "text-white" : "text-accent")} strokeWidth={2} />
                {item.label}
                {item.href === "bookings" && pendingApprovals > 0 && (
                  <span className={cn("ml-auto grid min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold leading-5", active ? "bg-white text-accent" : "bg-orange text-white")}>
                    {pendingApprovals}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-1 border-t border-separator p-3">
          <a
            href={`/${org.slug}`}
            target="_blank"
            className="flex h-10 items-center gap-3 rounded-[9px] px-3 text-[14px] font-medium text-label-2 transition hover:bg-label-4/40 hover:text-label"
          >
            <ExternalLink className="size-[18px]" /> Booking page
          </a>
          <div className="flex items-center gap-3 rounded-[12px] px-2 py-2">
            <Avatar name={me.name || me.email} color={me.color} size={30} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{me.name}</div>
              <div className="truncate text-[12px] text-label-3">{me.email}</div>
            </div>
            <form action="/auth/signout" method="post">
              <button title="Sign out" className="grid size-10 place-items-center sm:size-8 rounded-full text-label-3 transition hover:bg-label-4/40 hover:text-label">
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between glass border-b border-separator px-4 pt-[env(safe-area-inset-top)] lg:hidden">
        <OrgSwitcher org={org} orgs={orgs} compact />
        <a href={`/${org.slug}`} target="_blank" className="inline-flex min-h-10 items-center text-[15px] font-medium text-accent">Booking page</a>
      </header>

      {/* Mobile tab bar: four main pages, then "More" for the rest */}
      {moreOpen && <button aria-label="Close menu" className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setMoreOpen(false)} />}
      {moreOpen && (
        <div className="fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 overflow-hidden rounded-[18px] glass-strong hairline p-1.5 shadow-lg animate-pop lg:hidden">
          {MORE.map((item) => {
            const href = `${base}/${item.href}`;
            return (
              <Link key={item.href} href={href} onClick={() => setMoreOpen(false)} className={cn("flex h-12 items-center gap-3 rounded-[12px] px-3 text-[16px] font-medium", pathname.startsWith(href) ? "bg-accent-soft text-accent" : "text-label")}>
                <item.icon className="size-5" /> {item.label}
              </Link>
            );
          })}
          <form action="/auth/signout" method="post" className="mt-1 border-t border-separator pt-1">
            <button className="flex h-12 w-full items-center gap-3 rounded-[12px] px-3 text-left text-[16px] font-medium text-label-2">
              <LogOut className="size-5" /> Sign out
              <span className="ml-auto truncate text-[13px] font-normal text-label-3">{me.email}</span>
            </button>
          </form>
        </div>
      )}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex glass border-t border-separator pb-[env(safe-area-inset-bottom)] lg:hidden">
        {TABS.map((item) => {
          const href = `${base}/${item.href}`;
          const active = pathname.startsWith(href) && !moreOpen;
          return (
            <Link key={item.href} href={href} onClick={() => setMoreOpen(false)} className={cn("flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", active ? "text-accent" : "text-label-3")}>
              <span className="relative">
                <item.icon className="size-6" strokeWidth={active ? 2.2 : 1.8} />
                {item.href === "bookings" && pendingApprovals > 0 && <span className="absolute -right-1.5 -top-1 size-2.5 rounded-full bg-orange" />}
              </span>
              {item.label}
            </Link>
          );
        })}
        <button onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen} className={cn("flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", moreOpen || moreActive ? "text-accent" : "text-label-3")}>
          <Ellipsis className="size-6" strokeWidth={moreOpen || moreActive ? 2.2 : 1.8} />
          More
        </button>
      </nav>
    </>
  );
}

function OrgSwitcher({ org, orgs, compact }: { org: OrgLite; orgs: OrgLite[]; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn("flex w-full items-center gap-2.5 rounded-[12px] text-left transition hover:bg-label-4/40", compact ? "px-1 py-1" : "px-2 py-2")}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-[9px] text-[14px] font-bold text-white" style={{ background: `linear-gradient(180deg, ${org.accent_color}bb, ${org.accent_color})` }}>
          {org.name[0]?.toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">{org.name}</span>
          {!compact && <span className="block text-[12px] capitalize text-label-3">{org.role}</span>}
        </span>
        <ChevronsUpDown className="size-4 text-label-3" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-[250px] overflow-hidden rounded-[14px] glass-strong hairline p-1.5 shadow-lg animate-pop">
          <div className="px-2.5 pt-1.5 pb-1 text-[12px] font-medium text-label-3">Teams</div>
          {orgs.map((o) => (
            <Link key={o.id} href={`/o/${o.slug}/dashboard`} onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-[14px] hover:bg-accent hover:text-white">
              <span className="grid size-6 place-items-center rounded-[7px] text-[11px] font-bold text-white" style={{ background: o.accent_color }}>{o.name[0]?.toUpperCase()}</span>
              <span className="flex-1 truncate">{o.name}</span>
              {o.id === org.id && <Check className="size-4" />}
            </Link>
          ))}
          <div className="my-1 h-px bg-separator" />
          <Link href="/onboarding" className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-[14px] hover:bg-accent hover:text-white">
            <Plus className="size-4" /> New team
          </Link>
          <div className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-label-3"><LogoMark className="size-4" /> Tempo</div>
        </div>
      )}
    </div>
  );
}
