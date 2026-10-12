"use client";
import Link from "next/link";
import { useEffect } from "react";
import { Logo } from "@/components/app/logo";
import { Button } from "@/components/ui/button";
import { buttonClass } from "@/components/ui/button-class";

/** Shown when something unexpected breaks while a page loads. The rest of the app keeps working. */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-12 text-center">
      <Link href="/" className="mb-8"><Logo className="text-[20px]" /></Link>
      <div className="w-full max-w-[420px] rounded-[24px] glass-strong hairline p-8 shadow-lg" role="alert">
        <h1 className="text-[24px] font-bold">Something went wrong</h1>
        <p className="mt-2 text-[15px] text-label-2">We hit a problem loading this page. Your information is safe. Please try again.</p>
        {error.digest && <p className="mt-3 text-[12px] text-label-3">Reference: {error.digest}</p>}
        <div className="mt-6 flex flex-col gap-2">
          <Button size="lg" pill className="w-full" onClick={() => retry()}>Try again</Button>
          <Link href="/app" className={buttonClass("plain", "lg", true, "w-full")}>Go to my dashboard</Link>
        </div>
      </div>
    </div>
  );
}
