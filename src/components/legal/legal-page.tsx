import Link from "next/link";
import { Logo } from "@/components/app/logo";
import { LEGAL } from "@/lib/legal";

/** Plain, readable layout for the privacy policy and terms. */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-separator">
        <nav className="mx-auto flex h-14 max-w-3xl items-center justify-between px-5">
          <Link href="/" className="inline-flex min-h-10 items-center"><Logo /></Link>
          <div className="flex gap-5 text-[14px] font-medium text-label-2">
            <Link href="/privacy" className="inline-block px-2 py-2.5 hover:text-label">Privacy</Link>
            <Link href="/terms" className="inline-block px-2 py-2.5 hover:text-label">Terms</Link>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-[34px] font-bold leading-tight">{title}</h1>
        <p className="mt-2 text-[14px] text-label-3">Last updated {LEGAL.updated}</p>
        <div className="mt-8 space-y-4 text-[16px] leading-relaxed text-label-2">{children}</div>
      </main>
      <footer className="border-t border-separator py-8 text-center text-[13px] text-label-3">
        © {new Date().getFullYear()} {LEGAL.operator}. {LEGAL.product} is operated by {LEGAL.operator}.
      </footer>
    </div>
  );
}

export const H2 = ({ children }: { children: React.ReactNode }) => (
  <h2 className="!mt-10 text-[22px] font-semibold text-label">{children}</h2>
);
export const UL = ({ children }: { children: React.ReactNode }) => <ul className="list-disc space-y-1.5 pl-6">{children}</ul>;
