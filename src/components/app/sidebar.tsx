"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  House, CalendarDays, CalendarRange, ListChecks, Users2, Sparkles, Clock3, Settings, ExternalLink, ChevronsUpDown, Check, Plus, LogOut, Contact, Ellipsis, Workflow, MessageSquareText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_OWNED_ORGS } from "@/lib/billing";
import { LogoMark } from "./logo";
import { ThemeSwitch, ThemeToggleButton } from "./theme-switch";
import { Avatar } from "@/components/ui/misc";

type OrgLite = { id: string; name: string; slug: string; accent_color: string; role: string };

/** `tone` is [light, rich]: each page gets its own frosted-glass tile. */
const NAV = [
  { href: "dashboard", label: "Home", icon: House, tone: ["#8EB4FF", "#5A8FEF"], group: "Today" },
  { href: "calendar", label: "Calendar", icon: CalendarDays, tone: ["#FFA98A", "#EF7E58"], group: "Today" },
  { href: "bookings", label: "Bookings", icon: ListChecks, tone: ["#6FD6B8", "#2FA98A"], group: "Today" },
  { href: "schedule", label: "Schedule", icon: CalendarRange, tone: ["#B3A0FF", "#8466E0"], group: "Today" },
  { href: "customers", label: "Customers", icon: Contact, tone: ["#FFA0C4", "#E0679A"], group: "Business" },
  { href: "inquiries", label: "Inquiries", icon: MessageSquareText, tone: ["#A5B0F7", "#5E6EDD"], group: "Business" },
  { href: "services", label: "Services", icon: Sparkles, tone: ["#FFCB6B", "#E3A21E"], group: "Business" },
  { href: "workflows", label: "Workflows", icon: Workflow, tone: ["#6CC8F0", "#2F9BCB"], group: "Business" },
  { href: "team", label: "Team", icon: Users2, tone: ["#9DAEC8", "#6F82A0"], group: "Business" },
  { href: "availability", label: "Availability", icon: Clock3, tone: ["#6AD7CF", "#2FA9A1"], group: "Business" },
  { href: "settings", label: "Settings", icon: Settings, tone: ["#AEB5C3", "#7C8494"], group: "Account" },
];

type NavItem = (typeof NAV)[number];

/** Small uppercase heading that starts a group of menu items. */
function SectionLabel({ children, first, large }: { children: React.ReactNode; first?: boolean; large?: boolean }) {
  return (
    <div className={cn("font-semibold uppercase tracking-[0.12em] text-label-3", large ? "px-3 pb-1 text-[11px]" : "px-2.5 pb-1.5 text-[10.5px]", first ? "pt-1" : large ? "pt-3" : "pt-4")}>
      {children}
    </div>
  );
}

