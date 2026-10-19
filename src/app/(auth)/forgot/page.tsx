import type { Metadata } from "next";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false, follow: true } };

export default async function ForgotPage(props: PageProps<"/forgot">) {
  const { error } = await props.searchParams;
  return (
    <>
      <h1 className="text-[26px] font-bold">Reset your password</h1>
      <p className="mt-1 mb-6 text-[15px] text-label-2">Enter your email and we&apos;ll send you a link to choose a new one.</p>
      {error && <p className="mb-4 rounded-[12px] bg-red-soft px-3.5 py-2.5 text-[14px] text-red">That reset link has expired or was already used. Enter your email to get a new one.</p>}
      <ForgotForm />
    </>
  );
}
