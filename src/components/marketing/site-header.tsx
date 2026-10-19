import Link from "next/link";
import { Logo } from "@/components/app/logo";
import { ThemeSlider } from "@/components/app/theme-switch";

const ANCHORS = [
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

const link = "min-h-11 items-center rounded-full px-3 text-base font-medium text-label-2 hover:bg-accent-soft hover:text-accent-text";

/**
 * Header: sticky only from md up (a sticky header ate 25-42% of a phone screen at 200% text, D-034); static on phones. From md up everything is in one row. On phones the row only keeps logo, theme slider and the main
 * button (so it fits at 320px); the section links and "Sign in" sit in a second, non-sticky row just below it.
 */
export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <>
      <header className="relative z-40 md:sticky md:top-0 glass border-b border-separator">
        <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 py-1 sm:px-5">
          <Link href="/" aria-label="Tempo home" className="inline-flex min-h-11 items-center rounded-full"><Logo /></Link>
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {ANCHORS.map((a) => <a key={a.href} href={a.href} className={`${link} inline-flex`}>{a.label}</a>)}
          </nav>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1 sm:gap-2">
            <ThemeSlider />
            {signedIn ? (
              <Link href="/app" className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent-fill px-3.5 text-center text-base font-medium text-white hover:bg-accent-fill-hover">Open Tempo</Link>
            ) : (
              <>
                <Link href="/login" className={`${link} hidden md:inline-flex`}>Sign in</Link>
                <Link href="/signup" className="inline-flex min-h-11 items-center justify-center rounded-full bg-accent-fill px-3.5 text-center text-base font-medium text-white hover:bg-accent-fill-hover">Get started</Link>
              </>
            )}
          </div>
        </div>
      </header>
      <nav aria-label="Page sections" className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-1 px-3 md:hidden">
        {ANCHORS.map((a) => <a key={a.href} href={a.href} className={`${link} inline-flex`}>{a.label}</a>)}
        {!signedIn && <Link href="/login" className={`${link} inline-flex`}>Sign in</Link>}
      </nav>
    </>
  );
}
