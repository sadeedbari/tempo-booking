import Link from "next/link";
import { LEGAL } from "@/lib/legal";

const link = "inline-flex min-h-11 items-center px-3 text-base font-medium text-label-2 hover:text-accent-text";

export function SiteFooter() {
  return (
    <footer className="border-t border-separator py-8 text-center text-base text-label-2">
      <nav aria-label="Legal and contact" className="mb-2 flex flex-wrap justify-center gap-x-2">
        <Link href="/privacy" className={link}>Privacy Policy</Link>
        <Link href="/terms" className={link}>Terms of Service</Link>
        <a href={`mailto:${LEGAL.contactEmail}`} className={link}>Contact</a>
      </nav>
      <p className="px-4">&copy; {new Date().getFullYear()} Tempo, by {LEGAL.operator}. Made with care.</p>
    </footer>
  );
}
