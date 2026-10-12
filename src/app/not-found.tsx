import Link from "next/link";
import { Logo } from "@/components/app/logo";
import { buttonClass } from "@/components/ui/button-class";

/** Shown for any address that doesn't exist, or a page the signed-in person isn't allowed to see. */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-12 text-center">
      <Link href="/" className="mb-8"><Logo className="text-[20px]" /></Link>
      <div className="w-full max-w-[420px] rounded-[24px] glass-strong hairline p-8 shadow-lg">
        <h1 className="text-[24px] font-bold">We couldn&apos;t find that page</h1>
        <p className="mt-2 text-[15px] text-label-2">The link may be out of date, or the page may have moved.</p>
        <div className="mt-6 flex flex-col gap-2">
          <Link href="/app" className={buttonClass("filled", "lg", true, "w-full")}>Go to my dashboard</Link>
          <Link href="/" className={buttonClass("plain", "lg", true, "w-full")}>Back to the home page</Link>
        </div>
      </div>
    </div>
  );
}
