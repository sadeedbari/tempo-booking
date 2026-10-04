import type { Metadata } from "next";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage(props: PageProps<"/signup">) {
  const { next } = await props.searchParams;
  return (
    <>
      <h1 className="text-[26px] font-bold">Create your account</h1>
      <p className="mt-1 mb-6 text-[15px] text-label-2">Free to start. Set up your team in under a minute.</p>
      <AuthForm mode="signup" next={typeof next === "string" ? next : undefined} />
    </>
  );
}
