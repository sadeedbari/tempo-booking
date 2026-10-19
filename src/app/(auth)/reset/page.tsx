import type { Metadata } from "next";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import { buttonClass } from "@/components/ui/button-class";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false, follow: true } };

export default async function ResetPage() {
  const user = await getUser(); // the emailed link signs the person in before sending them here
  if (!user) {
    return (
      <>
        <h1 className="text-[26px] font-bold">That link has expired</h1>
        <p className="mt-1 mb-6 text-[15px] text-label-2">Reset links work once and only for a short time. Ask for a new one.</p>
        <Link href="/forgot" className={buttonClass("filled", "lg", true, "w-full")}>Send a new link</Link>
      </>
    );
  }
  return (
    <>
      <h1 className="text-[26px] font-bold">Choose a new password</h1>
      <p className="mt-1 mb-6 text-[15px] text-label-2">For {user.email}.</p>
      <ResetForm />
    </>
  );
}
