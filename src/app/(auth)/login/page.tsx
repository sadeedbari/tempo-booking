import type { Metadata } from "next";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const { next, error } = await props.searchParams;
  return (
    <>
      <h1 className="text-[26px] font-bold">Welcome back</h1>
      <p className="mt-1 mb-6 text-[15px] text-label-2">Sign in to your Tempo account.</p>
      {error === "browser" && <p className="mb-4 rounded-[12px] bg-accent-soft px-3.5 py-2.5 text-[14px] text-accent">Your email is confirmed. Sign in below to continue. (The link was opened in a different browser than the one you signed up in, so we couldn&apos;t sign you in automatically.)</p>}
      {error && error !== "browser" && <p className="mb-4 rounded-[12px] bg-red-soft px-3.5 py-2.5 text-[14px] text-red">That link has expired or was already used. If you already confirmed your email, just sign in below. Otherwise sign up again and we&apos;ll send a fresh link.</p>}
      <AuthForm mode="login" next={typeof next === "string" ? next : undefined} />
    </>
  );
}