/** Frosted-glass squircle: a translucent tint with a bright top edge and a tinted icon. `onAccent` turns the icon white on the blue active row. */
function NavTile({ item, size = 28, onAccent }: { item: NavItem; size?: number; onAccent?: boolean }) {
  const [light, rich] = item.tone;
  return (
    <span
      className="grid shrink-0 place-items-center"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.29,
        color: onAccent ? "#fff" : rich,
        background: `linear-gradient(160deg, ${light}66, ${rich}55)`,
        border: `0.5px solid ${onAccent ? "rgba(255,255,255,0.55)" : `${rich}66`}`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -2px 4px ${rich}22, 0 2px 6px -2px ${rich}55`,
      }}
    >
      <item.icon style={{ width: size * 0.55, height: size * 0.55 }} strokeWidth={2.2} />
    </span>
  );
}

const TABS = NAV.filter((n) => ["dashboard", "calendar", "bookings", "schedule"].includes(n.href));
const MORE = NAV.filter((n) => !["dashboard", "calendar", "bookings", "schedule"].includes(n.href));

export function Sidebar({
  org,
  orgs,
  me,
  pendingApprovals = 0,
  newInquiries = 0,
}: {
  org: OrgLite;
  orgs: OrgLite[];
  me: { name: string; email: string; color: string };
  /** Online booking requests waiting for approval. */
  pendingApprovals?: number;
  /** Website messages nobody has handled yet. */
  newInquiries?: number;
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
        <nav className="flex-1 overflow-y-auto px-3 py-2">
          {NAV.map((item, i) => {
            const href = `${base}/${item.href}`;
            const active = pathname.startsWith(href);
            return (
              <div key={item.href}>
                {NAV[i - 1]?.group !== item.group && <SectionLabel first={i === 0}>{item.group}</SectionLabel>}
                <Link
                  href={href}
                  className={cn(
                    "mb-0.5 flex h-10 items-center gap-3 rounded-[10px] px-2.5 text-[14px] font-medium transition-colors duration-150",
                    active ? "bg-accent text-white shadow-sm" : "text-label hover:bg-label-4/40",
                  )}
                >
                  <NavTile item={item} size={26} onAccent={active} />
                  {item.label}
                  {(() => {
                    const n = item.href === "bookings" ? pendingApprovals : item.href === "inquiries" ? newInquiries : 0;
                    return n > 0 ? (
                      <span className={cn("ml-auto grid min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold leading-5", active ? "bg-white text-accent" : "bg-orange text-white")}>
                        {n}
                      </span>
                    ) : null;
                  })()}
                </Link>
              </div>
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
            <ThemeToggleButton />
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
          {MORE.map((item, i) => {
            const href = `${base}/${item.href}`;
            return (
              <div key={item.href}>
                {MORE[i - 1]?.group !== item.group && <SectionLabel first={i === 0} large>{item.group}</SectionLabel>}
                <Link href={href} onClick={() => setMoreOpen(false)} className={cn("flex h-12 items-center gap-3 rounded-[12px] px-3 text-[16px] font-medium", pathname.startsWith(href) ? "bg-accent-soft text-accent" : "text-label")}>
                  <NavTile item={item} size={30} /> {item.label}
                  {item.href === "inquiries" && newInquiries > 0 && (
                    <span className="ml-auto grid min-w-6 place-items-center rounded-full bg-orange px-1.5 text-[12px] font-bold leading-6 text-white">{newInquiries}</span>
                  )}
                </Link>
              </div>
            );
          })}
          <div className="mt-1 flex items-center justify-between gap-3 border-t border-separator px-3 py-2">
            <span className="text-[15px] font-medium text-label">Appearance</span>
            <ThemeSwitch />
          </div>
          <form action="/auth/signout" method="post" className="border-t border-separator pt-1">
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
                <span className={cn("block transition-all duration-200", active ? "scale-110" : "")}><NavTile item={item} size={28} /></span>
                {item.href === "bookings" && pendingApprovals > 0 && <span className="absolute -right-1.5 -top-1 size-2.5 rounded-full bg-orange" />}
              </span>
              {item.label}
            </Link>
          );
        })}
        <button onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen} className={cn("flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", moreOpen || moreActive ? "text-accent" : "text-label-3")}>
          <span className="relative">
            <Ellipsis className="size-6" strokeWidth={moreOpen || moreActive ? 2.2 : 1.8} />
            {newInquiries > 0 && !moreOpen && <span className="absolute -right-1 -top-0.5 size-2.5 rounded-full bg-orange" aria-label={`${newInquiries} new website message${newInquiries === 1 ? "" : "s"}`} />}
          </span>
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
          {/* At the cap (3 owned teams) there is nothing to offer: the page behind it would only say no. */}
          {orgs.filter((o) => o.role === "owner").length < MAX_OWNED_ORGS && (
            <Link href="/onboarding" className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-[14px] hover:bg-accent hover:text-white">
              <Plus className="size-4" /> New team
            </Link>
          )}
          <div className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-label-3"><LogoMark className="size-4" /> Tempo</div>
        </div>
      )}
    </div>
  );
}
