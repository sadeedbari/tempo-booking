import type { Metadata } from "next";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPage() {
  return (
    <>
      <h1 className="text-[26px] font-bold">Reset your password</h1>
      <p className="mt-1 mb-6 text-[15px] text-label-2">Enter your email and we&apos;ll send you a link to choose a new one.</p>
      <ForgotForm />
    </>
  );
}
